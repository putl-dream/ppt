import type { AgentRuntimeResult } from "./runtime-types";
import { presentationCommandSchema } from "@shared/commands";

export class RuntimeNormalizer {
  static normalize(raw: unknown): AgentRuntimeResult {
    if (!raw || typeof raw !== "object") {
      throw new Error("Invalid model response: response must be a non-null object.");
    }

    const type = (raw as { type?: unknown }).type;
    if (type !== "message" && type !== "ask_user" && type !== "command_proposal") {
      throw new Error(`Invalid model response type: '${String(type)}'. Expected 'message', 'ask_user' or 'command_proposal'.`);
    }

    if (type === "message") {
      const content = (raw as { content?: unknown }).content;
      if (typeof content !== "string" || content.trim() === "") {
        throw new Error("Validation error: 'message' response must contain a non-empty string in 'content'.");
      }
      return { type: "message", content };
    }

    if (type === "ask_user") {
      const message = (raw as { message?: unknown }).message;
      if (typeof message !== "string" || message.trim() === "") {
        throw new Error("Validation error: 'ask_user' response must contain a non-empty string in 'message'.");
      }
      const missingFields = (raw as { missingFields?: unknown }).missingFields;
      return {
        type: "ask_user",
        message,
        missingFields: Array.isArray(missingFields) ? missingFields.map(String) : undefined,
      };
    }

    const summary = (raw as { summary?: unknown }).summary;
    if (typeof summary !== "string" || summary.trim() === "") {
      throw new Error("Validation error: 'command_proposal' response must contain a non-empty string in 'summary'.");
    }

    const commandsRaw = (raw as { commands?: unknown }).commands;
    if (!Array.isArray(commandsRaw)) {
      throw new Error("Validation error: 'command_proposal' response must contain an array of 'commands'.");
    }
    if (commandsRaw.length === 0) {
      throw new Error("Validation error: 'command_proposal' must contain at least one command.");
    }
    const commands = commandsRaw.map((command: unknown, index: number) => {
      const parsed = presentationCommandSchema.safeParse(command);
      if (!parsed.success) {
        throw new Error(`Validation error: command ${index} is invalid: ${parsed.error.message}`);
      }
      return parsed.data;
    });

    const risk = (raw as { risk?: unknown }).risk;
    if (risk !== "low" && risk !== "medium" && risk !== "high") {
      throw new Error(`Validation error: 'command_proposal' contains invalid risk level: '${String(risk)}'.`);
    }

    const assumptions = (raw as { assumptions?: unknown }).assumptions;
    return {
      type: "command_proposal",
      summary,
      commands,
      risk,
      assumptions: Array.isArray(assumptions) ? assumptions.map(String) : undefined,
    };
  }
}
