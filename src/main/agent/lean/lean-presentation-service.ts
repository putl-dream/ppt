import type { AgentModelSelection } from "@shared/agent";
import type { AgentGatewayConfig } from "@shared/agent-gateway-config";
import {
  isLeanStarterPresentation,
  type LeanRunMetrics,
} from "@shared/lean-mode";
import {
  COMMERCIAL_COMPOSITIONS,
  migrateLeanDeckSpecV1ToV2,
  leanDeckSpecV2Schema,
  type LeanDeckSpecV2,
} from "@shared/lean/deck-spec-v2";
import { leanDeckSpecSchema } from "@shared/lean-mode";
import type { PresentationCommand } from "@shared/commands";
import type { Presentation } from "@shared/presentation";
import type { DesignSystemV1 } from "@design-system";
import { z } from "zod";

import { ModelOutputError } from "../gateway/model-calls";
import {
  textFromContentBlocks,
  toolUseBlocksFromContent,
} from "../gateway/content-blocks";
import type {
  AgentModelContentBlock,
  AgentModelGateway,
} from "../gateway/types";
import { SearchCommercialAssetResolver } from "../assets/commercial-asset-resolver";
import { LeanV2Pipeline, type LeanV2PipelineResult } from "./lean-v2-pipeline";
import {
  LeanCommercialVisualReviewer,
  type CommercialVisualReviewResult,
} from "./commercial-visual-review";

export const LEAN_MAX_REQUEST_CHARS = 8_000;
export const LEAN_MAX_OUTPUT_TOKENS = 10_000;
export const LEAN_SUBMIT_TOOL_NAME = "submit_lean_deck_spec";

export const LEAN_SYSTEM_PROMPT = `你是商业演示文稿架构师。把用户目标一次性转换为 DeckSpec v2。

输出协议：
- 必须且只能调用一次 submit_lean_deck_spec；工具参数就是完整 DeckSpec，不要解释、不要 Markdown。若服务端不支持 tool_use，则只输出同一对象的 JSON。
- 字段名必须精确。顶层只能有 version、title、locale、scenario、audience、objective、desiredAction、coreMessage、presentationContext、afterUse、restructurePermission、narrativeMode、durationMinutes、designPreset、sources、slides。
- version 必须是数字 2（不是字符串）；字段名必须是 locale（不要 language），值只能是 zh-CN 或 en-US。
- 每个 source 必须有 id、label、asOf、provenance；asOf 不确定时用 null。
- coreMessage 是整套演示唯一核心信息；presentationContext 描述会议/传播场景；afterUse 描述会后如何使用。restructurePermission 只能是 preserve、reorder、rewrite-and-merge；narrativeMode 只能是 executive-brief、problem-solution、evidence-led、vision-to-action。
- 每个 slide 必须有 kind、purpose、title、subtitle、items、left、right、steps、metric、chart、sourceRefs、audienceMove、visual；audienceMove 用一句话说明本页推动受众理解、相信、决定或行动什么。未使用字段分别用空字符串、空数组或 null。不要输出 body、agenda、bullets、comparison、process、closing 等替代字段。
- visual 必须有 role、composition、imageMode、assetBrief、emphasis。composition 只能是 full-bleed、split、editorial-grid、image-collage、metric-story、minimal-statement 之一。imageMode=none 时 assetBrief 必须是空字符串；imageMode=required/optional 时 assetBrief 必须非空。emphasis 填 1–3 个从本页可见文字中原样复制的非空短语，可取标题或正文的子串；图表数值必须使用 JSON 中的标准数字文本（例如数值 14 应写 "14"，不要写 "14.0"）。不得改写或概括。不得输出坐标、字号、颜色、阴影、素材 URL 或 sceneId。

必须同时满足工具 JSON Schema 和以下跨页规则：
1. 不调用其他工具，不请求澄清，不输出 DeckSpec 以外的内容。
2. audience、objective、desiredAction、coreMessage、presentationContext、afterUse 必须共同描述同一个商业任务；每页 audienceMove 必须能回扣 objective 或 desiredAction。
3. 生成 6–12 页；第一页且仅一页 cover/opening，最后一页且仅一页 closing/close。9–12 页必须恰有一页 agenda/navigation；10–12 页必须有 1–2 页 section/navigation；section 最多两页。
4. 场景叙事必须完整：
   - internal-report：至少包含 context、proof、plan、close；
   - sales-proposal：至少包含 problem、solution、proof、ask、close；
   - investor-pitch：至少包含 problem、solution、两页 proof、plan 或 ask、close。
5. kind/purpose 组合：cover=opening；agenda/section=navigation；process 只能是 solution/plan；metric/chart 只能是 proof/insight；closing=close；bullets/comparison 只能是 context/problem/insight/solution/proof/plan/ask。
6. 字段规则：agenda.items 3–6；bullets.items 2–4；comparison 必须同时填写 left/right 且每侧 1–4 项；process.steps 2–5；metric 填 metric；chart 填 chart 且数据点 2–8；closing.subtitle 是总括结论、items 是 1–3 个下一步行动。
7. 不得连续三页 bullets。6–7 页至少使用 3 种 kind，8–9 页至少 4 种，10–12 页至少 5 种。每页只表达一个结论，标题用结论式短句，正文不用长段落。
8. 所有字段都必须返回；未使用字段用空字符串、空数组或 null。单页可见文字不超过 260 字符。
9. 不做外部研究，不编造真实来源。用户明确给出的数据可建 provenance=user 来源；其他数字只能标 provenance=illustrative。metric/chart 必须用 sourceRefs 引用已声明来源；没有可靠数字时优先使用非数据页。
10. 默认使用 zh-CN；只有用户明确要求英文时才使用 en-US。
11. 这是一次生成：信息不足时采用保守、透明的商业假设，不请求第二轮。`;

