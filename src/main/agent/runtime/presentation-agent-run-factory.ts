import type { ConversationDatabase } from "../../conversation-database";
import { resolve } from "node:path";
import { getEffectiveMainMaxSteps, resolveAgentStepLimits } from "@shared/agent-step-limits";
import type { TeammateProgressEvent } from "@shared/teammate-progress";
import type { AgentModelGateway } from "../gateway";
import { createEmptySkillRegistry, type SkillRegistry } from "../skills/loadSkillsDir";
import type { SkillSession } from "../skills/skill-types";
import type { ToolContext, ToolDiscoverySession } from "../tools/tool-definition";
import { ToolRegistry } from "../tools/tool-registry";
import { LEAD_TASK_PERMISSIONS } from "../task/task-store";
import { toToolSchemas } from "../tools/tool-schema";
import { AgentRunScope } from "./lifecycle/agent-run-scope";
import { ensureDefaultHooks } from "./hooks/default-hooks";
import type { PostToolUseBlock, UserPromptSubmitBlock } from "./hooks/hook-blocks";
import { triggerHooks } from "./hooks/hook-registry";
import {
  prepareLayoutChoiceTask,
} from "./presentation/layout-choice-orchestrator";
import { LeadInboxInputSource } from "./background/lead-inbox-input-source";
import { PreparedAgentRun } from "./turns/prepared-agent-run";
import { PresentationCompletionPolicy } from "./presentation/presentation-completion-policy";
import { rethrowIfRuntimeCancellation } from "./lifecycle/runtime-cancellation";
import type { AgentRuntimeOptions, AgentRuntimeResult } from "./runtime-types";
import { buildSystemPromptContext, clearSystemPromptCache, getSystemPrompt } from "./prompts/system-prompt";
import { ToolExecutionEngine } from "./tools/tool-execution-engine";
import { ToolPreflight } from "./tools/tool-preflight";
import { WorkspaceFileService } from "../tools/files/workspace-file-service";

export type AgentRunPreparation =
  | { type: "ready"; run: PreparedAgentRun }
  | { type: "short_circuit"; result: AgentRuntimeResult };

/** Builds the Presentation-specific execution environment outside the stable loop. */
export class PresentationAgentRunFactory {
  private readonly discoverySessions = new Map<string, ToolDiscoverySession>();
  private readonly skillSessions = new Map<string, SkillSession>();
  private readonly fileSessions = new Map<string, WorkspaceFileService>();

  constructor(
    private readonly registry: ToolRegistry,
    private readonly gateway: AgentModelGateway,
    private readonly skillRegistry: SkillRegistry = createEmptySkillRegistry(),
    private readonly conversationDatabase?: ConversationDatabase,
  ) {}

  async open(options: AgentRuntimeOptions): Promise<AgentRunScope> {
    ensureDefaultHooks();
    return await AgentRunScope.open({
      options,
      conversationDatabase: this.conversationDatabase,
      resolveDiscoverySession: (recovered) => {
        const session = this.discoverySessions.get(options.threadId) ?? {
          discoveredToolNames: new Set<string>(recovered?.discoveredToolNames ?? []),
        };
        this.discoverySessions.set(options.threadId, session);
        return session;
      },
      resolveSkillSession: (recovered) => {
        const session = this.skillSessions.get(options.threadId) ?? {
          loadedSkillNames: new Set<string>(recovered?.loadedSkillNames ?? []),
        };
        this.skillSessions.set(options.threadId, session);
        return session;
      },
    });
  }

