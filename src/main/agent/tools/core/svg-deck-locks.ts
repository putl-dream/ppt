import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import {
  ARGUMENT_MODES,
  READING_MODES,
  VISUAL_STYLES,
  designSystemV2Schema,
} from "@design-system";
import type { ToolContext } from "../tool-definition";
import { normalizeWorkspaceSvgPath } from "../../../deck/svg-page-loader";

export const SVG_DECK_DESIGN_SPEC_PATH = "design/design-spec.json";
export const SVG_DECK_PAGE_PLAN_PATH = "slides/page-plan.json";

const MAX_SVG_DECK_LOCK_BYTES = 1024 * 1024;

export const communicationContractSchema = z.object({
  audience: z.string().trim().min(1).max(1_000),
  objective: z.string().trim().min(1).max(1_000),
  desiredOutcome: z.string().trim().min(1).max(1_000),
  coreMessage: z.string().trim().min(1).max(2_000),
  deliveryContext: z.string().trim().min(1).max(1_000),
  afterUse: z.string().trim().min(1).max(1_000),
}).strict();

export const svgDeckDesignSpecSchema = z.object({
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

export const svgDeckPagePlanSchema = z.object({
  version: z.literal(1),
  designSpec: z.literal(SVG_DECK_DESIGN_SPEC_PATH),
  slides: z.array(svgDeckPagePlanSlideSchema).min(1).max(100),
}).passthrough();

export type SvgDeckDesignSpec = z.infer<typeof svgDeckDesignSpecSchema>;
export type SvgDeckPagePlan = z.infer<typeof svgDeckPagePlanSchema>;

export async function readSvgDeckLocks(
  fileService: NonNullable<ToolContext["fileService"]>,
  caller = "SubmitSvgDeck",
): Promise<{
  designSpec: SvgDeckDesignSpec;
  pagePlan: SvgDeckPagePlan;
}> {
  // Keep canonical validation order so malformed design intent is reported
  // before the downstream page plan.
  const designSpec = await readSvgDeckLock(
    fileService,
    SVG_DECK_DESIGN_SPEC_PATH,
    svgDeckDesignSpecSchema,
    caller,
  );
  const pagePlan = await readSvgDeckLock(
    fileService,
    SVG_DECK_PAGE_PLAN_PATH,
    svgDeckPagePlanSchema,
    caller,
  );
  return { designSpec, pagePlan };
}

export function assertSvgDeckLocksMatchSubmission<
  T extends {
    communication: z.infer<typeof communicationContractSchema>;
    designSystem: z.infer<typeof designSystemV2Schema>;
    slides: Array<{
      id: string;
      path: string;
      narrative: {
        role: string;
        coreMessage: string;
        audienceMove: string;
        rhythm: string;
        layoutIntent: string;
      };
    }>;
  },
>(
  args: T,
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
  if (!isDeepStrictEqual(args.designSystem, designSpec.presentationDesignSystem)) {
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

async function readSvgDeckLock<T>(
  fileService: NonNullable<ToolContext["fileService"]>,
  path: string,
  schema: z.ZodType<T>,
  caller: string,
): Promise<T> {
  let content: string;
  try {
    content = (await fileService.read(path, {
      maxBytes: MAX_SVG_DECK_LOCK_BYTES,
    })).content;
  } catch (error) {
    throw new Error(
      `${caller} requires readable lock file ${path}: ${errorMessage(error)}`,
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

function formatIssuePath(path: PropertyKey[]): string {
  if (path.length === 0) return "<root>";
  return path.map((segment) =>
    typeof segment === "number" ? `[${segment}]` : String(segment)
  ).join(".");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
