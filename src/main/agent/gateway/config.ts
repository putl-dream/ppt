import type { AgentModelSelection, AgentModelSettings, AgentProvider } from "@shared/agent";
import {
  DEFAULT_AGENT_GATEWAY_CONFIG,
  type AgentGatewayConfig,
} from "@shared/agent-gateway-config";
import { AgentGatewayError } from "./errors";
import type { ResolvedAgentModelConfig } from "./types";

export const DEFAULT_AGENT_MODELS: Record<AgentProvider, string> = {
  openai: "gpt-5.5",
  anthropic: "claude-sonnet-4-6",
};

export const DEFAULT_AGENT_TIMEOUT_MS = DEFAULT_AGENT_GATEWAY_CONFIG.timeoutMs;
export const DEFAULT_AGENT_MAX_OUTPUT_TOKENS = DEFAULT_AGENT_GATEWAY_CONFIG.maxOutputTokens;

function positiveInteger(value: string | undefined, fallback: number, name: string): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new AgentGatewayError(`${name} must be a positive integer.`, "configuration");
  }
  return parsed;
}

function inferProvider(env: NodeJS.ProcessEnv): AgentProvider {
  const configured = env.AGENT_PROVIDER?.trim().toLowerCase();
  if (configured === "openai" || configured === "anthropic") return configured;
  if (configured) {
    throw new AgentGatewayError(
      `Unsupported AGENT_PROVIDER: ${configured}. Expected openai or anthropic.`,
      "configuration",
    );
  }
  return env.ANTHROPIC_API_KEY && !env.OPENAI_API_KEY ? "anthropic" : "openai";
}

function resolveOpenAIApiMode(
  provider: AgentProvider,
  baseURL: string | undefined,
  runtimeMode: AgentModelSettings["openaiApiMode"],
  env: NodeJS.ProcessEnv,
): "responses" | "chat-completions" | undefined {
  if (provider !== "openai") return undefined;
  if (runtimeMode) return runtimeMode;
  const configured = env.OPENAI_API_MODE?.trim().toLowerCase();
  if (configured === "responses" || configured === "chat-completions") return configured;
  if (configured) {
    throw new AgentGatewayError(
      `Unsupported OPENAI_API_MODE: ${configured}. Expected responses or chat-completions.`,
      "configuration",
      "openai",
    );
  }
  return baseURL ? "chat-completions" : "responses";
}

export function resolveFallbackModelSelection(
  current: AgentModelSelection | undefined,
  gatewayConfig?: AgentGatewayConfig,
  env: NodeJS.ProcessEnv = process.env,
): AgentModelSelection | undefined {
  const configured = gatewayConfig?.fallbackModel;
  if (configured) {
    if (current?.provider === configured.provider && current.model === configured.model) {
      return undefined;
    }
    return { provider: configured.provider, model: configured.model };
  }

  const fallbackProvider = env.AGENT_FALLBACK_PROVIDER?.trim().toLowerCase();
  const fallbackModel = env.AGENT_FALLBACK_MODEL?.trim();
  if (fallbackProvider !== "openai" && fallbackProvider !== "anthropic") {
    return undefined;
  }
  if (!fallbackModel) return undefined;
  if (current?.provider === fallbackProvider && current.model === fallbackModel) {
    return undefined;
  }
  return { provider: fallbackProvider, model: fallbackModel };
}

export function resolveAgentModelConfig(
  selection: AgentModelSelection | undefined,
  runtimeSettings: Partial<Record<AgentProvider, AgentModelSettings>>,
  env: NodeJS.ProcessEnv = process.env,
  gatewayConfig?: AgentGatewayConfig,
): ResolvedAgentModelConfig {
  const provider = selection?.provider ?? inferProvider(env);
  const runtime = runtimeSettings[provider];
  const apiKey = runtime?.apiKey ??
    (provider === "openai" ? env.OPENAI_API_KEY : env.ANTHROPIC_API_KEY);

  if (!apiKey) {
    throw new AgentGatewayError(
      `No API key configured for ${provider}. Open Settings → 模型 and enter an API key for the active model.`,
      "configuration",
      provider,
    );
  }

  const providerModel = provider === "openai" ? env.OPENAI_MODEL : env.ANTHROPIC_MODEL;
  const model = selection?.model || runtime?.model || env.AGENT_MODEL || providerModel || DEFAULT_AGENT_MODELS[provider];
  const environmentBaseURL = provider === "openai" ? env.OPENAI_BASE_URL : env.ANTHROPIC_BASE_URL;
  const baseURL = runtime?.baseURL ?? environmentBaseURL;

  return {
    provider,
    model,
    apiKey,
    baseURL,
    openaiApiMode: resolveOpenAIApiMode(provider, baseURL, runtime?.openaiApiMode, env),
    timeoutMs: gatewayConfig?.timeoutMs
      ?? positiveInteger(env.AGENT_TIMEOUT_MS, DEFAULT_AGENT_TIMEOUT_MS, "AGENT_TIMEOUT_MS"),
    maxOutputTokens: gatewayConfig?.maxOutputTokens
      ?? positiveInteger(env.AGENT_MAX_OUTPUT_TOKENS, DEFAULT_AGENT_MAX_OUTPUT_TOKENS, "AGENT_MAX_OUTPUT_TOKENS"),
  };
}
