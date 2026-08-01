import type { DesignSystemV2 } from "@design-system";
import {
  confirmedDesignSelectionSchema,
  getSelectedDesignDirection,
  type CommunicationContract,
  type ConfirmedDesignSelection,
  type DesignPlanCandidate,
} from "./design-plan";

export const layoutChoiceSchema = confirmedDesignSelectionSchema;
export type LayoutChoice = ConfirmedDesignSelection;

export function confirmDesignPlan(
  candidate: DesignPlanCandidate,
  selectedDirectionId: string,
): LayoutChoice {
  return layoutChoiceSchema.parse({
    version: 2,
    communicationContract: candidate.communicationContract,
    selectionSource: candidate.selectionSource,
    directions: candidate.directions,
    selectedDirectionId,
  });
}

export function createLockedLayoutChoice(
  communicationContract: CommunicationContract,
  designSystem: DesignSystemV2,
  rationale = "用户已在设计设置中明确锁定此方向。",
): LayoutChoice {
  return layoutChoiceSchema.parse({
    version: 2,
    communicationContract,
    selectionSource: "user-locked",
    directions: [{
      id: "direction-locked",
      tier: "locked",
      label: `已锁定 · ${designSystem.visualStyle}`,
      rationale,
      designSystem,
    }],
    selectedDirectionId: "direction-locked",
  });
}

/** Summarize a confirmed design direction for tests / internal diagnostics. */
export function buildLayoutPhasePrompt(choice: LayoutChoice): string {
  const selected = getSelectedDesignDirection(choice);
  return [
    "设计方向已确认。",
    `selectedDirectionId=${selected.id}`,
    `argumentMode=${selected.designSystem.argumentMode}`,
    `visualStyle=${selected.designSystem.visualStyle}`,
    `readingMode=${selected.designSystem.readingMode}`,
    "将方向锁入 design/design-spec.json 与 slides/page-plan.json，再编写 slides/svg/*.svg，经 PreviewSvgPage 后由 SubmitSvgDeck 提交。",
  ].join(" ");
}
