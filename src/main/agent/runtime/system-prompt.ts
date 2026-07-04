import type { ToolDefinition } from "../tools/tool-definition";
import type { SkillCard } from "../skills/skill-types";
import type { AgentStepLimits } from "@shared/agent-step-limits";
import { buildSystemPromptContext, buildSystemPromptContextSync } from "./prompt-context";
import { getSystemPrompt, type AssembledSystemPrompt } from "./system-prompt-assembler";

export type { AssembledSystemPrompt } from "./system-prompt-assembler";
export { getSystemPrompt, getSystemPromptSections, clearSystemPromptCache } from "./system-prompt-assembler";
export { buildSystemPromptContext, buildSystemPromptContextSync } from "./prompt-context";
export type { SystemPromptContext, SystemPromptContextInput } from "./prompt-context";
export { SYSTEM_PROMPT_DYNAMIC_BOUNDARY } from "./prompt-sections";

export interface SystemPromptOptions {
  coreTools: ToolDefinition<any, any>[];
  skillCatalog?: SkillCard[];
  currentSlideId?: string;
  requiredOutcome?: "any" | "command_proposal";
  stepLimits?: AgentStepLimits;
  workspaceRoot?: string;
  memories?: string;
  threadId?: string;
}

/**
 * Runtime system prompt harness. Prompt is assembled from sections, not a single hardcoded string.
 */
export class SystemPromptBuilder {
  /** Sync build for tests; skips async memory file read unless `memories` is provided. */
  static build(options: SystemPromptOptions): string {
    const context = buildSystemPromptContextSync({
      coreTools: options.coreTools,
      skillCatalog: options.skillCatalog,
      workspaceRoot: options.workspaceRoot,
      currentSlideId: options.currentSlideId,
      requiredOutcome: options.requiredOutcome,
      stepLimits: options.stepLimits,
      memories: options.memories,
    });
    return getSystemPrompt(context, options.threadId).text;
  }

  static async buildAsync(options: SystemPromptOptions): Promise<AssembledSystemPrompt> {
    const context = await buildSystemPromptContext({
      coreTools: options.coreTools,
      skillCatalog: options.skillCatalog,
      workspaceRoot: options.workspaceRoot,
      currentSlideId: options.currentSlideId,
      requiredOutcome: options.requiredOutcome,
      stepLimits: options.stepLimits,
      memories: options.memories,
    });
    return getSystemPrompt(context, options.threadId);
  }
}