const LEAN_SUBMISSION_CHECKLIST = `调用工具前在内部逐项自检跨页叙事：
- internal-report 必须同时有 context、proof、plan、close。
- sales-proposal 必须同时有 problem、solution、proof、ask、close；ask 必须是 closing 之前的独立 bullets 或 comparison 页，closing/close 不能代替 ask。
- investor-pitch 必须同时有 problem、solution、至少两页 proof、plan 或 ask、close。
只在全部满足后提交，不要输出自检过程。`;

export interface LeanPresentationProposal {
  spec: LeanDeckSpecV2;
  commands: PresentationCommand[];
  summary: string;
  assumptions: string[];
  risk: "high";
  metrics: LeanRunMetrics;
}

function toLeanOutputJsonSchema(): Record<string, unknown> {
  const schema = z.toJSONSchema(leanDeckSpecV2Schema, {
    unrepresentable: "throw",
    io: "output",
  }) as Record<string, unknown>;
  delete schema.$schema;
  const properties = isRecord(schema.properties) ? schema.properties : undefined;
  const slides = properties && isRecord(properties.slides)
    ? properties.slides
    : undefined;
  if (slides) {
    slides.description =
      "Cross-slide narrative contract: sales-proposal requires distinct problem, solution, proof, ask, and close purposes. The ask must be a separate bullets or comparison slide before closing; closing/close does not satisfy ask.";
  }
  return schema;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function canonicalLocale(value: unknown): "zh-CN" | "en-US" | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase().replaceAll("_", "-");
  if (["zh", "zh-cn", "chinese", "中文"].includes(normalized)) return "zh-CN";
  if (["en", "en-us", "english", "英文"].includes(normalized)) return "en-US";
  return undefined;
}

type CommercialComposition = (typeof COMMERCIAL_COMPOSITIONS)[number];

function canonicalComposition(
  value: unknown,
  slide: Record<string, unknown>,
): CommercialComposition | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase().replaceAll("_", "-").replaceAll(" ", "-");
  if ((COMMERCIAL_COMPOSITIONS as readonly string[]).includes(normalized)) {
    return normalized as CommercialComposition;
  }
  const aliases: Record<string, CommercialComposition> = {
    "fullbleed": "full-bleed",
    "hero": "full-bleed",
    "two-column": "split",
    "side-by-side": "split",
    "comparison": "split",
    "grid": "editorial-grid",
    "card-grid": "editorial-grid",
    "cards": "editorial-grid",
    "collage": "image-collage",
    "gallery": "image-collage",
    "dashboard": "metric-story",
    "data-story": "metric-story",
    "chart": "metric-story",
    "kpi": "metric-story",
    "minimal": "minimal-statement",
    "statement": "minimal-statement",
    "centered": "minimal-statement",
  };
  if (aliases[normalized]) return aliases[normalized];

  const kind = slide.kind;
  if (kind === "cover") {
    return isRecord(slide.visual) && slide.visual.imageMode !== "none"
      ? "full-bleed"
      : "minimal-statement";
  }
  if (kind === "comparison") return "split";
  if (kind === "metric" || kind === "chart") return "metric-story";
  if (kind === "closing" || kind === "section") return "minimal-statement";
  if (kind === "agenda" || kind === "process") return "editorial-grid";
  if (kind === "bullets") {
    return isRecord(slide.visual) && slide.visual.role === "gallery"
      ? "image-collage"
      : "editorial-grid";
  }
  return undefined;
}

