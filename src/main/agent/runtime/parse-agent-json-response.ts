export const AGENT_JSON_MISSING_TYPE_GUIDANCE =
  'Return exactly one complete JSON object with a "type" field '
  + '(e.g. "assistant.message", "tool.call", "assistant.ask_user", or "deck.command_proposal") '
  + 'and put payload fields under "data". '
  + "Do not include other JSON examples or code snippets before the response object.";

export const AGENT_JSON_PARSE_FAILURE_GUIDANCE =
  "Return exactly one complete JSON object.";

export type AgentResponseConsumer = "structured" | "text";

export type ParsedAgentResponse =
  | { kind: "structured"; format: "json"; value: unknown }
  | { kind: "text"; format: "markdown"; value: string | unknown };

function isAgentProtocolObject(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const type = (value as { type?: unknown }).type;
  return typeof type === "string" && type.length > 0;
}

function protocolType(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const type = (value as { type?: unknown }).type;
  return typeof type === "string" && type.length > 0 ? type : null;
}

function looksLikeBrokenAgentProtocol(text: string): boolean {
  return /^\s*(?:```(?:json)?\s*)?\{\s*"type"\s*:/i.test(text);
}

function tryParseBalancedObject(text: string, start: number): unknown | null {
  const closingTokens: string[] = [];
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const token = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (token === "\\") {
        escaped = true;
      } else if (token === '"') {
        inString = false;
      }
      continue;
    }

    if (token === '"') {
      inString = true;
    } else if (token === "{") {
      closingTokens.push("}");
    } else if (token === "[") {
      closingTokens.push("]");
    } else if (token === "}" || token === "]") {
      if (closingTokens.pop() !== token) break;

      if (closingTokens.length === 0) {
        try {
          return JSON.parse(text.slice(start, index + 1));
        } catch {
          return null;
        }
      }
    }
  }

  return null;
}

/**
 * Extract the first complete JSON object that looks like an agent protocol
 * response (has a string `type` field). Skips earlier balanced objects such as
 * inline code/JSON examples that would otherwise be mis-parsed.
 */
export function parseAgentJsonResponse(text: string): unknown {
  for (let start = text.indexOf("{"); start >= 0; start = text.indexOf("{", start + 1)) {
    const parsed = tryParseBalancedObject(text, start);
    if (parsed === null) continue;
    if (isAgentProtocolObject(parsed)) {
      return parsed;
    }
  }

  throw new Error(
    `Agent Runtime expected one complete JSON object with a "type" field.`,
  );
}

export function parseAgentResponseForConsumer(
  text: string,
  consumer: AgentResponseConsumer,
): ParsedAgentResponse {
  if (consumer === "structured") {
    const parsed = parseAgentJsonResponse(text);
    if (protocolType(parsed) === "assistant.message") {
      throw new Error("Structured agent consumers do not accept assistant.message markdown text.");
    }
    return { kind: "structured", format: "json", value: parsed };
  }

  try {
    const parsed = parseAgentJsonResponse(text);
    if (protocolType(parsed) === "assistant.message") {
      return { kind: "text", format: "markdown", value: parsed };
    }
    return { kind: "structured", format: "json", value: parsed };
  } catch (error) {
    if (looksLikeBrokenAgentProtocol(text)) {
      throw error;
    }
    const content = text.trim();
    if (!content) {
      throw new Error("Agent Runtime expected non-empty markdown text.");
    }
    return { kind: "text", format: "markdown", value: content };
  }
}

export function buildAgentJsonRetryMessage(
  error: unknown,
  parsed?: unknown,
): string {
  if (parsed !== undefined && !isAgentProtocolObject(parsed)) {
    return `${AGENT_JSON_MISSING_TYPE_GUIDANCE}`;
  }
  const base = error instanceof Error ? error.message : "Invalid JSON response.";
  return `${base} ${AGENT_JSON_PARSE_FAILURE_GUIDANCE}`;
}
