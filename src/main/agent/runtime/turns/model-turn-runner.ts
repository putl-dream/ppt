import { ensureToolResultPairing } from "../../gateway/message-pairing";
import {
  textFromContentBlocks,
  toolUseBlocksFromContent,
} from "../../gateway/content-blocks";
import { callModelWithRecovery } from "./model-call-recovery";
import type { AgentLoopTurnOutcome, PreparedAgentRun } from "./prepared-agent-run";
import { formatBackgroundNotifications } from "../background/background-task-manager";

/** Runs one sealed model turn and returns an explicit loop decision. */
export class ModelTurnRunner {
  async run(run: PreparedAgentRun): Promise<AgentLoopTurnOutcome> {
    const { scope } = run;
    const { options, session, backgroundTasks } = scope;
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
    if (checkpointDecision === "commit") await scope.persistCheckpoint();

    const promptPayload = {
      request: options.request,
      conversation: options.messageHistory ?? [],
      transcript: [...session.transcript],
    };
    const modelMessages = [...session.modelMessages];
    const modelResult = await callModelWithRecovery({
      gateway: run.input.gateway,
      systemPrompt: run.input.systemPrompt,
      promptPayload,
      model: options.model,
      workspaceRoot: options.runtimeRoot,
      threadId: options.threadId,
      signal: scope.signal,
      tools: run.input.toolSchemas,
      messages: ensureToolResultPairing(modelMessages),
      stream: options.onStreamChunk
        ? {
            onChunk: (chunk) => {
              if (chunk.type === "text_delta" && chunk.text) {
                options.onStreamChunk?.(chunk.text, "message");
              }
            },
            onThinkingChunk: (chunk) => {
              options.onThinkingChunk?.(chunk, currentModelStep);
            },
          }
        : undefined,
      onRecovery: (message) => {
        run.emitProgress({ type: "request-status", message, progress: 0 });
      },
      onContextPrepared: (preparedPayload, notes, preparedMessages) => {
        if (!run.input.conversationDatabase) return;
        run.input.conversationDatabase.saveContextSnapshotForRun(
          scope.runId,
          {
            payload: preparedPayload,
            messages: preparedMessages ?? ensureToolResultPairing([...session.modelMessages]),
          },
          notes,
        );
      },
    });
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
      const responseDecision = scope.applyTransition({
        type: "model_response_received",
        content: modelResult.content,
        toolUses,
      });
      if (responseDecision === "commit") await scope.persistCheckpoint();
      return { type: "tool_batch" };
    }

    const responseText = textFromContentBlocks(modelResult.content);
    scope.applyTransition({
      type: "model_response_received",
      content: modelResult.content,
      toolUses: [],
    });
    if (options.requiredOutcome === "command_proposal") {
      const guidance =
        "This is an unresolved presentation action. Do not narrate future work. "
        + "Call AskUser if information is still missing, otherwise continue tools and finish with SubmitCommands.";
      session.appendTranscript({ role: "assistant", content: responseText, error: guidance });
      run.appendUserTurn({ text: guidance });
      return { type: "continue" };
    }
    if (await run.drainBackgroundForModel(
      "Background tasks have completed. Use these results before giving the final response.",
    )) return { type: "continue" };

    const finalInboxContent = await run.drainLeadInboxForModel();
    if (finalInboxContent) {
      run.appendUserTurn({ text: finalInboxContent });
      return { type: "continue" };
    }
    run.appendRuntimeEvent("assistant_completed", { content: responseText });
    return {
      type: "terminal",
      result: { type: "message", content: responseText },
    };
  }
}
