import type { AgentModelToolResultBlock } from "../../gateway/types";
import type { ToolContext, ToolDefinition } from "../../tools/tool-definition";
import { slideNeedsLayoutChoice } from "@shared/presentation-draft";
import {
  agentAskUserResultSchema,
  agentCommandProposalResultSchema,
  type AgentRuntimeResult,
} from "../runtime-types";
import { applyCommandsToDraft } from "./layout-command-utils";
import type { ToolExecutionOutcome } from "../tools/tool-execution-engine";

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
    };

/** Interprets validated tool facts without executing tools or mutating AgentSession. */
export class PresentationCompletionPolicy {
  canTerminate(tool: ToolDefinition<any, any>): boolean {
    return Boolean(tool.behavior?.completion);
  }

  async interpret(input: {
    tool: ToolDefinition<any, any>;
    toolUseId: string;
    outcome: ToolExecutionOutcome;
    context: ToolContext;
    emitProgress(event: { type: string; message: string; [key: string]: unknown }): void;
  }): Promise<PresentationCompletionDecision> {
    const toolName = input.tool.name;
    const result = input.outcome.validatedResult;
    const completion = input.tool.behavior?.completion;
    const commandProposalResult = completion?.terminalResult === "command_proposal"
      ? agentCommandProposalResultSchema.safeParse(result)
      : undefined;
    if (
      commandProposalResult
      && !commandProposalResult.success
      && result
      && typeof result === "object"
      && !Array.isArray(result)
      && (result as { type?: unknown }).type === "command_proposal"
    ) {
      throw new Error(
        `${toolName} returned an invalid command proposal: ${commandProposalResult.error.message}`,
      );
    }
    const commandProposal = commandProposalResult?.success
      ? commandProposalResult.data
      : undefined;

    if (commandProposal) {
      const incompleteSlideIds = findAddedSlidesMissingVisualDesign(
        input.context,
        commandProposal.commands,
      );
      if (
        incompleteSlideIds.length > 0
        && !requestExplicitlyAllowsContentOnly(input.context.request)
      ) {
        const guidance = [
          "本次创建提案中的新页面尚未完成视觉设计，不能作为默认新建结果提交。",
          `以下新页面仍只有内容草稿，缺少实际视觉排版：${incompleteSlideIds.join("、")}。`,
          "请放弃 element/layout 草稿，加载 ppt-workflow，锁定沟通契约与设计语言，",
          "用 WriteFile 编写每页完整 1280×720 SVG，并以 PreviewSvgPage 查看每页当前 PNG，",
          "最后只用 SubmitSvgDeck 提交同一批 SVG。不要让用户选择标准/创意排版或 safe/shifted/bold。",
        ].join("");
        input.emitProgress({
          type: "workflow-warning",
          message: "检测到新页面尚未完成视觉设计，正在自动补全…",
        });
        return {
          type: "continue",
          transcriptEntry: {
            role: "tool",
            toolName,
            result: commandProposal,
            completionPostcondition: {
              status: "incomplete",
              missingVisualDesignSlideIds: incompleteSlideIds,
            },
          },
          modelResult: textResult(input.toolUseId, guidance),
        };
      }
      return {
        type: "terminal",
        result: commandProposal,
        // Even terminal tools must close the provider protocol pair in canonical
        // history. The result is not sent to another model turn, but it is
        // required for resume, export, and cross-provider replay.
        modelResult: input.outcome.modelResult,
      };
    }

    if (completion?.terminalResult === "ask_user") {
      const askUserResult = agentAskUserResultSchema.safeParse(result);
      if (!askUserResult.success) {
        if (completion.expectation === "always") {
          throw new Error(
            `${toolName} must return an ask_user result: ${askUserResult.error.message}`,
          );
        }
      } else {
        const askUser = askUserResult.data;
        return {
          type: "terminal",
          result: askUser,
          modelResult: textResult(input.toolUseId, askUser.content),
        };
      }
    }
    if (
      completion?.terminalResult === "command_proposal"
      && completion.expectation === "always"
    ) {
      const error = commandProposalResult && !commandProposalResult.success
        ? commandProposalResult.error.message
        : "result did not match command_proposal";
      throw new Error(`${toolName} must return a command proposal result: ${error}`);
    }

    if (completion?.terminalResult === "ask_user" && completion.expectation === "always") {
      // The invalid-result branch above always throws; this is an exhaustive
      // guard for future schema/control-flow changes.
      throw new Error(`${toolName} must return an ask_user result.`);
    }

    if (input.outcome.deliveryStatus === "postprocessing_failed") {
      return {
        type: "continue",
        modelResult: input.outcome.modelResult,
        transcriptEntry: {
          role: "tool",
          toolName,
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
        toolName,
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

const CONTENT_ONLY_REQUEST_PATTERNS = [
  /(?:只|仅)(?:要|需|需要|生成|创建|写|输出|提供)?.{0,8}(?:内容|文稿|草稿)/i,
  /(?:不要|无需|暂不|不需要)(?:做|进行|添加)?(?:视觉)?(?:排版|设计|美化)/i,
  /\bcontent[\s-]*only\b/i,
  /\bwithout\s+(?:layout|design|styling)\b/i,
];

export function requestExplicitlyAllowsContentOnly(request: string | undefined): boolean {
  if (!request?.trim()) return false;
  return CONTENT_ONLY_REQUEST_PATTERNS.some((pattern) => pattern.test(request));
}

function findAddedSlidesMissingVisualDesign(
  context: ToolContext,
  commands: Extract<AgentRuntimeResult, { type: "command_proposal" }>["commands"],
): string[] {
  const addedSlideIds = commands.flatMap((command) =>
    command.type === "add-slide" ? [command.slide.id] : []
  );
  if (addedSlideIds.length === 0) return [];
  const addedIdSet = new Set(addedSlideIds);
  const draft = applyCommandsToDraft(context.presentation, commands);
  return draft.slides
    .filter((slide) => addedIdSet.has(slide.id) && slideNeedsLayoutChoice(slide))
    .map((slide) => slide.id);
}

function textResult(toolUseId: string, text: string): AgentModelToolResultBlock {
  return { type: "tool_result", toolUseId, content: [{ type: "text", text }] };
}
