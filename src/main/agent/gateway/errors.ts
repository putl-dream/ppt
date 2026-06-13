import type { AgentProvider } from "@shared/agent";

export type AgentGatewayErrorCode =
  | "configuration"
  | "authentication"
  | "rate-limit"
  | "timeout"
  | "empty-response"
  | "provider-error";

export class AgentGatewayError extends Error {
  constructor(
    message: string,
    readonly code: AgentGatewayErrorCode,
    readonly provider?: AgentProvider,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "AgentGatewayError";
  }
}

export function normalizeProviderError(provider: AgentProvider, error: unknown): AgentGatewayError {
  if (error instanceof AgentGatewayError) return error;

  const status = (error as { status?: number }).status;
  const name = (error as { name?: string }).name ?? "";
  const message = error instanceof Error ? error.message : String(error);

  if (status === 401 || status === 403) {
    return new AgentGatewayError(`${provider} authentication failed: ${message}`, "authentication", provider, error);
  }
  if (status === 429) {
    return new AgentGatewayError(`${provider} rate limit exceeded: ${message}`, "rate-limit", provider, error);
  }
  if (status === 408 || /timeout/i.test(name) || /timed out/i.test(message)) {
    return new AgentGatewayError(`${provider} request timed out: ${message}`, "timeout", provider, error);
  }
  return new AgentGatewayError(`${provider} request failed: ${message}`, "provider-error", provider, error);
}
