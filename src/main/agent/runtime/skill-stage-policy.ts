import type { SkillCard, SkillEntry } from "../skills/skill-types";
import type { PromptStage } from "./prompt-stage";
import { normalizePromptStage } from "./prompt-stage";

/** Default stage allow-list per skill (overridable via SKILL.md `stages:` frontmatter). */
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
