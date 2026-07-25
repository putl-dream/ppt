import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import {
  ARGUMENT_MODES,
  READING_MODES,
  VISUAL_STYLES,
  designSystemV2Schema,
} from "@design-system";
import type { PresentationCommand } from "@shared/commands";
import { slideNarrativeSchema, type Slide } from "@shared/presentation";
import { assertValidSvgPage } from "@shared/svg-page";
import {
  hasSvgPagePreviewReceipt,
  loadWorkspaceSvgPage,
  normalizeWorkspaceSvgPath,
} from "../../../deck/svg-page-loader";
import {
  agentCommandProposalResultSchema,
  type AgentCommandProposalResult,
} from "../../runtime/runtime-types";
import type { ToolContext, ToolDefinition } from "../tool-definition";
import { assumptionsSchema } from "./submit-commands";

export const MAX_HYDRATED_SVG_DECK_BYTES = 128 * 1024 * 1024;
export const SVG_DECK_DESIGN_SPEC_PATH = "design/design-spec.json";
export const SVG_DECK_PAGE_PLAN_PATH = "slides/page-plan.json";

const MAX_SVG_DECK_LOCK_BYTES = 1024 * 1024;

const communicationContractSchema = z.object({
  audience: z.string().trim().min(1).max(1_000),
  objective: z.string().trim().min(1).max(1_000),
  desiredOutcome: z.string().trim().min(1).max(1_000),
  coreMessage: z.string().trim().min(1).max(2_000),
  deliveryContext: z.string().trim().min(1).max(1_000),
  afterUse: z.string().trim().min(1).max(1_000),
}).strict();

const svgDeckDesignSpecSchema = z.object({
  version: z.literal(1),
  canvas: z.object({
    width: z.literal(1280),
    height: z.literal(720),
  }).strict(),
  communicationContract: communicationContractSchema,
  presentationDesignSystem: designSystemV2Schema,
  argumentMode: z.enum(ARGUMENT_MODES),
  visualStyle: z.object({
    id: z.enum(VISUAL_STYLES),
  }).passthrough(),
  readingMode: z.enum(READING_MODES),
}).passthrough().superRefine((spec, context) => {
  if (spec.argumentMode !== spec.presentationDesignSystem.argumentMode) {
    context.addIssue({
      code: "custom",
      path: ["argumentMode"],
      message: "argumentMode must match presentationDesignSystem.argumentMode.",
    });
  }
  if (spec.visualStyle.id !== spec.presentationDesignSystem.visualStyle) {
    context.addIssue({
      code: "custom",
      path: ["visualStyle", "id"],
      message: "visualStyle.id must match presentationDesignSystem.visualStyle.",
    });
  }
  if (spec.readingMode !== spec.presentationDesignSystem.readingMode) {
    context.addIssue({
      code: "custom",
      path: ["readingMode"],
      message: "readingMode must match presentationDesignSystem.readingMode.",
    });
  }
});

const finalCopySchema = z.union([
  z.string(),
  z.array(z.unknown()),
  z.record(z.string(), z.unknown()),
]);

const svgDeckPagePlanSlideSchema = z.object({
  id: z.string().trim().min(1).max(80),
  path: z.string().trim().min(1),
  narrativeRole: z.string().trim().min(1).max(80),
  finalCopy: finalCopySchema,
  coreMessage: z.string().trim().min(1).max(1_000),
  audienceMove: z.string().trim().min(1).max(1_000),
  rhythm: z.enum(["anchor", "dense", "breathing"]),
  layoutIntent: z.string().trim().min(1).max(2_000),
}).passthrough();

const svgDeckPagePlanSchema = z.object({
  version: z.literal(1),
  designSpec: z.literal(SVG_DECK_DESIGN_SPEC_PATH),
  slides: z.array(svgDeckPagePlanSlideSchema).min(1).max(100),
}).passthrough();

