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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorName(error: unknown): string {
  return (error as { name?: string }).name ?? "";
}

function isAbortLike(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  const name = errorName(error);
  const message = errorMessage(error);
  return name === "APIUserAbortError"
    || name === "AbortError"
    || /aborted/i.test(message)
    || /Request was aborted/i.test(message);
}

function isConnectionTerminated(error: unknown): boolean {
  const message = errorMessage(error);
  return message === "terminated"
    || /connection (?:closed|reset|terminated)/i.test(message)
    || /socket hang up/i.test(message);
}

export function formatRecoverableAgentError(error: unknown, signal?: AbortSignal): string | null {
  if (signal?.aborted || errorMessage(error) === "Run aborted by user.") {
    return "任务已取消。";
  }

  if (error instanceof AgentGatewayError) {
    switch (error.code) {
      case "timeout":
        return `${error.message} 请重试，或在设置 / 环境变量中增大 AGENT_TIMEOUT_MS。`;
      case "rate-limit":
        return `${error.message} 请稍后再试。`;
      case "authentication":
        return `${error.message} 请检查 API Key 与代理地址。`;
      case "provider-error":
        if (isConnectionTerminated(error) || isConnectionTerminated(error.cause)) {
          return "与模型的连接中断（terminated）。常见于长时间思考无输出、代理超时或网络波动。请直接重试；若反复出现，可增大 AGENT_TIMEOUT_MS 或更换直连端点。";
        }
        return `${error.message} 请重试；若持续失败，请检查网络与模型配置。`;
      default:
        return `${error.message} 请重试。`;
    }
  }

  if (isAbortLike(error, signal)) {
    return "任务已取消。";
  }

  if (isConnectionTerminated(error)) {
    return "与模型的连接中断（terminated）。请重试；若使用代理，请检查其超时设置。";
  }

  return null;
}

export function normalizeProviderError(
  provider: AgentProvider,
  error: unknown,
  signal?: AbortSignal,
): AgentGatewayError {
  if (error instanceof AgentGatewayError) return error;

  if (isAbortLike(error, signal)) {
    return new AgentGatewayError("Run aborted by user.", "provider-error", provider, error);
  }

  const status = (error as { status?: number }).status;
  const name = errorName(error);
  const message = errorMessage(error);

  if (status === 401 || status === 403) {
    return new AgentGatewayError(`${provider} authentication failed: ${message}`, "authentication", provider, error);
  }
  if (status === 429) {
    return new AgentGatewayError(`${provider} rate limit exceeded: ${message}`, "rate-limit", provider, error);
  }
  if (status === 408 || /timeout/i.test(name) || /timed out/i.test(message)) {
    return new AgentGatewayError(
      `${provider} request timed out: ${message}. Increase AGENT_TIMEOUT_MS if this model or endpoint needs more time.`,
      "timeout",
      provider,
      error,
    );
  }
  if (isConnectionTerminated(error)) {
    return new AgentGatewayError(
      `${provider} connection terminated: ${message}. This often happens during long thinking with no stream output, proxy idle timeouts, or unstable networks.`,
      "provider-error",
      provider,
      error,
    );
  }
  return new AgentGatewayError(`${provider} request failed: ${message}`, "provider-error", provider, error);
}
