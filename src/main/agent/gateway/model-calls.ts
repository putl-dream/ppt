import { z } from "zod";
import type { AgentModelSelection } from "@shared/agent";
import { textFromContentBlocks, toolUseBlocksFromContent } from "./content-blocks";
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
  | "invalid-json"
  | "schema-validation"
  | "missing-tools"
  | "malformed-tool-use";

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

type BaseOneShotRequest = Omit<
  AgentModelRequest,
  "tools" | "outputFormat" | "requiredToolName" | "responseContract"
>;

export type MarkdownModelRequest = BaseOneShotRequest & {
  responseContract?: Extract<AgentResponseContract, "markdown" | "markdown-summary">;
};

export interface JsonModelCallOptions<T> {
  request: BaseOneShotRequest;
  schema: z.ZodType<T>;
  schemaName?: string;
  description?: string;
}

export type ToolModelRequest = Omit<AgentModelRequest, "outputFormat"> & {
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

function normalizeSchemaName(value: string | undefined): string {
  const normalized = (value ?? "structured_response")
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 64);
  return normalized || "structured_response";
}

function toOutputJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const jsonSchema = z.toJSONSchema(schema, {
    unrepresentable: "throw",
    io: "output",
  }) as Record<string, unknown>;
  delete jsonSchema.$schema;
  return jsonSchema;
}

function assertNoToolCalls(response: AgentModelResponse, mode: "markdown" | "json"): void {
  if (toolUseBlocksFromContent(response.content).length === 0) return;
  throw new ModelOutputError(
    `Model returned tool_use content during a ${mode} call.`,
    "unexpected-tool-use",
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

/** One-shot model call whose public contract is a Zod-validated JSON value. */
export async function callLLMJson<T>(
  gateway: AgentModelGateway,
  options: JsonModelCallOptions<T>,
  selection?: AgentModelSelection,
): Promise<T> {
  const response = await gateway.generateText({
    ...options.request,
    outputFormat: {
      type: "json_schema",
      name: normalizeSchemaName(options.schemaName),
      description: options.description,
      schema: toOutputJsonSchema(options.schema),
      strict: true,
    },
  }, selection);
  assertNoToolCalls(response, "json");

  const text = textFromContentBlocks(response.content);
  let decoded: unknown;
  try {
    decoded = JSON.parse(text);
  } catch (error) {
    throw new ModelOutputError(
      "Model returned invalid JSON for a structured call.",
      "invalid-json",
      error,
    );
  }

  const parsed = options.schema.safeParse(decoded);
  if (!parsed.success) {
    throw new ModelOutputError(
      `Model JSON failed schema validation: ${z.prettifyError(parsed.error)}`,
      "schema-validation",
      parsed.error,
    );
  }
  return parsed.data;
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
