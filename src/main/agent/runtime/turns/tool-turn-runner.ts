import { isTaskPlanActive } from "@shared/agent-task-graph";
import type { AgentModelToolResultBlock, AgentModelToolUseBlock } from "../../gateway/types";
import type { createTaskStore } from "../../task/task-store";
import {
  describeBackgroundTask,
} from "../background/background-task-manager";
import type { AgentLoopTurnOutcome, PreparedAgentRun } from "./prepared-agent-run";
import { rethrowIfRuntimeCancellation } from "../lifecycle/runtime-cancellation";
import type { AgentIterationWorkspace, AgentQueryState } from "../query/query-types";

/** Runs claim → checkpoint → preflight → dispatch → interpretation as one transaction. */
export class ToolTurnRunner {
  async runBatch(
    run: PreparedAgentRun,
    toolCalls: readonly AgentModelToolUseBlock[],
    workspace: AgentIterationWorkspace,
    state: AgentQueryState,
  ): Promise<AgentLoopTurnOutcome> {
    if (
      toolCalls.length > 1
      && toolCalls.some((call) =>
        run.input.presentationCompletionPolicy.isFinishTool(call.name))
    ) {
      for (const toolCall of toolCalls) {
        const result: AgentModelToolResultBlock = {
          type: "tool_result",
          toolUseId: toolCall.id,
          isError: true,
          content: [{
            type: "text",
            text:
              "Terminal tools must be called alone. No tool in this mixed batch was executed; "
              + "call ordinary tools first, then issue the terminal tool in a separate assistant response.",
          }],
        };
        run.scope.applyTransition({ type: "tool_processed", result });
        workspace.toolResults.push(structuredClone(result));
        run.appendRuntimeEvent("tool_result", {
          toolUseId: toolCall.id,
          toolName: toolCall.name,
          isError: true,
          content: structuredClone(result.content),
        }, "model_only");
      }
      return { type: "continue" };
    }

    for (const toolCall of toolCalls) {
      if (workspace.toolResults.some((result) => result.toolUseId === toolCall.id)) continue;
      const outcome = await this.runOne(run, toolCall, workspace, state);
      if (outcome.type === "terminal") return outcome;
      await run.scope.persistCheckpoint();
    }
    return { type: "continue" };
  }

