import type { PromptStage } from "../runtime/prompt-stage";

/**
 * Skill catalog and session types for the two-layer load_skill design.
 *
 * Layer 1: SkillCard[] injected into system prompt (~100 tokens/skill).
 * Layer 2: full SKILL.md body returned via LoadSkill tool (~2000 tokens/skill, on demand).
 */

export interface SkillFrontmatter {
  name: string;
  description: string;
  when_to_use?: string;
  /** Prompt stages where this skill may appear in catalog and LoadSkill is allowed. */
  stages?: PromptStage[];
  /** Tool names the skill may auto-allow when applied */
  allowedTools?: string[];
  context?: "inline" | "fork";
  model?: string;
  hooks?: unknown;
  /** Glob patterns for conditional activation */
  paths?: string[];
  userInvocable?: boolean;
}

/** Lightweight catalog entry for system prompt injection */
export interface SkillCard {
  name: string;
  description: string;
  whenToUse?: string;
}

/** Full skill record built at harness startup from skills/<name>/SKILL.md */
export interface SkillEntry {
  name: string;
  description: string;
  whenToUse?: string;
  frontmatter: SkillFrontmatter;
  /** Absolute path to the skill subdirectory (internal; not exposed to model) */
  skillDir: string;
  /** Markdown body after YAML frontmatter */
  body: string;
}

/** Per-thread state tracking which skills have been loaded this run */
export interface SkillSession {
  loadedSkillNames: Set<string>;
}

export function createSkillSession(): SkillSession {
  return { loadedSkillNames: new Set<string>() };
}