  async prepare(scope: AgentRunScope): Promise<AgentRunPreparation> {
    const { options, session, taskStore } = scope;
    const stepLimits = resolveAgentStepLimits(options.agentStepLimits);
    const maxSteps = options.maxSteps ?? getEffectiveMainMaxSteps(stepLimits);
    const emitProgress = scope.eventPorts.renderer.bind(scope.eventPorts);
    const contextBase: ToolContext = {
      presentation: structuredClone(options.presentationSnapshot),
      currentSlideId: options.currentSlideId,
      selectedElementIds: [...options.selectedElementIds],
      discoverySession: scope.discoverySession,
      registry: this.registry,
      messageHistory: options.messageHistory ?? [],
      workspaceRoot: options.workspaceRoot,
      fileService: this.resolveFileService(options.threadId, options.workspaceRoot),
      gateway: this.gateway,
      model: options.model,
      signal: scope.signal,
      requestToolApproval: options.requestToolApproval,
      notifyTaskListUpdated: () => {
        if (taskStore) scope.taskSubscription?.notifyTasksUpdated(taskStore.identity.taskListId);
      },
      onTeammateProgress: options.onProgress
        ? (event) => emitProgress({ ...event, message: teammateProgressMessage(event) })
        : undefined,
      agentStepLimits: stepLimits,
      skillRegistry: this.skillRegistry,
      skillSession: scope.skillSession,
      taskStore,
      taskPrincipal: taskStore?.principal(scope.taskListOwner, "lead", LEAD_TASK_PERMISSIONS),
      taskListOwner: scope.taskListOwner,
      messageBus: options.messageBus,
      teammateManager: options.teammateManager,
    };
    const coreTools = this.registry.getCoreTools(contextBase);
    const promptContext = await buildSystemPromptContext({
      request: options.request,
      presentation: options.presentationSnapshot,
      coreTools,
      skillCatalog: this.skillRegistry.listCards(),
      skillRegistry: this.skillRegistry,
      workspaceRoot: options.workspaceRoot,
      currentSlideId: options.currentSlideId,
      messageHistory: options.messageHistory,
      requiredOutcome: options.requiredOutcome,
      stepLimits,
      stageHint: options.stageHint,
    });
    const { text: systemPrompt } = getSystemPrompt(promptContext, options.threadId);
    const context: ToolContext = {
      ...contextBase,
      promptStage: promptContext.stage,
    };

    if (options.layoutChoice) {
      if (!taskStore || !options.workspaceRoot) {
        throw new Error("Layout choice requires a configured workspace task board.");
      }
      const prepared = await prepareLayoutChoiceTask({
        choice: options.layoutChoice,
        presentation: options.presentationSnapshot,
        workspaceRoot: options.workspaceRoot,
        taskStore,
        toolContext: context,
      });
      emitProgress({ type: "workflow-progress", message: prepared.message, progress: 20 });
      return {
        type: "short_circuit",
        result: { type: "message", content: prepared.message },
      };
    }

    const promptBlock: UserPromptSubmitBlock = {
      event: "UserPromptSubmit",
      threadId: options.threadId,
      request: options.request,
      messageHistory: options.messageHistory,
    };
    const promptStop = await triggerHooks("UserPromptSubmit", promptBlock);
    if (promptStop) {
      return {
        type: "short_circuit",
        result: { type: "message", content: promptStop.reason },
      };
    }

    const runPostToolUseHook = async (block: PostToolUseBlock): Promise<string[]> => {
      try {
        await triggerHooks("PostToolUse", block);
        return [];
      } catch (error) {
        rethrowIfRuntimeCancellation(error, scope.signal, options.signal);
        const message = error instanceof Error ? error.message : String(error);
        session.appendTranscript({
          role: "system",
          kind: "hook_error",
          hook: "PostToolUse",
          toolName: block.toolName,
          content: message,
        });
        emitProgress({
          type: "workflow-warning",
          message: `工具 ${block.toolName} 已执行，但 PostToolUse Hook 失败：${message}`,
          toolName: block.toolName,
        });
        return [message];
      }
    };
    const leadInbox = new LeadInboxInputSource({
      messageBus: options.messageBus,
      teammateManager: options.teammateManager,
      requestToolApproval: options.requestToolApproval,
      session,
      commit: () => scope.persistCheckpoint(),
    });
    return {
      type: "ready",
      run: new PreparedAgentRun({
        scope,
        gateway: this.gateway,
        conversationDatabase: this.conversationDatabase,
        systemPrompt,
        toolSchemas: toToolSchemas(coreTools),
        context,
        maxSteps,
        stepLimits,
        leadInbox,
        toolPreflight: new ToolPreflight(this.registry),
        toolExecutionEngine: new ToolExecutionEngine(),
        presentationCompletionPolicy: new PresentationCompletionPolicy(),
        runPostToolUseHook,
      }),
    };
  }

  clearSession(threadId: string): void {
    this.discoverySessions.delete(threadId);
    this.skillSessions.delete(threadId);
    this.fileSessions.get(threadId)?.clear();
    this.fileSessions.delete(threadId);
    clearSystemPromptCache(threadId);
  }

  private resolveFileService(
    threadId: string,
    workspaceRoot: string | undefined,
  ): WorkspaceFileService | undefined {
    if (!workspaceRoot) return undefined;
    const normalizedRoot = resolve(workspaceRoot);
    const current = this.fileSessions.get(threadId);
    if (current?.workspaceRoot === normalizedRoot) return current;
    current?.clear();
    const service = new WorkspaceFileService(normalizedRoot);
    this.fileSessions.set(threadId, service);
    return service;
  }
}

function teammateProgressMessage(event: TeammateProgressEvent): string {
  switch (event.type) {
    case "teammate-assignment-started":
      return `${event.teammateName} 开始处理：${event.description}`;
    case "teammate-thinking-chunk":
      return event.chunk;
    case "teammate-tool-started":
    case "teammate-tool-finished":
      return event.message;
    case "teammate-assignment-finished":
      return event.message ?? `${event.teammateName} 已结束当前任务。`;
    default:
      return "";
  }
}