function visibleSlideValues(slide: Record<string, unknown>): Array<string | number> {
  const values: Array<string | number> = [];
  const append = (value: unknown): void => {
    if (typeof value === "string" || typeof value === "number") {
      values.push(value);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(append);
      return;
    }
    if (isRecord(value)) {
      Object.values(value).forEach(append);
    }
  };
  for (const key of [
    "title",
    "subtitle",
    "items",
    "left",
    "right",
    "steps",
    "metric",
    "chart",
  ]) {
    append(slide[key]);
  }
  return values;
}

function canonicalEmphasis(value: unknown, slide: Record<string, unknown>): unknown {
  const emphasis = typeof value === "number" ? String(value) : value;
  if (typeof emphasis !== "string") return emphasis;
  const trimmed = emphasis.trim();
  const visibleValues = visibleSlideValues(slide);
  if (visibleValues.some((candidate) => String(candidate).includes(trimmed))) {
    return trimmed;
  }
  if (!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)%?$/.test(trimmed)) return trimmed;
  const numericValue = Number(trimmed.replace(/%$/, ""));
  if (!Number.isFinite(numericValue)) return trimmed;

  for (const candidate of visibleValues) {
    const tokens = String(candidate).match(/[+-]?(?:\d+(?:\.\d+)?|\.\d+)%?/g) ?? [];
    const equivalent = tokens.find((token) =>
      Number(token.replace(/%$/, "")) === numericValue
    );
    if (equivalent) return equivalent;
  }
  return trimmed;
}

/**
 * Provider compatibility stays deliberately shallow and whitelisted. The
 * canonical schema remains strict; this only repairs representational aliases
 * observed from compatible endpoints that do not fully enforce tool schemas.
 */
function normalizeLeanDeckSpecInput(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const normalized = { ...value };

  if (normalized.version === "2") {
    normalized.version = 2;
  }

  const locale = canonicalLocale(normalized.locale);
  if (locale) {
    normalized.locale = locale;
  }

  if (Object.hasOwn(normalized, "language")) {
    const languageLocale = canonicalLocale(normalized.language);
    if (
      languageLocale
      && (normalized.locale === undefined || normalized.locale === languageLocale)
    ) {
      normalized.locale = languageLocale;
      delete normalized.language;
    }
  }

  if (normalized.sources === undefined) {
    normalized.sources = [];
  } else if (Array.isArray(normalized.sources)) {
    normalized.sources = normalized.sources.map((source) =>
      isRecord(source) && source.asOf === undefined
        ? { ...source, asOf: null }
        : source
    );
  }

  if (Array.isArray(normalized.slides)) {
    normalized.slides = normalized.slides.map((slide) => {
      if (!isRecord(slide)) return slide;
      const normalizedSlide: Record<string, unknown> = { ...slide };
      const neutralDefaults: Record<string, unknown> = {
        subtitle: "",
        items: [],
        left: null,
        right: null,
        steps: [],
        metric: null,
        chart: null,
        sourceRefs: [],
      };
      for (const [key, defaultValue] of Object.entries(neutralDefaults)) {
        if (normalizedSlide[key] === undefined) {
          normalizedSlide[key] = defaultValue;
        }
      }
      if (!isRecord(normalizedSlide.visual)) return normalizedSlide;

      const visual = { ...normalizedSlide.visual };
      const composition = canonicalComposition(visual.composition, slide);
      if (composition) visual.composition = composition;
      if (Array.isArray(visual.emphasis)) {
        visual.emphasis = visual.emphasis
          .map((emphasis) => canonicalEmphasis(emphasis, normalizedSlide))
          .filter((emphasis, index, all) =>
            all.findIndex((candidate) => candidate === emphasis) === index
          )
          .slice(0, 3);
      }
      if (visual.imageMode === "none") {
        visual.assetBrief = "";
      }
      return { ...normalizedSlide, visual };
    });
  }

  if (normalized.version === "1") {
    normalized.version = 1;
  }
  const legacy = leanDeckSpecSchema.safeParse(normalized);
  if (legacy.success) {
    return migrateLeanDeckSpecV1ToV2(legacy.data);
  }

  return normalized;
}

function summarizeValidationError(error: z.ZodError): string {
  const displayed = error.issues.slice(0, 6).map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
    return `${path}: ${issue.message}`;
  });
  const hiddenCount = error.issues.length - displayed.length;
  return [
    ...displayed,
    ...(hiddenCount > 0 ? [`另有 ${hiddenCount} 项不符合契约`] : []),
  ].join("；");
}

