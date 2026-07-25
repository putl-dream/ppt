import type { SkillCard, SkillEntry } from "../../skills/skill-types";
import type { PromptStage } from "./prompt-stage";
import { normalizePromptStage } from "./prompt-stage";

/** Default recommended stages per skill (overridable via SKILL.md frontmatter). */
export const DEFAULT_SKILL_STAGES: Record<string, PromptStage[]> = {
  "ppt-workflow": ["discover"],
  "ppt-brief": ["discover"],
  "ppt-outline": ["discover", "author"],
  "ppt-storyboard": ["discover", "author"],
  "ppt-research": ["discover", "author"],
  "ppt-build": ["author"],
  "ppt-edit": ["author", "edit"],
  "ppt-design": ["design", "style"],
  "ppt-design-layout": ["design"],
  "ppt-layout": ["design", "style"],
  "ppt-beautify": ["style"],
  "deck-review": ["style", "export"],
  "ppt-export": ["export", "style"],
};

export function resolveSkillStages(entry: SkillEntry): PromptStage[] {
  const fromFrontmatter = entry.frontmatter.stages;
  if (fromFrontmatter && fromFrontmatter.length > 0) {
    return fromFrontmatter.map((stage) => normalizePromptStage(stage));
  }
  return DEFAULT_SKILL_STAGES[entry.name] ?? ["discover"];
}

export function isSkillRecommendedForStage(
  skillName: string,
  stage: PromptStage,
  entry?: SkillEntry,
): boolean {
  const stages = entry ? resolveSkillStages(entry) : DEFAULT_SKILL_STAGES[skillName];
  if (!stages) return false;
  return stages.includes(stage);
}

export function rankSkillCatalogForStage(
  cards: SkillCard[],
  stage: PromptStage,
  registry?: { get(name: string): SkillEntry | undefined },
): SkillCard[] {
  return [...cards].sort((left, right) => {
    const leftRecommended = isSkillRecommendedForStage(
      left.name,
      stage,
      registry?.get(left.name),
    );
    const rightRecommended = isSkillRecommendedForStage(
      right.name,
      stage,
      registry?.get(right.name),
    );
    if (leftRecommended !== rightRecommended) return leftRecommended ? -1 : 1;
    return left.name.localeCompare(right.name);
  });
}
