import type { AgentProvider } from "@shared/agent";

export type AgentGatewayErrorCode =
  | "configuration"
  | "authentication"
  | "rate-limit"
  | "overloaded"
  | "prompt-too-long"
  | "timeout"
  | "empty-response"
  | "provider-error";

export type GatewayRecoveryKind =
  | "retry-backoff"
  | "compact-context"
  | "upgrade-output-tokens"
  | "continue-output"
  | "switch-fallback-model"
  | "non-recoverable";

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
    return "会话已中断。";
  }

  if (error instanceof AgentGatewayError) {
    switch (error.code) {
      case "timeout":
        return `${error.message} 请重试，或在设置 → 工作流中增大请求超时时间。`;
      case "rate-limit":
      case "overloaded":
        return `${error.message} 请稍后再试。`;
      case "prompt-too-long":
        return `${error.message} 上下文过长，系统已尝试压缩后重试。`;
      case "authentication":
        return `${error.message} 请检查 API Key 与代理地址。`;
      case "provider-error":
        if (isConnectionTerminated(error) || isConnectionTerminated(error.cause)) {
          return "与模型的连接中断（terminated）。常见于长时间思考无输出、代理超时或网络波动。请直接重试；若反复出现，可在设置中增大请求超时或更换端点。";
        }
        return `${error.message} 请重试；若持续失败，请检查网络与模型配置。`;
      default:
        return `${error.message} 请重试。`;
    }
  }

  if (isAbortLike(error, signal)) {
    return "会话已中断。";
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
  if (status === 529) {
    return new AgentGatewayError(`${provider} service overloaded: ${message}`, "overloaded", provider, error);
  }
  if (status === 400 && isPromptTooLongMessage(message)) {
    return new AgentGatewayError(`${provider} prompt too long: ${message}`, "prompt-too-long", provider, error);
  }
  if (status === 408 || /timeout/i.test(name) || /timed out/i.test(message)) {
    return new AgentGatewayError(
      `${provider} request timed out: ${message}. Increase the request timeout in Settings → 工作流 if this model needs more time.`,
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
  if (isPromptTooLongMessage(message)) {
    return new AgentGatewayError(`${provider} prompt too long: ${message}`, "prompt-too-long", provider, error);
  }
  return new AgentGatewayError(`${provider} request failed: ${message}`, "provider-error", provider, error);
}

function isPromptTooLongMessage(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes("prompt is too long")
    || normalized.includes("prompt_too_long")
    || normalized.includes("context length")
    || normalized.includes("context_length")
    || normalized.includes("maximum context")
    || normalized.includes("too many tokens")
    || normalized.includes("token limit")
    || normalized.includes("exceeds the maximum");
}

export function isOutputTruncated(stopReason?: string): boolean {
  if (!stopReason) return false;
  const normalized = stopReason.toLowerCase();
  return normalized === "max_tokens"
    || normalized === "length"
    || normalized === "model_length"
    || normalized === "output_length";
}

export function classifyGatewayRecovery(error: unknown): GatewayRecoveryKind {
  if (error instanceof AgentGatewayError) {
    switch (error.code) {
      case "rate-limit":
      case "overloaded":
        return "retry-backoff";
      case "prompt-too-long":
        return "compact-context";
      case "timeout":
        return "non-recoverable";
      case "provider-error":
        return "retry-backoff";
      default:
        return "non-recoverable";
    }
  }

  const status = (error as { status?: number }).status;
  if (status === 429 || status === 529) return "retry-backoff";
  if (status === 408) return "retry-backoff";
  if (isConnectionTerminated(error)) return "retry-backoff";

  const message = errorMessage(error);
  if (isPromptTooLongMessage(message)) return "compact-context";

  return "non-recoverable";
}

export function isAbortError(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  if (errorMessage(error) === "Run aborted by user.") return true;
  return isAbortLike(error, signal);
}