function parseLeanDeckSpecValue(value: unknown): LeanDeckSpecV2 {
  const parsed = leanDeckSpecV2Schema.safeParse(normalizeLeanDeckSpecInput(value));
  if (!parsed.success) {
    throw new ModelOutputError(
      "Lean DeckSpec 校验失败；为保持单次调用承诺，本次不会自动重试："
      + summarizeValidationError(parsed.error),
      "schema-validation",
      parsed.error,
    );
  }
  return parsed.data;
}

function parseLeanDeckSpecText(text: string): LeanDeckSpecV2 {
  try {
    return parseLeanDeckSpecValue(JSON.parse(text));
  } catch (error) {
    if (error instanceof ModelOutputError) throw error;
    throw new ModelOutputError(
      "Lean Mode 返回了无效 JSON；为保持单次调用承诺，本次不会自动重试。",
      "invalid-json",
      error,
    );
  }
}

function extractLeanDeckSpec(
  content: AgentModelContentBlock[],
): { spec: LeanDeckSpecV2; specChars: number } {
  const toolCalls = toolUseBlocksFromContent(content);
  if (toolCalls.length > 0) {
    const submitted = toolCalls.filter((call) => call.name === LEAN_SUBMIT_TOOL_NAME);
    if (
      toolCalls.length !== 1
      || submitted.length !== 1
      || submitted[0]?.parseError
    ) {
      throw new ModelOutputError(
        "Lean Mode 未通过唯一的 DeckSpec 提交工具返回结果；"
        + "为保持单次调用承诺，本次不会自动重试。",
        "unexpected-tool-use",
      );
    }
    const input = submitted[0].input;
    return {
      spec: parseLeanDeckSpecValue(input),
      specChars: JSON.stringify(input).length,
    };
  }

  // Compatibility fallback for providers that silently drop native tool
  // declarations but still follow the explicit JSON-only prompt.
  const text = textFromContentBlocks(content);
  if (!text) {
    throw new ModelOutputError(
      "Lean Mode 模型没有返回 DeckSpec。",
      "invalid-json",
    );
  }
  return {
    spec: parseLeanDeckSpecText(text),
    specChars: text.length,
  };
}

function formatTokenCount(value: number | null): string {
  return value === null ? "未报告" : value.toLocaleString("zh-CN");
}

export class LeanPresentationService {
  private readonly pipeline: LeanV2Pipeline;
  private readonly visualReviewer: LeanCommercialVisualReviewer;

  constructor(
    private readonly gateway: AgentModelGateway,
    pipeline?: LeanV2Pipeline,
    visualReviewer?: LeanCommercialVisualReviewer,
  ) {
    const configuredGateway = gateway as AgentModelGateway & {
      getGatewayConfig?: () => AgentGatewayConfig;
    };
    this.pipeline = pipeline ?? new LeanV2Pipeline(
      new SearchCommercialAssetResolver(() => configuredGateway.getGatewayConfig?.()),
    );
    this.visualReviewer = visualReviewer ?? new LeanCommercialVisualReviewer(gateway);
  }

