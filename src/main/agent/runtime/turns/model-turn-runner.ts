import { ensureToolResultPairing } from "../../gateway/message-pairing";
import {
  textFromContentBlocks,
  toolUseBlocksFromContent,
} from "../../gateway/content-blocks";
import { callModelWithRecovery } from "./model-call-recovery";
import type { AgentLoopTurnOutcome, PreparedAgentRun } from "./prepared-agent-run";
import type {
  AgentIterationWorkspace,
  AgentQueryState,
} from "../query/query-types";
import { formatBackgroundNotifications } from "../background/background-task-manager";

/** Runs one sealed model turn and returns an explicit loop decision. */
export class ModelTurnRunner {
  async run(
    run: PreparedAgentRun,
    _state: AgentQueryState,
    workspace: AgentIterationWorkspace,
  ): Promise<AgentLoopTurnOutcome> {
    const { scope, params } = run;
    const { session, backgroundTasks } = scope;
    const deps = params.deps;
    const currentModelStep = session.totalModelSteps;
    const checkpointDecision = scope.applyTransition({ type: "model_input_prepared" });
    const inboxContent = await run.drainLeadInboxForModel();
    const notifications = backgroundTasks.collect();
    const userContent = [
      notifications.length > 0
        ? formatBackgroundNotifications(notifications)
        : "",
      ...session.takePendingUserContent(),
      inboxContent ?? "",
    ].filter((part) => part.trim()).join("\n\n");
    run.flushUserTurn(userContent || undefined);
    workspace.messagesForQuery = structuredClone([...session.modelMessages]);
    if (checkpointDecision === "commit") await scope.persistCheckpoint();

    const promptPayload = { transcript: [] };
    const modelMessages = workspace.messagesForQuery;
    let attemptId = crypto.randomUUID();
    safeStreamEvent(deps.onStreamEvent, { type: "attempt_started", attemptId });
    let modelResult;
    try {
      modelResult = await callModelWithRecovery({
        gateway: deps.gateway,
        systemPrompt: params.systemPrompt,
        promptPayload,
        model: params.model,
        workspaceRoot: deps.runtimeRoot,
        threadId: deps.threadId,
        signal: deps.signal,
        tools: deps.toolSchemas,
        messages: ensureToolResultPairing(modelMessages),
        stream: deps.onStreamChunk || deps.onStreamEvent
          ? {
              onChunk: (chunk) => {
                if (chunk.type === "text_delta" && chunk.text) {
                  deps.onStreamChunk?.(chunk.text, "message");
                  safeStreamEvent(deps.onStreamEvent, {
                    type: "delta",
                    attemptId,
                    text: chunk.text,
                    source: "message",
                  });
                }
              },
              onThinkingChunk: (chunk) => {
                deps.onThinkingChunk?.(chunk, currentModelStep);
              },
            }
          : undefined,
        onRecovery: (message) => {
          safeStreamEvent(deps.onStreamEvent, {
            type: "attempt_reset",
            attemptId,
            reason: message,
          });
          attemptId = crypto.randomUUID();
          safeStreamEvent(deps.onStreamEvent, { type: "attempt_started", attemptId });
          run.emitProgress({ type: "request-status", message, progress: 0 });
        },
        onContextPrepared: (preparedPayload, notes, preparedMessages) => {
          if (!deps.conversationDatabase) return;
          deps.conversationDatabase.saveContextSnapshotForRun(
            scope.runId,
            {
              payload: preparedPayload,
              messages: preparedMessages
                ?? ensureToolResultPairing([...session.modelMessages]),
            },
            notes,
          );
        },
      });
    } catch (error) {
      safeStreamEvent(deps.onStreamEvent, {
        type: "attempt_reset",
        attemptId,
        reason: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
    safeStreamEvent(deps.onStreamEvent, { type: "attempt_committed", attemptId });
    run.appendRuntimeEvent("model_response", {
      modelStep: currentModelStep,
      content: structuredClone(modelResult.content),
      stopReason: modelResult.stopReason,
      model: modelResult.modelUsed,
    }, "model_only");

    const seenToolCallIds = new Set<string>();
    const toolUses = toolUseBlocksFromContent(modelResult.content).filter((call) => {
      if (!call.id || !call.name || seenToolCallIds.has(call.id)) return false;
      seenToolCallIds.add(call.id);
      return true;
    });
    if (toolUses.length > 0) {
      workspace.assistantMessages.push({
        role: "assistant",
        content: structuredClone(modelResult.content),
      });
      workspace.toolUseBlocks.push(...structuredClone(toolUses));
      scope.setInflightQuery("model_received", workspace);
      const responseDecision = scope.applyTransition({
        type: "model_response_received",
        content: modelResult.content,
        toolUses,
      });
      if (responseDecision === "commit") await scope.persistCheckpoint();
      return { type: "tool_batch" };
    }

    const responseText = textFromContentBlocks(modelResult.content);
    workspace.assistantMessages.push({
      role: "assistant",
      content: structuredClone(modelResult.content),
    });
    scope.applyTransition({
      type: "model_response_received",
      content: modelResult.content,
      toolUses: [],
    });
    if (deps.requiredOutcome === "command_proposal") {
      const guidance =
        "This is an unresolved presentation action. Do not narrate future work. "
        + "Call AskUser if information is still missing, otherwise continue tools and finish with SubmitCommands.";
      session.appendTranscript({ role: "assistant", content: responseText, error: guidance });
      run.appendUserTurn({ text: guidance });
      workspace.followUpMessages.push({
        role: "user",
        content: [{ type: "text", text: guidance }],
      });
      return { type: "continue" };
    }
    if (await run.drainBackgroundForModel(
      "Background tasks have completed. Use these results before giving the final response.",
    )) {
      workspace.followUpMessages.push(
        ...structuredClone(session.modelMessages.slice(
          workspace.messagesForQuery.length + workspace.assistantMessages.length,
        )),
      );
      return { type: "continue" };
    }

    const finalInboxContent = await run.drainLeadInboxForModel();
    if (finalInboxContent) {
      run.appendUserTurn({ text: finalInboxContent });
      workspace.followUpMessages.push({
        role: "user",
        content: [{ type: "text", text: finalInboxContent }],
      });
      return { type: "continue" };
    }
    run.appendRuntimeEvent("assistant_completed", { content: responseText });
    return {
      type: "terminal",
      result: { type: "message", content: responseText },
    };
  }
}

function safeStreamEvent(
  handler: PreparedAgentRun["params"]["deps"]["onStreamEvent"],
  event: Parameters<NonNullable<PreparedAgentRun["params"]["deps"]["onStreamEvent"]>>[0],
): void {
  try {
    handler?.(event);
  } catch {
    // Stream projections are observational and cannot replace the Runtime result.
  }
}
