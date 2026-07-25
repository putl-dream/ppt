import { z } from "zod";

import { designSystemV2Schema } from "@design-system";
import { DESIGN_DIRECTION_TIERS } from "./design-capability";

export const DESIGN_SELECTION_SOURCES = [
  "recommended-spectrum",
  "user-locked",
] as const;

export const communicationContractSchema = z.object({
  audience: z.string().trim().min(1).max(160),
  objective: z.string().trim().min(1).max(200),
  desiredOutcome: z.string().trim().min(1).max(200),
  coreMessage: z.string().trim().min(1).max(240),
  deliveryContext: z.string().trim().min(1).max(160),
  afterUse: z.string().trim().min(1).max(160),
}).strict();

export const designDirectionSchema = z.object({
  id: z.string().trim().min(1).max(80),
  tier: z.enum([...DESIGN_DIRECTION_TIERS, "locked"]),
  label: z.string().trim().min(1).max(80),
  rationale: z.string().trim().min(1).max(500),
  designSystem: designSystemV2Schema,
}).strict();

export const confirmedDesignSelectionBaseSchema = z.object({
  version: z.literal(2),
  communicationContract: communicationContractSchema,
  selectionSource: z.enum(DESIGN_SELECTION_SOURCES),
  directions: z.array(designDirectionSchema).min(1).max(3),
  selectedDirectionId: z.string().trim().min(1).max(80),
}).strict();

export const designPlanCandidateBaseSchema = z.object({
  version: z.literal(2),
  communicationContract: communicationContractSchema,
  selectionSource: z.enum(DESIGN_SELECTION_SOURCES),
  directions: z.array(designDirectionSchema).min(1).max(3),
  recommendedDirectionId: z.string().trim().min(1).max(80),
}).strict();

type DirectionSelection = {
  selectionSource: (typeof DESIGN_SELECTION_SOURCES)[number];
  directions: DesignDirection[];
};

export function validateDesignDirectionSelection(
  selection: DirectionSelection,
  referencedDirectionId: string,
  context: z.RefinementCtx,
  referencePath: "selectedDirectionId" | "recommendedDirectionId",
): void {
  const ids = selection.directions.map((direction) => direction.id);
  if (new Set(ids).size !== ids.length) {
    context.addIssue({
      code: "custom",
      path: ["directions"],
      message: "Design direction ids must be unique.",
    });
  }
  if (!ids.includes(referencedDirectionId)) {
    context.addIssue({
      code: "custom",
      path: [referencePath],
      message: `${referencePath} must reference one of directions[].id.`,
    });
  }

  if (selection.selectionSource === "user-locked") {
    if (selection.directions.length !== 1 || selection.directions[0]?.tier !== "locked") {
      context.addIssue({
        code: "custom",
        path: ["directions"],
        message: "A user-locked selection must contain exactly one locked direction.",
      });
    }
    return;
  }

  const expected = new Set(DESIGN_DIRECTION_TIERS);
  const actual = new Set(selection.directions.map((direction) => direction.tier));
  if (
    selection.directions.length !== DESIGN_DIRECTION_TIERS.length
    || actual.size !== expected.size
    || [...expected].some((tier) => !actual.has(tier))
  ) {
    context.addIssue({
      code: "custom",
      path: ["directions"],
      message: "A recommended spectrum must contain exactly safe, shifted, and bold directions.",
    });
  }

  const visualStyles = new Set(
    selection.directions.map((direction) => direction.designSystem.visualStyle),
  );
  if (visualStyles.size !== DESIGN_DIRECTION_TIERS.length) {
    context.addIssue({
      code: "custom",
      path: ["directions"],
      message: "Safe, shifted, and bold directions must use three distinct visual styles.",
    });
  }

  const argumentModes = new Set(
    selection.directions.map((direction) => direction.designSystem.argumentMode),
  );
  if (argumentModes.size !== 1) {
    context.addIssue({
      code: "custom",
      path: ["directions"],
      message: "Argument mode must stay fixed across visual directions.",
    });
  }

  const readingModes = new Set(
    selection.directions.map((direction) => direction.designSystem.readingMode),
  );
  if (readingModes.size !== 1) {
    context.addIssue({
      code: "custom",
      path: ["directions"],
      message: "Reading mode must stay fixed across visual directions.",
    });
  }
}

export const confirmedDesignSelectionSchema = confirmedDesignSelectionBaseSchema.superRefine(
  (selection, context) => validateDesignDirectionSelection(
    selection,
    selection.selectedDirectionId,
    context,
    "selectedDirectionId",
  ),
);

export const designPlanCandidateSchema = designPlanCandidateBaseSchema.superRefine(
  (selection, context) => validateDesignDirectionSelection(
    selection,
    selection.recommendedDirectionId,
    context,
    "recommendedDirectionId",
  ),
);

export type CommunicationContract = z.infer<typeof communicationContractSchema>;
export type DesignDirection = z.infer<typeof designDirectionSchema>;
export type ConfirmedDesignSelection = z.infer<typeof confirmedDesignSelectionSchema>;
export type DesignPlanCandidate = z.infer<typeof designPlanCandidateSchema>;

export function getSelectedDesignDirection(
  selection: ConfirmedDesignSelection,
): DesignDirection {
  const selected = selection.directions.find(
    (direction) => direction.id === selection.selectedDirectionId,
  );
  if (!selected) {
    throw new Error(`Selected design direction '${selection.selectedDirectionId}' was not found.`);
  }
  return selected;
}