  /**
   * 将新建演示需求压缩为 DeckSpec v2，经过确定性编译与一次商业视觉复核，
   * 最终只返回命令提案；真实 Presentation 仍由 AgentService/CommitGate 提交。
   */
  async createProposal(input: {
    request: string;
    presentation: Presentation;
    model?: AgentModelSelection;
    designSystem?: DesignSystemV1;
    workspaceRoot?: string;
    signal?: AbortSignal;
  }): Promise<LeanPresentationProposal> {
    const request = input.request.trim();
    if (!isLeanStarterPresentation(input.presentation)) {
      throw new Error("Lean Mode v2 仅支持新建 PPT。请新建会话后再使用，已有正式稿不会被覆盖。");
    }
    if (request.length > LEAN_MAX_REQUEST_CHARS) {
      throw new Error(
        `Lean Mode v2 输入上限为 ${LEAN_MAX_REQUEST_CHARS.toLocaleString("zh-CN")} 字符；`
        + "请先提炼目标，或切换 Agent Mode 处理长材料。",
      );
    }
    if (input.signal?.aborted) {
      throw new Error("Lean Mode 生成已取消。");
    }

    const startedAt = Date.now();
    const response = await this.gateway.generateText({
      prompt: `用户需求：\n${request}\n\n${LEAN_SUBMISSION_CHECKLIST}`,
      systemPrompt: LEAN_SYSTEM_PROMPT,
      tools: [{
        name: LEAN_SUBMIT_TOOL_NAME,
        description:
          "Submit the complete DeckSpec v2 exactly once. The arguments are the final response.",
        inputSchema: toLeanOutputJsonSchema(),
      }],
      requiredToolName: LEAN_SUBMIT_TOOL_NAME,
      maxOutputTokens: LEAN_MAX_OUTPUT_TOKENS,
      signal: input.signal,
    }, input.model);

    const extracted = extractLeanDeckSpec(response.content);
    let spec = extracted.spec;

    let compiled = await this.pipeline.create({
      spec,
      basePresentation: input.presentation,
      designSystem: input.designSystem,
      workspaceRoot: input.workspaceRoot,
      signal: input.signal,
    });
    const pipelineRuns = [compiled];
    let visualReview: CommercialVisualReviewResult = await this.visualReviewer.review({
      spec,
      presentation: compiled.presentation,
      model: input.model,
      signal: input.signal,
    });
    if (visualReview.status === "revised" && visualReview.revisedSpec) {
      try {
        const revised = await this.pipeline.create({
          spec: visualReview.revisedSpec,
          basePresentation: input.presentation,
          designSystem: input.designSystem,
          workspaceRoot: input.workspaceRoot,
          signal: input.signal,
        });
        spec = visualReview.revisedSpec;
        compiled = revised;
        pipelineRuns.push(revised);
      } catch (error) {
        visualReview = {
          ...visualReview,
          status: "failed",
          rationale:
            `Visual revision was rejected; retained the first quality-gated deck. ${error instanceof Error ? error.message : String(error)}`,
          revisedSpec: undefined,
        };
      }
    }
    const usage = response.usage;
    const reviewUsage = visualReview.usage;
    const addUsage = (
      initial: number | undefined,
      review: number | undefined,
    ): number | null => {
      if (initial === undefined) return null;
      if (!visualReview.modelCallMade) return initial;
      return review === undefined ? null : initial + review;
    };
    const totalTiming = (key: keyof LeanV2PipelineResult["timings"]): number =>
      pipelineRuns.reduce((sum, run) => sum + run.timings[key], 0);
    const metrics: LeanRunMetrics = {
      mode: "lean",
      modelCalls: visualReview.modelCallMade ? 2 : 1,
      provider: response.provider,
      model: response.model,
      inputTokens: addUsage(usage?.inputTokens, reviewUsage?.inputTokens),
      outputTokens: addUsage(usage?.outputTokens, reviewUsage?.outputTokens),
      totalTokens: addUsage(usage?.totalTokens, reviewUsage?.totalTokens),
      cachedInputTokens: addUsage(usage?.cachedInputTokens, reviewUsage?.cachedInputTokens),
      durationMs: Date.now() - startedAt,
      compileDurationMs: totalTiming("compileDurationMs"),
      directorDurationMs: totalTiming("directorDurationMs"),
      assetResolutionDurationMs: totalTiming("assetResolutionDurationMs"),
      qualityDurationMs: totalTiming("qualityDurationMs"),
      assetRequestCount: compiled.plan.slides.reduce(
        (sum, slide) => sum + slide.assetRequests.length,
        0,
      ),
      resolvedAssetCount: compiled.manifest.assets.filter(
        (asset) => asset.status === "resolved",
      ).length,
      sceneCount: new Set(compiled.plan.slides.map((slide) => slide.sceneId)).size,
      commercialQualityScore: compiled.quality.scores.overall,
      canonicalHash: compiled.canonicalHash,
      visualReviewStatus: visualReview.status,
      visualReviewThumbnailCount: visualReview.thumbnailCount,
      visualReviewDurationMs: visualReview.durationMs,
      slideCount: spec.slides.length,
      requestChars: request.length,
      specChars: extracted.specChars,
    };

    return {
      spec,
      commands: compiled.commands,
      summary:
        `Lean Mode 已用 ${metrics.modelCalls} 次模型调用生成 ${spec.slides.length} 页商业 PPT，`
        + `共 ${formatTokenCount(metrics.totalTokens)} tokens，`
        + `耗时 ${(metrics.durationMs / 1_000).toFixed(1)} 秒。`,
      assumptions: [
        "Lean v2 不执行外部事实研究或多轮 Agent 编排。",
        "场景、版式、坐标、设计系统和元素 ID 均由本地确定性编译器生成。",
        "素材不可用时由确定性 fallback 场景降级，不触发第二次内容模型调用。",
        visualReview.status === "not-available"
          ? "当前运行环境无法生成 PNG，因此跳过视觉模型复盘。"
          : `已执行一次有边界的视觉复盘（${visualReview.status}，${visualReview.thumbnailCount} 张缩略图）。`,
        "示意数据会在对应页面显示“示意数据”，不会伪装为事实来源。",
      ],
      risk: "high",
      metrics,
    };
  }
}