  private async runOne(
    run: PreparedAgentRun,
    toolCall: AgentModelToolUseBlock,
    workspace: AgentIterationWorkspace,
    state: AgentQueryState,
  ): Promise<AgentLoopTurnOutcome> {
    const { scope, params } = run;
    const { session, backgroundTasks, taskStore } = scope;
    const deps = params.deps;
    const rethrowIfCancelled = (error: unknown): void => {
      rethrowIfRuntimeCancellation(error, scope.signal, deps.externalSignal);
    };

    scope.setInflightQuery("tool_running", workspace, toolCall);
    const claimDecision = scope.applyTransition({ type: "tool_claimed", toolUse: toolCall });
    run.appendRuntimeEvent("tool_call", {
      toolUseId: toolCall.id,
      toolName: toolCall.name,
      input: structuredClone(toolCall.input),
      parseError: toolCall.parseError,
    }, "model_only");
    if (claimDecision === "commit") await scope.persistCheckpoint();

    const recordToolResultBlock = (result: AgentModelToolResultBlock): void => {
      workspace.toolResults.push(structuredClone(result));
      const decision = scope.applyTransition({ type: "tool_processed", result });
      if (decision !== "commit_before_next") {
        throw new Error("CheckpointPolicy rejected a normal tool result transition.");
      }
      run.appendRuntimeEvent("tool_result", {
        toolUseId: toolCall.id,
        toolName: toolCall.name,
        isError: result.isError === true,
        content: structuredClone(result.content),
      }, "model_only");
    };
    const recordToolResult = (
      text: string,
      isError = false,
      images?: Array<{
        mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
        data: string;
      }>,
    ): void => {
      recordToolResultBlock({
        type: "tool_result",
        toolUseId: toolCall.id,
        content: [
          { type: "text", text },
          ...(images ?? []).map((image) => ({ type: "image" as const, ...image })),
        ],
        ...(isError ? { isError: true } : {}),
      });
    };

    if (!await params.canUseTool(toolCall, workspace.updatedToolUseContext)) {
      recordToolResult(`Tool ${toolCall.name} is not permitted in this query.`, true);
      return { type: "continue" };
    }

    const preflight = await run.input.toolPreflight.prepare({
      toolCall,
      context: workspace.updatedToolUseContext,
      workspaceRoot: deps.workspaceRoot,
      threadId: deps.threadId,
      requestToolApproval: deps.requestToolApproval,
      signal: scope.signal,
      policyGuidance: async (toolName) => {
        if (!await shouldRequireDiscoverTaskPlan({
          stage: workspace.updatedToolUseContext.promptStage,
          toolName,
          taskStore,
        })) return undefined;
        return "Full or multi-step PPT creation in the discover stage must start with "
          + "TaskGraphCreatePlan(sequential=true, 3-5 concrete steps) before LoadSkill, "
          + "ReadPresentationSnapshot, or other execution tools. Create the visible task plan first, "
          + "mark every step executionTarget=teammate or lead. Leave teammate steps pending for the "
          + "autonomous worker; only claim lead steps, and review submitted teammate work before completion.";
      },
    });
    if (preflight.repairs.length > 0) {
      run.appendRuntimeEvent("workflow_progress", {
        type: "tool-input-repaired",
        toolName: toolCall.name,
        toolUseId: toolCall.id,
        repairs: preflight.repairs,
      }, "internal");
    }

    if (preflight.type === "immediate_result") {
      const text = textFromResult(preflight.outcome.modelResult);
      if (preflight.kind === "validation_error") {
        const failures =
          (workspace.validationFailuresByTool.get(toolCall.name) ?? 0) + 1;
        workspace.validationFailuresByTool.set(toolCall.name, failures);
        if (failures <= 2) {
          run.emitProgress({
            type: "request-status",
            message: `正在自动修正工具 ${toolCall.name} 的参数…`,
            progress: 0,
          });
        } else {
          run.emitProgress({
            type: "tool-validation-failed",
            toolName: toolCall.name,
            message: `工具 ${toolCall.name} 参数连续校验失败`,
            error: preflight.validationError ?? text,
          });
        }
      } else if (preflight.kind === "policy_blocked") {
        run.emitProgress({
          type: "workflow-progress",
          message: "正在先建立可见任务计划...",
          progress: 0,
        });
      } else {
        run.emitProgress({
          type: "tool-validation-failed",
          toolName: toolCall.name,
          message: preflight.kind === "parse_error"
            ? `工具 ${toolCall.name} 参数 JSON 解析失败`
            : preflight.kind === "unavailable"
              ? `工具 ${toolCall.name} 无法直接调用`
              : `工具 ${toolCall.name} 执行前检查失败`,
          error: text,
        });
      }
      session.appendTranscript({
        role: "tool",
        toolName: toolCall.name,
        error: text,
        executionStatus: "not_started",
        sideEffects: "none",
      });
      recordToolResultBlock(preflight.outcome.modelResult);
      return { type: "continue" };
    }

    if (preflight.type === "denied") {
      run.emitProgress({
        type: "tool-finished",
        message: `工具 ${preflight.tool.name} 被拒绝: ${preflight.reason}`,
        toolName: preflight.tool.name,
      });
      session.appendTranscript({
        role: "tool",
        toolName: preflight.tool.name,
        error: preflight.reason,
        executionStatus: "not_started",
        sideEffects: "none",
      });
      recordToolResultBlock(preflight.modelResult);
      return { type: "continue" };
    }
    if (preflight.type === "hook_stopped") {
      return { type: "terminal", result: { type: "message", content: preflight.reason } };
    }

    const { tool, args, mode } = preflight.prepared;
    run.emitProgress({
      type: "tool-started",
      message: `正在调用工具 ${tool.name}...`,
      toolName: tool.name,
    });
    if (
      run.input.presentationCompletionPolicy.isFinishTool(tool.name)
      && (backgroundTasks.hasRunning() || backgroundTasks.hasPendingNotifications())
    ) {
      const guidance =
        `Paused ${tool.name} because background task results are not yet incorporated. `
        + "Review the task_notification content, then call the appropriate finish tool again.";
      session.appendTranscript({
        role: "tool",
        toolName: tool.name,
        result: { pausedForBackgroundTasks: true, guidance },
      });
      recordToolResult(guidance);
      await run.drainBackgroundForModel(
        workspace,
        "Background tasks have completed. Reconsider these results before calling a finish tool.",
      );
      run.emitProgress({
        type: "tool-finished",
        message: `工具 ${tool.name} 已等待后台任务结果。`,
        toolName: tool.name,
      });
      return { type: "continue" };
    }

    if (mode === "background") {
      const label = describeBackgroundTask(tool.name, args as Record<string, unknown>);
      let bgId = "";
      const scheduled = backgroundTasks.prepare({
        toolName: tool.name,
        label,
        toolUseId: toolCall.id,
        run: async () => {
          const outcome = await run.input.toolExecutionEngine.execute({
            tool,
            args,
            context: workspace.updatedToolUseContext,
            toolCall,
            runtimeArtifactRoot: deps.runtimeRoot,
            threadId: deps.threadId,
            signal: scope.signal,
            runPostToolUseHook: run.input.runPostToolUseHook,
          });
          const content = textFromResult(outcome.modelResult);
          if (outcome.executionStatus === "threw" || outcome.deliveryStatus === "validation_failed") {
            run.emitProgress({
              type: "tool-finished",
              message: `后台任务 ${bgId} 执行失败：${content}`,
              toolName: tool.name,
            });
            throw new Error(content);
          }
          run.emitProgress({
            type: "tool-finished",
            message: `后台任务 ${bgId} 已完成：${tool.name}`,
            toolName: tool.name,
          });
          return content;
        },
      });
      bgId = scheduled.bgId;
      const placeholder =
        `[Background task ${bgId} started: ${label}] `
        + "Result will arrive later as task_notification. Continue with independent work.";
      session.appendTranscript({
        role: "tool",
        toolName: tool.name,
        result: { backgroundTaskId: bgId, status: "running", label },
      });
      recordToolResult(placeholder);
      await scope.persistCheckpoint();
      scheduled.launch();
      run.emitProgress({
        type: "workflow-progress",
        message: `后台任务 ${bgId} 已启动：${label}`,
        progress: 0,
      });
      return { type: "continue" };
    }

    const outcome = await run.input.toolExecutionEngine.execute({
      tool,
      args,
      context: workspace.updatedToolUseContext,
      toolCall,
      runtimeArtifactRoot: deps.runtimeRoot,
      threadId: deps.threadId,
      signal: scope.signal,
      runPostToolUseHook: run.input.runPostToolUseHook,
    });
    const outcomeText = textFromResult(outcome.modelResult);
    if (outcome.executionStatus === "threw") {
      run.emitProgress({
        type: "tool-finished",
        message: `工具 ${tool.name} 执行失败: ${outcomeText}`,
        toolName: tool.name,
      });
      session.appendTranscript({
        role: "tool",
        toolName: tool.name,
        error: outcomeText,
        sideEffects: outcome.sideEffects,
      });
      recordToolResultBlock(outcome.modelResult);
      return { type: "continue" };
    }
    if (outcome.deliveryStatus === "validation_failed") {
      session.appendTranscript({
        role: "tool",
        toolName: tool.name,
        error: outcomeText,
        executionStatus: "returned",
        sideEffects: outcome.sideEffects,
      });
      recordToolResultBlock(outcome.modelResult);
      return { type: "continue" };
    }

    run.emitProgress({
      type: "tool-finished",
      message: `工具 ${tool.name} 执行完成。`,
      toolName: tool.name,
    });
    try {
      const decision = await run.input.presentationCompletionPolicy.interpret({
        toolName: tool.name,
        toolUseId: toolCall.id,
        outcome,
        context: workspace.updatedToolUseContext,
        promptStage: workspace.updatedToolUseContext.promptStage,
        renderFeedbackUsed: workspace.renderFeedbackUsed,
        emitProgress: (event) => run.emitProgress(event),
      });
      if (decision.type === "terminal") {
        if (decision.modelResult) recordToolResultBlock(decision.modelResult);
        if (decision.result.type === "ask_user") {
          scope.setInflightQuery("waiting_user", workspace);
        } else {
          scope.stageConversationHistory(
            state,
            workspace,
          );
        }
        return { type: "terminal", result: decision.result };
      }
      if (decision.markRenderFeedbackUsed) workspace.renderFeedbackUsed = true;
      session.appendTranscript(decision.transcriptEntry);
      recordToolResultBlock(decision.modelResult);
      return { type: "continue" };
    } catch (error) {
      rethrowIfCancelled(error);
      const message = error instanceof Error ? error.message : String(error);
      const guidance =
        `Tool ${tool.name} executed successfully, but result post-processing failed: ${message}. `
        + "Do not retry blindly; inspect durable artifacts first.";
      session.appendTranscript({
        role: "tool",
        toolName: tool.name,
        result: outcome.validatedResult,
        postProcessingError: message,
        executionStatus: "returned",
      });
      recordToolResult(guidance);
      return { type: "continue" };
    }
  }
}

function textFromResult(result: AgentModelToolResultBlock): string {
  return result.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

async function shouldRequireDiscoverTaskPlan(input: {
  stage?: string;
  toolName: string;
  taskStore?: ReturnType<typeof createTaskStore>;
}): Promise<boolean> {
  if (input.stage !== "discover" || !input.taskStore) return false;
  if (
    input.toolName === "AskUser"
    || input.toolName === "WebSearch"
    || input.toolName.startsWith("TaskGraph")
  ) return false;
  return !isTaskPlanActive(await input.taskStore.listTasks());
}
