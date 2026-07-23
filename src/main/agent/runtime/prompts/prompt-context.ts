import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Presentation } from "@shared/presentation";
import type { ToolDefinition } from "../../tools/tool-definition";
import type { SkillCard } from "../../skills/skill-types";
import type { AgentStepLimits } from "@shared/agent-step-limits";
import type { SkillRegistry } from "../../skills/loadSkillsDir";
import {
  resolvePromptStage,
  type PromptStage,
} from "./prompt-stage";
import {
  probeWorkspaceArtifacts,
  type WorkspaceArtifacts,
} from "../presentation/workspace-artifacts";

export const MEMORY_INDEX_RELATIVE_PATH = ".memory/MEMORY.md";
export const DURABLE_MEMORY_STATE_RELATIVE_PATH = ".memory/STATE.md";

export interface SystemPromptContextInput {
  request: string;
  presentation: Presentation;
  coreTools: ToolDefinition<any, any>[];
  skillCatalog?: SkillCard[];
  skillRegistry?: SkillRegistry;
  workspaceRoot?: string;
  currentSlideId?: string;
  messageHistory?: Array<{ role: "user" | "assistant"; content: string }>;
  requiredOutcome?: "any" | "command_proposal";
  stepLimits?: AgentStepLimits;
  memories?: string;
  artifacts?: WorkspaceArtifacts;
  stageHint?: string;
}

export interface SystemPromptContext {
  stage: PromptStage;
  artifacts: WorkspaceArtifacts;
  enabledTools: string[];
  workspaceRoot?: string;
  memories: string;
  skillCatalog?: SkillCard[];
  skillRegistry?: SkillRegistry;
  currentSlideId?: string;
  requiredOutcome?: "any" | "command_proposal";
  stepLimits?: AgentStepLimits;
  coreTools: ToolDefinition<any, any>[];
}

async function readMemoryIndex(workspaceRoot?: string): Promise<string> {
  if (!workspaceRoot) return "";

  try {
    const contents = await Promise.all(
      [MEMORY_INDEX_RELATIVE_PATH, DURABLE_MEMORY_STATE_RELATIVE_PATH].map(async (path) => {
        try {
          return (await readFile(join(workspaceRoot, path), "utf8")).trim();
        } catch {
          return "";
        }
      }),
    );
    return contents.filter(Boolean).join("\n\n");
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
  const [memories, artifacts] = await Promise.all([
    input.memories !== undefined
      ? Promise.resolve(input.memories)
      : readMemoryIndex(input.workspaceRoot),
    input.artifacts !== undefined
      ? Promise.resolve(input.artifacts)
      : probeWorkspaceArtifacts(input.workspaceRoot),
  ]);

  const stage = resolvePromptStage({
    request: input.request,
    presentation: input.presentation,
    artifacts,
    messageHistory: input.messageHistory,
    stageHint: input.stageHint,
  });

  return {
    stage,
    artifacts,
    enabledTools: input.coreTools.map((tool) => tool.name).sort(),
    workspaceRoot: input.workspaceRoot,
    memories,
    skillCatalog: input.skillCatalog,
    skillRegistry: input.skillRegistry,
    currentSlideId: input.currentSlideId,
    requiredOutcome: input.requiredOutcome,
    stepLimits: input.stepLimits,
    coreTools: input.coreTools,
  };
}

/** Sync variant for tests; skips filesystem unless artifacts/memories provided. */
export function buildSystemPromptContextSync(
  input: SystemPromptContextInput,
): SystemPromptContext {
  const artifacts = input.artifacts ?? {
    brief: false,
    outline: false,
    storyboard: false,
    layoutPlan: false,
  };

  const stage = resolvePromptStage({
    request: input.request,
    presentation: input.presentation,
    artifacts,
    messageHistory: input.messageHistory,
    stageHint: input.stageHint,
  });

  return {
    stage,
    artifacts,
    enabledTools: input.coreTools.map((tool) => tool.name).sort(),
    workspaceRoot: input.workspaceRoot,
    memories: input.memories ?? "",
    skillCatalog: input.skillCatalog,
    skillRegistry: input.skillRegistry,
    currentSlideId: input.currentSlideId,
    requiredOutcome: input.requiredOutcome,
    stepLimits: input.stepLimits,
    coreTools: input.coreTools,
  };
}

export function serializeSystemPromptContextKey(context: SystemPromptContext): string {
  return JSON.stringify({
    stage: context.stage,
    enabledTools: context.enabledTools,
    workspaceRoot: context.workspaceRoot ?? null,
    memories: context.memories || null,
    skillNames: (context.skillCatalog ?? []).map((skill) => skill.name).sort(),
    currentSlideId: context.currentSlideId ?? null,
    requiredOutcome: context.requiredOutcome ?? "any",
    stepLimits: context.stepLimits ?? null,
    artifacts: context.artifacts,
  });
}
