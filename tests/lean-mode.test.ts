import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DESIGN_PRESETS } from "../src/design-system";

import { CommitGate } from "../src/main/agent/gate/commit-gate";
import { RiskPolicy } from "../src/main/agent/gate/risk-policy";
import {
  LEAN_SYSTEM_PROMPT,
  LEAN_SUBMIT_TOOL_NAME,
  LeanPresentationService,
} from "../src/main/agent/lean/lean-presentation-service";
import {
  LeanCommercialVisualReviewer,
  selectCommercialReviewSlideIndices,
} from "../src/main/agent/lean/commercial-visual-review";
import { AgentService } from "../src/main/agent/service";
import { FileSessionStore } from "../src/main/session-store";
import { AgentRuntime } from "../src/main/agent/runtime/agent-runtime";
import { ToolRegistry } from "../src/main/agent/tools/tool-registry";
import type {
  AgentModelGateway,
  AgentModelRequest,
  AgentModelResponse,
  AgentModelStreamChunk,
} from "../src/main/agent/gateway/types";
import { CommandBus, executeCommand } from "../src/shared/commands";
import { agentRunRequestSchema } from "../src/shared/ipc";
import {
  compileLeanDeckSpec,
  leanDeckSpecSchema,
  type LeanDeckSpec,
  type LeanSlideSpec,
} from "../src/shared/lean-mode";
import {
  createStarterPresentation,
  presentationSchema,
} from "../src/shared/presentation";
import { migrateLeanDeckSpecV1ToV2 } from "../src/shared/lean/deck-spec-v2";

function slide(
  input: Pick<LeanSlideSpec, "kind" | "purpose" | "title"> & Partial<LeanSlideSpec>,
): LeanSlideSpec {
  return {
    kind: input.kind,
    purpose: input.purpose,
    title: input.title,
    subtitle: input.subtitle ?? "",
    items: input.items ?? [],
    left: input.left ?? null,
    right: input.right ?? null,
    steps: input.steps ?? [],
    metric: input.metric ?? null,
    chart: input.chart ?? null,
    sourceRefs: input.sourceRefs ?? [],
  };
}

function createSpec(): LeanDeckSpec {
  return {
    version: 1,
    title: "增长经营复盘",
    locale: "zh-CN",
    scenario: "internal-report",
    audience: "公司管理层",
    objective: "说明增长质量并确认下一阶段资源配置",
    desiredAction: "批准三项增长实验",
    durationMinutes: 12,
    designPreset: "business",
    sources: [{
      id: "forecast",
      label: "内部测算",
      asOf: "2026 Q2",
      provenance: "illustrative",
    }],
    slides: [
      slide({
        kind: "cover",
        purpose: "opening",
        title: "增长进入质量优先阶段",
        subtitle: "经营复盘与下一阶段行动建议",
      }),
      slide({
        kind: "bullets",
        purpose: "context",
        title: "规模增长仍在延续，但结构已经变化",
        items: [
          { heading: "客户结构", detail: "高价值客户贡献提升" },
          { heading: "渠道结构", detail: "自然流量成为主要增量" },
          { heading: "收入结构", detail: "续费收入占比继续提高" },
        ],
      }),
      slide({
        kind: "comparison",
        purpose: "insight",
        title: "增长逻辑从获客转向留存",
        left: {
          label: "过去",
          items: ["依赖投放", "关注新增", "短周期回收"],
        },
        right: {
          label: "现在",
          items: ["依赖产品价值", "关注留存", "长期复利"],
        },
      }),
      slide({
        kind: "metric",
        purpose: "proof",
        title: "续费提升是最确定的增长杠杆",
        metric: {
          value: "+18%",
          label: "续费收入提升空间",
          takeaway: "优先优化续费链路，比继续扩大投放更有效",
        },
        sourceRefs: ["forecast"],
      }),
      slide({
        kind: "process",
        purpose: "plan",
        title: "用三步验证增长假设",
        steps: [
          { heading: "聚焦", detail: "选择两个高价值客群" },
          { heading: "实验", detail: "上线分层续费方案" },
          { heading: "复盘", detail: "两周一次评估净收入留存" },
        ],
      }),
      slide({
        kind: "closing",
        purpose: "close",
        title: "下一阶段只做能验证的增长",
        subtitle: "把资源集中到留存与续费两个确定性杠杆",
        items: [
          { heading: "批准试验预算", detail: "" },
          { heading: "两周后复盘", detail: "" },
        ],
      }),
    ],
  };
}

