import type { SkillCard, SkillEntry } from "../../skills/skill-types";
import type { PromptStage } from "./prompt-stage";
import { normalizePromptStage } from "./prompt-stage";

/**
 * Resolve recommended stages from SKILL.md frontmatter only.
 * Missing or empty stages means the skill is never marked as recommended.
 */
export function resolveSkillStages(entry: SkillEntry): PromptStage[] {
  const fromFrontmatter = entry.frontmatter.stages;
  if (!fromFrontmatter || fromFrontmatter.length === 0) {
    return [];
  }
  return fromFrontmatter.map((stage) => normalizePromptStage(stage));
}

export function isSkillRecommendedForStage(
  skillName: string,
  stage: PromptStage,
  entry?: SkillEntry,
): boolean {
  void skillName;
  if (!entry) return false;
  return resolveSkillStages(entry).includes(stage);
}

export function rankSkillCatalogForStage(
  cards: SkillCard[],
  stage: PromptStage,
  registry?: { get(name: string): SkillEntry | undefined },
): SkillCard[] {
  return [...cards].sort((left, right) => {
    const leftRecommended = isSkillRecommendedForStage(left.name, stage, registry?.get(left.name));
    const rightRecommended = isSkillRecommendedForStage(
      right.name,
      stage,
      registry?.get(right.name),
    );
    if (leftRecommended !== rightRecommended) return leftRecommended ? -1 : 1;
    return left.name.localeCompare(right.name);
  });
}