const submitSvgSlideSchema = z.object({
  id: z.string().trim().min(1).max(80),
  title: z.string().trim().min(1).max(500),
  path: z.string().trim().min(1).describe(
    "Workspace-relative path to a complete 1280x720 SVG page, for example slides/svg/P01.svg.",
  ),
  speakerNotes: z.string().trim().max(20_000).optional(),
  narrative: slideNarrativeSchema,
}).strict();

export const submitSvgDeckSchema = z.object({
  title: z.string().trim().min(1).max(500),
  designSpecPath: z.literal(SVG_DECK_DESIGN_SPEC_PATH),
  pagePlanPath: z.literal(SVG_DECK_PAGE_PLAN_PATH),
  communication: communicationContractSchema,
  designSystem: designSystemV2Schema,
  slides: z.array(submitSvgSlideSchema).min(1).max(100),
  summary: z.string().trim().min(1),
  risk: z.enum(["low", "medium", "high"]).default("medium"),
  assumptions: assumptionsSchema,
}).strict().superRefine((deck, context) => {
  const paths = new Set<string>();
  const ids = new Set<string>();
  deck.slides.forEach((slide, index) => {
    let normalizedPath: string;
    try {
      normalizedPath = normalizeWorkspaceSvgPath(slide.path);
    } catch (error) {
      context.addIssue({
        code: "custom",
        path: ["slides", index, "path"],
        message: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    if (paths.has(normalizedPath)) {
      context.addIssue({
        code: "custom",
        path: ["slides", index, "path"],
        message: `Duplicate SVG page path: ${slide.path}`,
      });
    }
    paths.add(normalizedPath);
    if (slide.id && ids.has(slide.id)) {
      context.addIssue({
        code: "custom",
        path: ["slides", index, "id"],
        message: `Duplicate slide id: ${slide.id}`,
      });
    }
    if (slide.id) ids.add(slide.id);
  });
});

/**
 * Terminal creation boundary for the SVG-native deck pipeline.
 *
 * The model authors one complete page per workspace SVG file. This tool
 * localizes raster dependencies, validates the resulting self-contained SVG,
 * and proposes replacing the current deck with those exact page sources.
 */
export const submitSvgDeckTool: ToolDefinition<
  typeof submitSvgDeckSchema,
  AgentCommandProposalResult
> = {
  name: "SubmitSvgDeck",
  description:
    "新建或重做整套 PPT 的唯一 SVG-native 提交入口。先用 WriteFile 写完整页面 SVG，"
    + "逐页用 PreviewSvgPage 成功渲染当前版本，再传入有序路径；工具会验证每页预览凭据、"
    + `强制读取 ${SVG_DECK_DESIGN_SPEC_PATH} 与 ${SVG_DECK_PAGE_PLAN_PATH} 并核对提交参数，`
    + "内联本地图片、严格校验，并用同一 SVG 建立预览与导出所需的 Command Proposal。",
  category: "core",
  loadPolicy: "core",
  inputSchema: submitSvgDeckSchema,
  outputSchema: agentCommandProposalResultSchema,
  isEnabled: (context) => Boolean(context.workspaceRoot && context.fileService),
  behavior: {
    capabilities: ["command_proposal"],
    completion: {
      terminalResult: "command_proposal",
      expectation: "always",
      exclusiveBatch: true,
    },
    visualReview: { mode: "tool-managed" },
  },
  risk: "low",
  execute: async (args, context) => {
    if (!context.workspaceRoot || !context.fileService) {
      throw new Error("SubmitSvgDeck requires a configured workspace.");
    }
    const designSpec = await readSvgDeckLock(
      context.fileService,
      args.designSpecPath,
      svgDeckDesignSpecSchema,
    );
    const pagePlan = await readSvgDeckLock(
      context.fileService,
      args.pagePlanPath,
      svgDeckPagePlanSchema,
    );
    assertSvgDeckLocksMatchSubmission(args, designSpec, pagePlan);

    const committedPageKeys = new Set(
      context.presentation.slides.flatMap((slide) =>
        slide.visualSource?.kind === "svg"
          ? [`${slide.visualSource.sourcePath}\0${slide.visualSource.sha256}`]
          : []
      ),
    );
    const slides: Slide[] = [];
    let hydratedDeckBytes = 0;
    for (const [index, input] of args.slides.entries()) {
      const hydrated = await loadWorkspaceSvgPage({
        requestedPath: input.path,
        workspaceRoot: context.workspaceRoot,
        fileService: context.fileService,
      });
      hydratedDeckBytes += hydrated.byteSize;
      if (hydratedDeckBytes > MAX_HYDRATED_SVG_DECK_BYTES) {
        throw new Error(
          `Hydrated SVG deck exceeds ${MAX_HYDRATED_SVG_DECK_BYTES} bytes. `
          + "Reduce embedded raster size or split the presentation.",
        );
      }
      assertValidSvgPage(hydrated.markup);
      const alreadyCommitted = committedPageKeys.has(
        `${hydrated.sourcePath}\0${hydrated.sha256}`,
      );
      if (
        !alreadyCommitted
        && !hasSvgPagePreviewReceipt(context.fileService, hydrated)
      ) {
        const pageLabel = `P${String(index + 1).padStart(2, "0")}`;
        throw new Error(
          `${pageLabel} preview gate is missing or stale for ${hydrated.sourcePath}. `
          + "Call PreviewSvgPage with includeThumbnail=true, inspect the rendered page, "
          + "and retry without changing that SVG afterward.",
        );
      }
      slides.push({
        id: input.id,
        title: input.title,
        speakerNotes: input.speakerNotes,
        elements: [],
        visualSource: {
          kind: "svg" as const,
          markup: hydrated.markup,
          width: 1280 as const,
          height: 720 as const,
          sha256: hydrated.sha256,
          sourcePath: hydrated.sourcePath,
          resources: hydrated.resources,
        },
        narrative: input.narrative,
      });
    }

    const commands: PresentationCommand[] = [
      ...context.presentation.slides.map((slide) => ({
        id: crypto.randomUUID(),
        type: "remove-slide" as const,
        slideId: slide.id,
      })),
      {
        id: crypto.randomUUID(),
        type: "set-presentation-title",
        title: args.title,
      },
      {
        id: crypto.randomUUID(),
        type: "set-design-system",
        designSystem: args.designSystem,
      },
      ...slides.map((slide, index) => ({
        id: crypto.randomUUID(),
        type: "add-slide" as const,
        slide,
        index,
      })),
    ];

    return {
      type: "command_proposal",
      summary: args.summary,
      commands,
      risk: args.risk,
      assumptions: [
        ...(args.assumptions ?? []),
        `Communication contract — audience: ${args.communication.audience}; `
          + `objective: ${args.communication.objective}; desired outcome: ${args.communication.desiredOutcome}; `
          + `core message: ${args.communication.coreMessage}; delivery: ${args.communication.deliveryContext}; `
          + `after-use: ${args.communication.afterUse}.`,
      ],
    };
  },
};

type SubmitSvgDeckArgs = z.infer<typeof submitSvgDeckSchema>;
type SvgDeckDesignSpec = z.infer<typeof svgDeckDesignSpecSchema>;
type SvgDeckPagePlan = z.infer<typeof svgDeckPagePlanSchema>;

async function readSvgDeckLock<T>(
  fileService: NonNullable<ToolContext["fileService"]>,
  path: string,
  schema: z.ZodType<T>,
): Promise<T> {
  let content: string;
  try {
    content = (await fileService.read(path, {
      maxBytes: MAX_SVG_DECK_LOCK_BYTES,
    })).content;
  } catch (error) {
    throw new Error(
      `SubmitSvgDeck requires readable lock file ${path}: ${errorMessage(error)}`,
    );
  }

  let source: unknown;
  try {
    source = JSON.parse(content);
  } catch (error) {
    throw new Error(`${path} must contain valid JSON: ${errorMessage(error)}`);
  }
  const result = schema.safeParse(source);
  if (!result.success) {
    const details = result.error.issues
      .slice(0, 12)
      .map((issue) => `${formatIssuePath(issue.path)}: ${issue.message}`)
      .join("; ");
    throw new Error(`${path} does not satisfy the SVG deck lock schema: ${details}`);
  }
  return result.data;
}

function assertSvgDeckLocksMatchSubmission(
  args: SubmitSvgDeckArgs,
  designSpec: SvgDeckDesignSpec,
  pagePlan: SvgDeckPagePlan,
): void {
  for (const key of Object.keys(
    designSpec.communicationContract,
  ) as Array<keyof typeof designSpec.communicationContract>) {
    if (args.communication[key] !== designSpec.communicationContract[key]) {
      throw new Error(
        `SubmitSvgDeck communication.${key} must exactly match `
        + `${SVG_DECK_DESIGN_SPEC_PATH}.communicationContract.${key}.`,
      );
    }
  }

  for (const axis of ["argumentMode", "visualStyle", "readingMode"] as const) {
    if (args.designSystem[axis] !== designSpec.presentationDesignSystem[axis]) {
      throw new Error(
        `SubmitSvgDeck designSystem.${axis} must exactly match `
        + `${SVG_DECK_DESIGN_SPEC_PATH}.presentationDesignSystem.${axis}.`,
      );
    }
  }
  if (
    !isDeepStrictEqual(
      args.designSystem,
      designSpec.presentationDesignSystem,
    )
  ) {
    throw new Error(
      `SubmitSvgDeck designSystem must exactly match `
      + `${SVG_DECK_DESIGN_SPEC_PATH}.presentationDesignSystem.`,
    );
  }

  if (args.slides.length !== pagePlan.slides.length) {
    throw new Error(
      `SubmitSvgDeck slides must contain exactly ${pagePlan.slides.length} page(s) `
      + `in ${SVG_DECK_PAGE_PLAN_PATH} order; received ${args.slides.length}.`,
    );
  }

  const narrativeKeys = [
    "role",
    "coreMessage",
    "audienceMove",
    "rhythm",
    "layoutIntent",
  ] as const;
  args.slides.forEach((slide, index) => {
    const planned = pagePlan.slides[index];
    if (!planned) return;
    const pageLabel = `slides[${index}]`;
    if (slide.id !== planned.id) {
      throw new Error(
        `SubmitSvgDeck ${pageLabel}.id must exactly match `
        + `${SVG_DECK_PAGE_PLAN_PATH}.slides[${index}].id (${planned.id}).`,
      );
    }
    let submittedPath: string;
    let plannedPath: string;
    try {
      submittedPath = normalizeWorkspaceSvgPath(slide.path);
      plannedPath = normalizeWorkspaceSvgPath(planned.path);
    } catch (error) {
      throw new Error(
        `${SVG_DECK_PAGE_PLAN_PATH}.slides[${index}].path is invalid: ${errorMessage(error)}`,
      );
    }
    if (submittedPath !== plannedPath) {
      throw new Error(
        `SubmitSvgDeck ${pageLabel}.path must exactly match `
        + `${SVG_DECK_PAGE_PLAN_PATH}.slides[${index}].path (${plannedPath}).`,
      );
    }

    const plannedNarrative = {
      role: planned.narrativeRole,
      coreMessage: planned.coreMessage,
      audienceMove: planned.audienceMove,
      rhythm: planned.rhythm,
      layoutIntent: planned.layoutIntent,
    };
    for (const key of narrativeKeys) {
      if (slide.narrative[key] !== plannedNarrative[key]) {
        const planKey = key === "role" ? "narrativeRole" : key;
        throw new Error(
          `SubmitSvgDeck ${pageLabel}.narrative.${key} must exactly match `
          + `${SVG_DECK_PAGE_PLAN_PATH}.slides[${index}].${planKey}.`,
        );
      }
    }
  });
}

function formatIssuePath(path: PropertyKey[]): string {
  if (path.length === 0) return "<root>";
  return path.map((segment) =>
    typeof segment === "number" ? `[${segment}]` : String(segment)
  ).join(".");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
