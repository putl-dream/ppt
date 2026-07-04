import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ToolDefinition } from "../tools/tool-definition";
import type { SkillCard } from "../skills/skill-types";
import type { AgentStepLimits } from "@shared/agent-step-limits";

export const MEMORY_INDEX_RELATIVE_PATH = ".memory/MEMORY.md";

export interface SystemPromptContextInput {
  coreTools: ToolDefinition<any, any>[];
  skillCatalog?: SkillCard[];
  workspaceRoot?: string;
  currentSlideId?: string;
  requiredOutcome?: "any" | "command_proposal";
  stepLimits?: AgentStepLimits;
  /** Pre-loaded memory content; skips filesystem read when provided. */
  memories?: string;
}

export interface SystemPromptContext {
  enabledTools: string[];
  workspaceRoot?: string;
  memories: string;
  skillCatalog?: SkillCard[];
  currentSlideId?: string;
  requiredOutcome?: "any" | "command_proposal";
  stepLimits?: AgentStepLimits;
  coreTools: ToolDefinition<any, any>[];
}

async function readMemoryIndex(workspaceRoot?: string): Promise<string> {
  if (!workspaceRoot) return "";

  try {
    const content = await readFile(
      join(workspaceRoot, MEMORY_INDEX_RELATIVE_PATH),
      "utf8",
    );
    return content.trim();
  } catch {
    return "";
  }
}

/**
 * Build prompt assembly context from real runtime state — not message keywords.
 */
export async function buildSystemPromptContext(
  input: SystemPromptContextInput,
): Promise<SystemPromptContext> {
  const memories = input.memories ?? await readMemoryIndex(input.workspaceRoot);

  return {
    enabledTools: input.coreTools.map((tool) => tool.name).sort(),
    workspaceRoot: input.workspaceRoot,
    memories,
    skillCatalog: input.skillCatalog,
    currentSlideId: input.currentSlideId,
    requiredOutcome: input.requiredOutcome,
    stepLimits: input.stepLimits,
    coreTools: input.coreTools,
  };
}

/** Sync variant for tests; skips filesystem and uses empty memories unless provided. */
export function buildSystemPromptContextSync(
  input: SystemPromptContextInput,
): SystemPromptContext {
  return {
    enabledTools: input.coreTools.map((tool) => tool.name).sort(),
    workspaceRoot: input.workspaceRoot,
    memories: input.memories ?? "",
    skillCatalog: input.skillCatalog,
    currentSlideId: input.currentSlideId,
    requiredOutcome: input.requiredOutcome,
    stepLimits: input.stepLimits,
    coreTools: input.coreTools,
  };
}

export function serializeSystemPromptContextKey(context: SystemPromptContext): string {
  return JSON.stringify({
    enabledTools: context.enabledTools,
    workspaceRoot: context.workspaceRoot ?? null,
    memories: context.memories || null,
    skillNames: (context.skillCatalog ?? []).map((skill) => skill.name).sort(),
    currentSlideId: context.currentSlideId ?? null,
    requiredOutcome: context.requiredOutcome ?? "any",
    stepLimits: context.stepLimits ?? null,
  });
}
