import { presentationCommandSchema, type PresentationCommand } from "@shared/commands";
import type { AgentModelToolCall } from "../gateway/types";
import type {
  AgentProtocolEnvelope,
  AgentRuntimeResult,
  AgentStructuredEnvelope,
  AgentTextEnvelope,
} from "./runtime-types";
import { parseAgentResponseForConsumer } from "./parse-agent-json-response";

export interface NormalizeModelResponseOptions {
  text: string;
  toolCalls?: AgentModelToolCall[];
}

function assertObject(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Invalid model response: response must be a non-null object.");
  }
  return raw as Record<string, unknown>;
}

function normalizeStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) ? value.map(String) : undefined;
}

function normalizeCommand(raw: unknown, index: number): PresentationCommand {
  const parsed = presentationCommandSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Validation error: command ${index} is invalid: ${parsed.error.message}`);
  }
  return parsed.data;
}

function dataObject(candidate: Record<string, unknown>): Record<string, unknown> {
  return assertObject(candidate.data);
}

export function normalizeMarkdownAssistantMessage(content: string): AgentTextEnvelope {
  const trimmed = content.trim();
  if (!trimmed) {
    throw new Error("Validation error: markdown assistant message must be non-empty.");
  }
  return {
    kind: "text",
    format: "markdown",
    type: "assistant.message",
    data: { content: trimmed },
  };
}

export function normalizeAgentProtocolObject(raw: unknown): AgentProtocolEnvelope {
  const candidate = assertObject(raw);
  const type = candidate.type;
  const data = dataObject(candidate);

  if (type === "tool.call") {
    const toolName = data.toolName;
    if (typeof toolName !== "string" || toolName.trim() === "") {
      throw new Error("Validation error: 'tool.call' data must contain a non-empty string in 'toolName'.");
    }
    return {
      kind: "structured",
      format: "json",
      type: "tool.call",
      data: {
        toolName,
        args: data.args ?? {},
      },
    };
  }

  if (type === "assistant.message") {
    if (candidate.kind !== "text" || candidate.format !== "markdown") {
      throw new Error(
        "Validation error: 'assistant.message' must use the full AgentTextEnvelope shape with kind 'text' and format 'markdown'.",
      );
    }
    const content = data.content;
    if (typeof content !== "string" || content.trim() === "") {
      throw new Error("Validation error: 'assistant.message' data must contain a non-empty string in 'content'.");
    }
    return normalizeMarkdownAssistantMessage(content);
  }

  if (type === "assistant.ask_user") {
    const content = data.content;
    if (typeof content !== "string" || content.trim() === "") {
      throw new Error("Validation error: 'assistant.ask_user' data must contain a non-empty string in 'content'.");
    }
    return {
      kind: "structured",
      format: "json",
      type: "assistant.ask_user",
      data: {
        content,
        missingFields: normalizeStringArray(data.missingFields),
      },
    };
  }

  if (type === "deck.command_proposal") {
    const summary = data.summary;
    if (typeof summary !== "string" || summary.trim() === "") {
      throw new Error("Validation error: 'deck.command_proposal' data must contain a non-empty string in 'summary'.");
    }

    const commandsRaw = data.commands;
    if (!Array.isArray(commandsRaw)) {
      throw new Error("Validation error: 'deck.command_proposal' data must contain an array of 'commands'.");
    }
    if (commandsRaw.length === 0) {
      throw new Error("Validation error: 'deck.command_proposal' data must contain at least one command.");
    }

    const risk = data.risk;
    if (risk !== "low" && risk !== "medium" && risk !== "high") {
      throw new Error(`Validation error: 'deck.command_proposal' contains invalid risk level: '${String(risk)}'.`);
    }

    return {
      kind: "structured",
      format: "json",
      type: "deck.command_proposal",
      data: {
        summary,
        commands: commandsRaw.map(normalizeCommand),
        risk,
        assumptions: normalizeStringArray(data.assumptions),
      },
    };
  }

  throw new Error(
    `Invalid model response type: '${String(type)}'. Expected 'assistant.message', 'tool.call', 'assistant.ask_user' or 'deck.command_proposal'.`,
  );
}

export function normalizeStructuredAgentProtocolObject(raw: unknown): AgentStructuredEnvelope {
  const envelope = normalizeAgentProtocolObject(raw);
  if (envelope.kind !== "structured") {
    throw new Error(`Invalid structured agent response type: '${envelope.type}'.`);
  }
  return envelope;
}

export function normalizeTextAgentResponse(text: string): AgentProtocolEnvelope {
  const parsed = parseAgentResponseForConsumer(text, "text");
  if (parsed.kind === "text") {
    return normalizeAgentProtocolObject(parsed.value);
  }
  return normalizeStructuredAgentProtocolObject(parsed.value);
}

export function normalizeStructuredAgentResponse(text: string): AgentStructuredEnvelope {
  const parsed = parseAgentResponseForConsumer(text, "structured");
  return normalizeStructuredAgentProtocolObject(parsed.value);
}

export function normalizeModelResponseToEnvelope(
  options: NormalizeModelResponseOptions,
): AgentProtocolEnvelope {
  const nativeCall = options.toolCalls?.[0];
  if (nativeCall) {
    return {
      kind: "structured",
      format: "json",
      type: "tool.call",
      data: {
        toolName: nativeCall.name,
        args: nativeCall.args,
      },
    };
  }

  return normalizeStructuredAgentResponse(options.text);
}

export function isAgentRuntimeResult(envelope: AgentProtocolEnvelope): envelope is AgentRuntimeResult {
  return envelope.type !== "tool.call";
}