type FakeResponseContent = AgentModelResponse["content"];

class FakeGateway implements AgentModelGateway {
  readonly requests: AgentModelRequest[] = [];

  constructor(
    private readonly response: string | FakeResponseContent = JSON.stringify(createSpec()),
  ) {}

  async generateText(request: AgentModelRequest): Promise<AgentModelResponse> {
    this.requests.push(request);
    return {
      provider: "openai",
      model: "test-model",
      content: typeof this.response === "string"
        ? [{ type: "text", text: this.response }]
        : this.response,
      usage: {
        inputTokens: 1_200,
        outputTokens: 800,
        totalTokens: 2_000,
        cachedInputTokens: 100,
      },
    };
  }

  async *generateTextStream(): AsyncIterable<AgentModelStreamChunk> {
    yield { type: "complete", content: [] };
  }
}

describe("Lean Mode", () => {
  it("selects an evenly distributed bounded thumbnail set", () => {
    expect(selectCommercialReviewSlideIndices(12)).toEqual([0, 2, 4, 7, 9, 11]);
    expect(selectCommercialReviewSlideIndices(3)).toEqual([0, 1, 2]);
  });

  it("performs at most one image-backed commercial visual review call", async () => {
    const gateway = new FakeGateway([{
      type: "tool_use",
      id: "review-1",
      name: "submit_commercial_visual_review",
      input: {
        verdict: "approve",
        rationale: "Hierarchy and cross-slide rhythm are delivery-ready.",
        revisions: [],
      },
    }]);
    const reviewer = new LeanCommercialVisualReviewer(gateway, {
      async captureSlide() {
        return {
          pngBase64: "AA==",
          width: 320,
          height: 180,
          mimeType: "image/png" as const,
        };
      },
    });
    const presentation = createStarterPresentation();
    const result = await reviewer.review({
      spec: migrateLeanDeckSpecV1ToV2(createSpec()),
      presentation,
    });

    expect(result).toMatchObject({
      status: "approved",
      thumbnailCount: 1,
      modelCallMade: true,
    });
    expect(gateway.requests).toHaveLength(1);
    expect(gateway.requests[0]?.messages?.[0]?.content).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "image", mediaType: "image/png" }),
    ]));
    expect(gateway.requests[0]?.requiredToolName).toBe("submit_commercial_visual_review");
  });

  it("applies visual-only revisions without changing slide content", async () => {
    const original = migrateLeanDeckSpecV1ToV2(createSpec());
    const gateway = new FakeGateway([{
      type: "tool_use",
      id: "review-2",
      name: "submit_commercial_visual_review",
      input: {
        verdict: "revise",
        rationale: "The opening needs a quieter composition.",
        revisions: [{
          slideIndex: 0,
          composition: "minimal-statement",
          imageMode: "none",
          assetBrief: "",
          emphasis: [original.slides[0]!.title],
        }],
      },
    }]);
    const reviewer = new LeanCommercialVisualReviewer(gateway, {
      async captureSlide() {
        return { pngBase64: "AA==", width: 320, height: 180, mimeType: "image/png" as const };
      },
    });
    const result = await reviewer.review({
      spec: original,
      presentation: createStarterPresentation(),
    });

    expect(result.status).toBe("revised");
    expect(result.revisedSpec?.slides[0]?.title).toBe(original.slides[0]!.title);
    expect(result.revisedSpec?.slides[0]?.items).toEqual(original.slides[0]!.items);
    expect(result.revisedSpec?.slides[0]?.visual.composition).toBe("minimal-statement");
  });

  it("defaults legacy Agent requests to Agent mode", () => {
    expect(agentRunRequestSchema.parse({
      prompt: "生成季度汇报",
      sessionId: "session-1",
    }).generationMode).toBe("agent");

    expect(agentRunRequestSchema.parse({
      prompt: "生成季度汇报",
      sessionId: "session-1",
      generationMode: "lean",
    }).generationMode).toBe("lean");
  });

  it("keeps provider instructions aligned with local cross-slide rules", () => {
    expect(LEAN_SYSTEM_PROMPT).toContain("9–12 页必须恰有一页 agenda");
    expect(LEAN_SYSTEM_PROMPT).toContain("10–12 页必须有 1–2 页 section");
    expect(LEAN_SYSTEM_PROMPT).toContain("两页 proof");
    expect(LEAN_SYSTEM_PROMPT).toContain("不得连续三页 bullets");
    expect(LEAN_SYSTEM_PROMPT).toContain("version 必须是数字 2");
    expect(LEAN_SYSTEM_PROMPT).toContain("字段名必须是 locale（不要 language）");
    expect(LEAN_SYSTEM_PROMPT).toContain("不要输出 body、agenda、bullets");
    expect(LEAN_SYSTEM_PROMPT).toContain("可取标题或正文的子串");
    expect(LEAN_SYSTEM_PROMPT).toContain("imageMode=none 时 assetBrief 必须是空字符串");
    expect(LEAN_SYSTEM_PROMPT).toContain("composition 只能是 full-bleed");
    expect(LEAN_SYSTEM_PROMPT).toContain("数值 14 应写 \"14\"");
    expect(LEAN_SYSTEM_PROMPT).toContain("coreMessage、presentationContext、afterUse");
    expect(LEAN_SYSTEM_PROMPT).toContain("restructurePermission 只能是 preserve、reorder、rewrite-and-merge");
    expect(LEAN_SYSTEM_PROMPT).toContain("每页 audienceMove 必须能回扣 objective 或 desiredAction");

    const base = createSpec();
    const extraSlides = [
      slide({
        kind: "bullets",
        purpose: "insight",
        title: "结构变化带来新的增长窗口",
        items: [
          { heading: "窗口一", detail: "高价值客户需求增强" },
          { heading: "窗口二", detail: "自然流量效率提升" },
        ],
      }),
      slide({
        kind: "comparison",
        purpose: "context",
        title: "两个客群的增长方式不同",
        left: { label: "成熟客群", items: ["重续费", "重服务"] },
        right: { label: "新兴客群", items: ["重激活", "重产品"] },
      }),
      slide({
        kind: "process",
        purpose: "plan",
        title: "实验按周推进",
        steps: [
          { heading: "设计", detail: "定义假设" },
          { heading: "上线", detail: "小流量验证" },
        ],
      }),
    ];
    const invalidNine = {
      ...base,
      slides: [
        ...base.slides.slice(0, -1),
        ...extraSlides,
        base.slides.at(-1)!,
      ],
    };
    const result = leanDeckSpecSchema.safeParse(invalidNine);
    expect(result.success).toBe(false);
    if (result.success) throw new Error("Expected nine-slide deck without agenda to fail.");
    expect(result.error.issues.some((issue) => issue.message.includes("agenda"))).toBe(true);
  });

  it("compiles one DeckSpec deterministically into a valid replacement deck", () => {
    const starter = createStarterPresentation();
    const first = compileLeanDeckSpec(createSpec(), starter);
    const second = compileLeanDeckSpec(createSpec(), starter);

    expect(presentationSchema.safeParse(first.presentation).success).toBe(true);
    expect(first.presentation).toEqual(second.presentation);
    expect(first.commands).toEqual(second.commands);
    expect(first.presentation.slides).toHaveLength(6);
    expect(first.presentation.slides.map((item) => item.layout)).toEqual([
      "cover",
      "concept",
      "comparison",
      "case",
      "process",
      "summary",
    ]);

    let staged = starter;
    for (const command of first.commands) {
      staged = executeCommand(staged, command).presentation;
    }
    expect(staged.title).toBe(first.presentation.title);
    expect(staged.designSystem).toEqual(first.presentation.designSystem);
    expect(staged.slides).toEqual(first.presentation.slides);
    expect(staged.slides.some((item) =>
      item.elements.some((element) =>
        element.type === "text" && element.text.includes("示意数据")
      )
    )).toBe(true);
  });

  it("passes the existing CommitGate and requires preview approval", async () => {
    const starter = createStarterPresentation();
    const compiled = compileLeanDeckSpec(createSpec(), starter);
    const result = await new CommitGate(new RiskPolicy()).evaluate(
      starter,
      compiled.commands,
      "high",
    );

    expect(result.success, result.errors.join("\n")).toBe(true);
    expect(result.preview?.slides).toHaveLength(6);
    expect(result.decision).toBe("REQUIRES_APPROVAL");
  });

  it.each(DESIGN_PRESETS)(
    "stays inside CommitGate boundaries with the $id design system",
    async (preset) => {
      const starter = createStarterPresentation();
      const compiled = compileLeanDeckSpec(createSpec(), starter, preset.system);
      const result = await new CommitGate(new RiskPolicy()).evaluate(
        starter,
        compiled.commands,
        "high",
      );

      expect(result.success, result.errors.join("\n")).toBe(true);
    },
  );

  it("persists direct approval and resumes it after service reconstruction", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "lean-approval-"));
    const starter = createStarterPresentation();
    const compiled = compileLeanDeckSpec(createSpec(), starter);
    const commandBus = new CommandBus(starter);
    const runtime = new AgentRuntime(new ToolRegistry(), new FakeGateway());
    const service = new AgentService(
      commandBus,
      runtime,
      new CommitGate(new RiskPolicy()),
      workspaceRoot,
    );

    const proposed = await service.submitDirectProposal({
      threadId: "lean-thread",
      request: "生成经营复盘",
      commands: compiled.commands,
      summary: "Lean 草稿已生成",
      assumptions: ["一次调用"],
      risk: "high",
    });
    expect(proposed.status).toBe("approval-required");
    expect(commandBus.getSnapshot().slides).toHaveLength(1);

    const restoredBus = new CommandBus(starter);
    const restoredService = new AgentService(
      restoredBus,
      new AgentRuntime(new ToolRegistry(), new FakeGateway()),
      new CommitGate(new RiskPolicy()),
      workspaceRoot,
    );
    const applied = await restoredService.resume("lean-thread", true);
    expect(applied.status).toBe("completed");
    expect(restoredBus.getSnapshot().slides).toHaveLength(6);
    expect(restoredBus.getSnapshot().title).toBe("增长经营复盘");
  });

  it("uses exactly one model request and reports provider token usage", async () => {
    const spec = createSpec();
    const gateway = new FakeGateway([{
      type: "tool_use",
      id: "lean-submit-1",
      name: LEAN_SUBMIT_TOOL_NAME,
      input: spec,
    }]);
    const service = new LeanPresentationService(gateway);
    const proposal = await service.createProposal({
      request: "给管理层做一份增长经营复盘",
      presentation: createStarterPresentation(),
      model: { provider: "openai", model: "test-model" },
    });

    expect(gateway.requests).toHaveLength(1);
    expect(gateway.requests[0].tools).toEqual([
      expect.objectContaining({ name: LEAN_SUBMIT_TOOL_NAME }),
    ]);
    expect(gateway.requests[0].requiredToolName).toBe(LEAN_SUBMIT_TOOL_NAME);
    expect(gateway.requests[0].messages).toBeUndefined();
    expect(gateway.requests[0].outputFormat).toBeUndefined();
    expect(gateway.requests[0].prompt).toContain(
      "closing/close 不能代替 ask",
    );
    expect(gateway.requests[0].tools?.[0]?.inputSchema).toMatchObject({
      properties: {
        slides: {
          description: expect.stringContaining(
            "closing/close does not satisfy ask",
          ),
        },
      },
    });
    expect(proposal.metrics).toMatchObject({
      mode: "lean",
      modelCalls: 1,
      inputTokens: 1_200,
      outputTokens: 800,
      totalTokens: 2_000,
      slideCount: 6,
    });
  });

  it("normalizes the observed version and language aliases without another model call", async () => {
    const payload: Record<string, unknown> = {
      ...createSpec(),
      version: "1",
      language: "zh-CN",
    };
    delete payload.locale;
    const gateway = new FakeGateway(JSON.stringify(payload));
    const service = new LeanPresentationService(gateway);

    const proposal = await service.createProposal({
      request: "生成一份经营复盘",
      presentation: createStarterPresentation(),
    });

    expect(gateway.requests).toHaveLength(1);
    expect(proposal.spec.version).toBe(2);
    expect(proposal.spec.locale).toBe("zh-CN");
  });

  it("drops an unused asset brief when image mode is none without another model call", async () => {
    const spec = migrateLeanDeckSpecV1ToV2(createSpec());
    spec.slides[2]!.visual.assetBrief = "这段图片说明不会被使用";
    spec.slides[5]!.visual.assetBrief = "另一段不会被使用的图片说明";
    const gateway = new FakeGateway(JSON.stringify(spec));
    const service = new LeanPresentationService(gateway);

    const proposal = await service.createProposal({
      request: "生成一份经营复盘",
      presentation: createStarterPresentation(),
    });

    expect(gateway.requests).toHaveLength(1);
    expect(proposal.spec.slides[2]?.visual).toMatchObject({
      imageMode: "none",
      assetBrief: "",
    });
    expect(proposal.spec.slides[5]?.visual).toMatchObject({
      imageMode: "none",
      assetBrief: "",
    });
  });

  it("normalizes a composition alias and equivalent numeric emphasis without another model call", async () => {
    const spec = migrateLeanDeckSpecV1ToV2(createSpec());
    spec.slides[3]!.metric!.value = "14";
    const payload = structuredClone(spec) as unknown as {
      slides: Array<{ visual: { composition: string; emphasis: string[] } }>;
    };
    payload.slides[3]!.visual.composition = "dashboard";
    payload.slides[3]!.visual.emphasis = ["续费", "14.0"];
    const gateway = new FakeGateway(JSON.stringify(payload));
    const service = new LeanPresentationService(gateway);

    const proposal = await service.createProposal({
      request: "生成一份经营复盘",
      presentation: createStarterPresentation(),
    });

    expect(gateway.requests).toHaveLength(1);
    expect(proposal.spec.slides[3]?.visual).toMatchObject({
      composition: "metric-story",
      emphasis: ["续费", "14"],
    });
  });

  it("caps excessive native tool emphasis hints without another model call", async () => {
    const spec = migrateLeanDeckSpecV1ToV2(createSpec());
    const payload = structuredClone(spec) as unknown as {
      slides: Array<{ visual: { emphasis: string[] } }>;
    };
    payload.slides[1]!.visual.emphasis = [
      "规模增长",
      "客户结构",
      "高价值客户",
      "渠道结构",
      "自然流量",
    ];
    const gateway = new FakeGateway([{
      type: "tool_use",
      id: "lean-submit-excessive-emphasis",
      name: LEAN_SUBMIT_TOOL_NAME,
      input: payload,
    }]);
    const service = new LeanPresentationService(gateway);

    const proposal = await service.createProposal({
      request: "给管理层做一份增长经营复盘",
      presentation: createStarterPresentation(),
    });

    expect(gateway.requests).toHaveLength(1);
    expect(proposal.spec.slides[1]?.visual.emphasis).toEqual([
      "规模增长",
      "客户结构",
      "高价值客户",
    ]);
  });

  it("fills omitted neutral slide fields without another model call", async () => {
    const spec = migrateLeanDeckSpecV1ToV2(createSpec());
    const payload = structuredClone(spec) as unknown as {
      sources: Array<{ asOf?: string | null }>;
      slides: Array<Record<string, unknown>>;
    };
    delete payload.sources[0]!.asOf;
    delete payload.slides[3]!.subtitle;
    delete payload.slides[3]!.items;
    delete payload.slides[3]!.left;
    delete payload.slides[3]!.right;
    delete payload.slides[3]!.steps;
    delete payload.slides[3]!.chart;
    const gateway = new FakeGateway(JSON.stringify(payload));
    const service = new LeanPresentationService(gateway);

    const proposal = await service.createProposal({
      request: "生成一份经营复盘",
      presentation: createStarterPresentation(),
    });

    expect(gateway.requests).toHaveLength(1);
    expect(proposal.spec.sources[0]?.asOf).toBeNull();
    expect(proposal.spec.slides[3]).toMatchObject({
      subtitle: "",
      items: [],
      left: null,
      right: null,
      steps: [],
      chart: null,
    });
  });

  it("still rejects an omitted field that is semantically required by the slide kind", async () => {
    const spec = migrateLeanDeckSpecV1ToV2(createSpec());
    const payload = structuredClone(spec) as unknown as {
      slides: Array<Record<string, unknown>>;
    };
    delete payload.slides[1]!.items;
    const gateway = new FakeGateway(JSON.stringify(payload));
    const service = new LeanPresentationService(gateway);

    await expect(service.createProposal({
      request: "生成一份经营复盘",
      presentation: createStarterPresentation(),
    })).rejects.toThrow("Bullets requires 2 to 4 items");
    expect(gateway.requests).toHaveLength(1);
  });

  it("keeps unknown fields strict after compatibility normalization", async () => {
    const gateway = new FakeGateway(JSON.stringify({
      ...createSpec(),
      unexpected: true,
    }));
    const service = new LeanPresentationService(gateway);

    await expect(service.createProposal({
      request: "生成一份经营复盘",
      presentation: createStarterPresentation(),
    })).rejects.toThrow("Lean DeckSpec 校验失败");
    expect(gateway.requests).toHaveLength(1);
  });

  it("rejects conflicting locale aliases without another model call", async () => {
    const gateway = new FakeGateway(JSON.stringify({
      ...createSpec(),
      language: "en-US",
    }));
    const service = new LeanPresentationService(gateway);

    await expect(service.createProposal({
      request: "生成一份经营复盘",
      presentation: createStarterPresentation(),
    })).rejects.toThrow("Lean DeckSpec 校验失败");
    expect(gateway.requests).toHaveLength(1);
  });

  it("does not spend a second model call repairing invalid structured output", async () => {
    const gateway = new FakeGateway('{"version":1}');
    const service = new LeanPresentationService(gateway);

    await expect(service.createProposal({
      request: "生成一份经营复盘",
      presentation: createStarterPresentation(),
    })).rejects.toThrow("不会自动重试");
    expect(gateway.requests).toHaveLength(1);
  });

  it("persists Lean metrics in the authoritative assistant message", async () => {
    const directory = await mkdtemp(join(tmpdir(), "lean-session-metrics-"));
    const store = new FileSessionStore(
      join(directory, "conversations.sqlite"),
      join(directory, "projects"),
    );
    try {
      await store.initialize();
      const created = await store.createSession({ title: "Lean metrics" });
      const sessionId = created.activeSession!.session.id;
      await store.saveMessages(sessionId, [{
        id: "lean-placeholder",
        role: "assistant",
        content: "",
        threadId: "lean-run",
      }]);
      await store.finalizeAgentRunMessage(sessionId, "lean-run", {
        status: "approval-required",
        approval: {
          threadId: "lean-run",
          summary: "Lean Mode 已生成",
          commands: [],
          risk: "high",
        },
        leanMetrics: {
          mode: "lean",
          modelCalls: 1,
          provider: "openai",
          model: "test",
          inputTokens: 1_200,
          outputTokens: 800,
          totalTokens: 2_000,
          cachedInputTokens: 100,
          durationMs: 2_500,
          compileDurationMs: 12,
          slideCount: 6,
          requestChars: 12,
          specChars: 3_000,
        },
      });

      const content = store.getSession(sessionId).messages.at(-1)?.content ?? "";
      expect(content).toContain("1 次模型调用");
      expect(content).toContain("2,000 tokens");
      expect(content).toContain("2.5 秒");
    } finally {
      store.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects an existing formal deck before spending a model call", async () => {
    const gateway = new FakeGateway();
    const service = new LeanPresentationService(gateway);
    const existing = createStarterPresentation();
    existing.slides[0] = {
      ...existing.slides[0],
      title: "正式汇报",
    };

    await expect(service.createProposal({
      request: "重做这份汇报",
      presentation: existing,
    })).rejects.toThrow("仅支持新建 PPT");
    expect(gateway.requests).toHaveLength(0);
  });
});
