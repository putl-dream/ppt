import type { AgentModelSelection } from "@shared/agent";
import { textFromContentBlocks, toolUseBlocksFromContent } from "./content-blocks";
import { isOutputTruncated } from "./errors";
import type {
  AgentModelGateway,
  AgentModelRequest,
  AgentModelResponse,
  AgentModelToolUseBlock,
  AgentResponseContract,
  AgentToolSchema,
} from "./types";

export type ModelOutputErrorCode =
  | "empty-markdown"
  | "unexpected-tool-use"
  | "missing-tools"
  | "malformed-tool-use"
  | "truncated-output";

export class ModelOutputError extends Error {
  constructor(
    message: string,
    readonly code: ModelOutputErrorCode,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "ModelOutputError";
  }
}

type BaseOneShotRequest = Omit<AgentModelRequest, "tools" | "responseContract">;

export type MarkdownModelRequest = BaseOneShotRequest & {
  responseContract?: Extract<AgentResponseContract, "markdown" | "markdown-summary">;
};

export type ToolModelRequest = AgentModelRequest & {
  tools: AgentToolSchema[];
};

export type ToolModelTurn =
  | {
      type: "tool_calls";
      calls: AgentModelToolUseBlock[];
      /** Optional assistant narration that accompanied the native tool calls. */
      markdown?: string;
      response: AgentModelResponse;
    }
  | {
      type: "final";
      markdown: string;
      response: AgentModelResponse;
    };

function assertNoToolCalls(response: AgentModelResponse, mode: "markdown"): void {
  if (toolUseBlocksFromContent(response.content).length === 0) return;
  throw new ModelOutputError(
    `Model returned tool_use content during a ${mode} call.`,
    "unexpected-tool-use",
  );
}

function assertCompleteResponse(response: AgentModelResponse): void {
  if (!isOutputTruncated(response.stopReason)) return;
  throw new ModelOutputError(
    `Model output was truncated (${response.stopReason}); refusing to accept a partial one-shot result.`,
    "truncated-output",
  );
}

/** One-shot model call whose public contract is non-empty Markdown text. */
export async function callLLM(
  gateway: AgentModelGateway,
  request: MarkdownModelRequest,
  selection?: AgentModelSelection,
): Promise<string> {
  const response = await gateway.generateText({
    ...request,
    responseContract: request.responseContract ?? "markdown",
  }, selection);
  assertCompleteResponse(response);
  assertNoToolCalls(response, "markdown");

  const markdown = textFromContentBlocks(response.content);
  if (!markdown) {
    throw new ModelOutputError(
      "Model returned no Markdown text.",
      "empty-markdown",
    );
  }
  return markdown;
}

/**
 * Runs one tool-enabled model turn. This classifies native tool_use blocks but
 * deliberately does not execute them; AgentRuntime owns validation and execution.
 */
export async function callTool(
  gateway: AgentModelGateway,
  request: ToolModelRequest,
  selection?: AgentModelSelection,
): Promise<ToolModelTurn> {
  if (request.tools.length === 0) {
    throw new ModelOutputError(
      "A tool-enabled model call requires at least one tool.",
      "missing-tools",
    );
  }

  const response = await gateway.generateText(request, selection);
  assertCompleteResponse(response);
  const calls = toolUseBlocksFromContent(response.content);
  const malformed = calls.find((call) => !call.id || !call.name);
  if (malformed) {
    throw new ModelOutputError(
      "Model returned a tool_use block without a stable id or name.",
      "malformed-tool-use",
    );
  }

  const markdown = textFromContentBlocks(response.content);
  if (calls.length > 0) {
    return {
      type: "tool_calls",
      calls,
      ...(markdown ? { markdown } : {}),
      response,
    };
  }
  if (!markdown) {
    throw new ModelOutputError(
      "Tool-enabled model call returned neither tool calls nor final Markdown.",
      "empty-markdown",
    );
  }
  return { type: "final", markdown, response };
}
