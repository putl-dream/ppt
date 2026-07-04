import type { PromptSectionId, PromptSectionCacheScope } from "./prompt-sections";
import {
  PROMPT_SECTION_DEFS,
  SYSTEM_PROMPT_DYNAMIC_BOUNDARY,
  buildIdentitySection,
  buildMemorySection,
  buildToolsSection,
  buildWorkspaceSection,
} from "./prompt-sections";
import {
  type SystemPromptContext,
  serializeSystemPromptContextKey,
} from "./prompt-context";

export interface AssembledPromptSection {
  id: PromptSectionId;
  content: string;
  cacheScope: PromptSectionCacheScope;
}

export interface AssembledSystemPrompt {
  sections: AssembledPromptSection[];
  /** Full prompt string for gateway APIs that accept a single system field. */
  text: string;
  /** Stable prefix (global cache block) before SYSTEM_PROMPT_DYNAMIC_BOUNDARY. */
  staticPrefix: string;
  /** Dynamic suffix after the boundary (workspace + memory). */
  dynamicSuffix: string;
}

interface CacheEntry {
  contextKey: string;
  result: AssembledSystemPrompt;
}

const sectionCacheByThread = new Map<string, CacheEntry>();

function shouldIncludeMemory(context: SystemPromptContext): boolean {
  return context.memories.length > 0;
}

/**
 * Assemble system prompt sections from real context state.
 * Section inclusion is driven by filesystem / registry facts, not message keywords.
 */
export function assembleSystemPrompt(context: SystemPromptContext): AssembledSystemPrompt {
  const sections: AssembledPromptSection[] = [];

  const push = (id: PromptSectionId, content: string) => {
    if (!content.trim()) return;
    sections.push({
      id,
      content,
      cacheScope: PROMPT_SECTION_DEFS[id].cacheScope,
    });
  };

  push("identity", buildIdentitySection({
    stage: context.stage,
    stepLimits: context.stepLimits,
    requiredOutcome: context.requiredOutcome,
  }));

  push("tools", buildToolsSection({
    stage: context.stage,
    enabledTools: context.coreTools,
    skillCatalog: context.skillCatalog,
    skillRegistry: context.skillRegistry,
  }));

  push("workspace", buildWorkspaceSection({
    stage: context.stage,
    workspaceRoot: context.workspaceRoot,
    currentSlideId: context.currentSlideId,
  }));

  if (shouldIncludeMemory(context)) {
    push("memory", buildMemorySection({ memories: context.memories }));
  }

  const staticSections = sections.filter((section) => section.cacheScope === "global");
  const dynamicSections = sections.filter((section) => section.cacheScope === null);

  const staticPrefix = staticSections.map((section) => section.content).join("\n\n");
  const dynamicSuffix = dynamicSections.map((section) => section.content).join("\n\n");
  const text = dynamicSuffix
    ? `${staticPrefix}${SYSTEM_PROMPT_DYNAMIC_BOUNDARY}${dynamicSuffix}`
    : staticPrefix;

  return { sections, text, staticPrefix, dynamicSuffix };
}

/**
 * Returns assembled sections; reuses cache when context is unchanged within a thread.
 */
export function getSystemPrompt(
  context: SystemPromptContext,
  threadId?: string,
): AssembledSystemPrompt {
  const contextKey = serializeSystemPromptContextKey(context);

  if (threadId) {
    const cached = sectionCacheByThread.get(threadId);
    if (cached?.contextKey === contextKey) {
      return cached.result;
    }
  }

  const result = assembleSystemPrompt(context);

  if (threadId) {
    sectionCacheByThread.set(threadId, { contextKey, result });
  }

  return result;
}

/** @returns Section content array (static sections first, then dynamic). */
export function getSystemPromptSections(
  context: SystemPromptContext,
  threadId?: string,
): string[] {
  return getSystemPrompt(context, threadId).sections.map((section) => section.content);
}

export function clearSystemPromptCache(threadId?: string): void {
  if (threadId) {
    sectionCacheByThread.delete(threadId);
    return;
  }
  sectionCacheByThread.clear();
}

export function splitSystemPromptPrefix(text: string): {
  staticPrefix: string;
  dynamicSuffix: string;
} {
  const boundaryIndex = text.indexOf(SYSTEM_PROMPT_DYNAMIC_BOUNDARY);
  if (boundaryIndex < 0) {
    return { staticPrefix: text, dynamicSuffix: "" };
  }

  return {
    staticPrefix: text.slice(0, boundaryIndex),
    dynamicSuffix: text.slice(boundaryIndex + SYSTEM_PROMPT_DYNAMIC_BOUNDARY.length),
  };
}
