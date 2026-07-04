import type { SkillCard, SkillEntry } from "../skills/skill-types";
import type { PromptStage } from "./prompt-stage";

/** Default stage allow-list per skill (overridable via SKILL.md `stages:` frontmatter). */
export const DEFAULT_SKILL_STAGES: Record<string, PromptStage[]> = {
  "ppt-workflow": ["routing"],
  "ppt-brief": ["routing", "planning"],
  "ppt-outline": ["planning", "content"],
  "ppt-storyboard": ["planning", "content"],
  "ppt-research": ["planning", "content"],
  "ppt-build": ["content"],
  "ppt-edit": ["content", "light-edit"],
  "ppt-design": ["layout-design", "layout-exec"],
  "ppt-design-layout": ["layout-design"],
  "ppt-layout": ["layout-design", "layout-exec"],
  "ppt-beautify": ["layout-exec", "review"],
  "deck-review": ["layout-exec", "review", "export"],
  "ppt-export": ["export", "review"],
};

export function resolveSkillStages(entry: SkillEntry): PromptStage[] {
  const fromFrontmatter = entry.frontmatter.stages;
  if (fromFrontmatter && fromFrontmatter.length > 0) {
    return fromFrontmatter;
  }
  return DEFAULT_SKILL_STAGES[entry.name] ?? ["routing"];
}

export function isSkillAllowedForStage(
  skillName: string,
  stage: PromptStage,
  entry?: SkillEntry,
): boolean {
  const stages = entry ? resolveSkillStages(entry) : DEFAULT_SKILL_STAGES[skillName];
  if (!stages) return false;
  return stages.includes(stage);
}

export function filterSkillCatalogForStage(
  cards: SkillCard[],
  stage: PromptStage,
  registry?: { get(name: string): SkillEntry | undefined },
): SkillCard[] {
  return cards.filter((card) => {
    const entry = registry?.get(card.name);
    return isSkillAllowedForStage(card.name, stage, entry);
  });
}

export function formatSkillStageRejection(
  skillName: string,
  stage: PromptStage,
  entry?: SkillEntry,
): string {
  const allowed = entry ? resolveSkillStages(entry) : DEFAULT_SKILL_STAGES[skillName];
  const allowedText = allowed?.length ? allowed.join(", ") : "none";
  return `Skill '${skillName}' is not available in stage '${stage}'. `
    + `Allowed stages: ${allowedText}. `
    + "Complete the current phase before loading layout or export skills.";
}
