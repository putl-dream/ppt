import type { AgentModelToolResultBlock } from "../../gateway/types";
import type { ToolContext } from "../../tools/tool-definition";
import {
  agentAskUserResultSchema,
  agentCommandProposalResultSchema,
  type AgentRuntimeResult,
} from "../runtime-types";
import {
  buildRenderFeedback,
  extractFeedbackImages,
  formatRenderFeedbackMessage,
  shouldOfferRenderFeedback,
} from "./render-feedback-loop";
import type { ToolExecutionOutcome } from "../tools/tool-execution-engine";
import type { PromptStage } from "../prompts/prompt-stage";

export type PresentationCompletionDecision =
  | {
      type: "terminal";
      result: AgentRuntimeResult;
      modelResult?: AgentModelToolResultBlock;
    }
  | {
      type: "continue";
      modelResult: AgentModelToolResultBlock;
      transcriptEntry: Record<string, unknown>;
      markRenderFeedbackUsed?: boolean;
    };

/** Interprets validated tool facts without executing tools or mutating AgentSession. */
export class PresentationCompletionPolicy {
  isFinishTool(toolName: string): boolean {
    return toolName === "SubmitCommands" || toolName === "AskUser";
  }

  async interpret(input: {
    toolName: string;
    toolUseId: string;
    outcome: ToolExecutionOutcome;
    context: ToolContext;
    promptStage?: PromptStage;
    renderFeedbackUsed: boolean;
    emitProgress(event: { type: string; message: string; [key: string]: unknown }): void;
  }): Promise<PresentationCompletionDecision> {
    const result = input.outcome.validatedResult;
    const commandProposalResult = agentCommandProposalResultSchema.safeParse(result);
    if (
      !commandProposalResult.success
      && result
      && typeof result === "object"
      && !Array.isArray(result)
      && (result as { type?: unknown }).type === "command_proposal"
    ) {
      throw new Error(
        `${input.toolName} returned an invalid command proposal: ${commandProposalResult.error.message}`,
      );
    }
    const commandProposal = commandProposalResult.success
      ? commandProposalResult.data
      : undefined;

    if (commandProposal) {
      if (
        shouldOfferRenderFeedback(
          input.promptStage,
          commandProposal.commands,
          input.renderFeedbackUsed,
        )
      ) {
        input.emitProgress({
          type: "render-feedback",
          message: "正在生成排版视觉预览…",
          progress: 0,
        });
        const feedback = await buildRenderFeedback({
          presentation: input.context.presentation,
          commands: commandProposal.commands,
          proposalSummary: commandProposal.summary,
          context: input.context,
        });
        input.emitProgress({
          type: "render-feedback-ready",
          message: feedback.hasThumbnails
            ? `已生成 ${feedback.slides.length} 页视觉预览（含缩略图）`
            : `已生成 ${feedback.slides.length} 页结构化预览`,
          progress: 0,
        });
        const images = extractFeedbackImages(feedback);
        return {
          type: "continue",
          markRenderFeedbackUsed: true,
          transcriptEntry: {
            role: "tool",
            toolName: input.toolName,
            result: commandProposal,
            renderFeedback: feedback,
          },
          modelResult: {
            type: "tool_result",
            toolUseId: input.toolUseId,
            content: [
              { type: "text", text: formatRenderFeedbackMessage(feedback) },
              ...images.map((image) => ({ type: "image" as const, ...image })),
            ],
          },
        };
      }
      return { type: "terminal", result: commandProposal };
    }

    if (input.toolName === "AskUser") {
      const askUser = agentAskUserResultSchema.parse(result);
      return {
        type: "terminal",
        result: askUser,
        modelResult: textResult(input.toolUseId, askUser.content),
      };
    }
    if (input.toolName === "SubmitCommands") {
      throw new Error("SubmitCommands must return a command proposal result.");
    }

    if (input.outcome.deliveryStatus === "postprocessing_failed") {
      return {
        type: "continue",
        modelResult: input.outcome.modelResult,
        transcriptEntry: {
          role: "tool",
          toolName: input.toolName,
          result,
          postProcessingError: input.outcome.error,
          executionStatus: "returned",
          sideEffects: input.outcome.sideEffects,
        },
      };
    }

    const prepared = input.outcome.preparedResult;
    if (!prepared) throw new Error("Delivered tool result is missing prepared model data.");
    return {
      type: "continue",
      modelResult: input.outcome.modelResult,
      transcriptEntry: {
        role: "tool",
        toolName: input.toolName,
        result: prepared.data,
        toolUseId: input.toolUseId,
        ...(prepared.truncated
          ? {
              modelResult: {
                truncated: true,
                originalChars: prepared.originalChars,
                persistedPath: prepared.persistedPath,
                persistenceError: prepared.persistenceError,
              },
            }
          : {}),
      },
    };
  }
}

function textResult(toolUseId: string, text: string): AgentModelToolResultBlock {
  return { type: "tool_result", toolUseId, content: [{ type: "text", text }] };
}
