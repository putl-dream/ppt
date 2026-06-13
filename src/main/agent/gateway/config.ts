import type { AgentModelSelection, AgentModelSettings, AgentProvider } from "@shared/agent";
import { AgentGatewayError } from "./errors";
import type { ResolvedAgentModelConfig } from "./types";

export const DEFAULT_AGENT_MODELS: Record<AgentProvider, string> = {
  openai: "gpt-5.5",
  anthropic: "claude-sonnet-4-6",
};

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

export function resolveAgentModelConfig(
  selection: AgentModelSelection | undefined,
  runtimeSettings: Partial<Record<AgentProvider, AgentModelSettings>>,
  env: NodeJS.ProcessEnv = process.env,
): ResolvedAgentModelConfig {
  const provider = selection?.provider ?? inferProvider(env);
  const runtime = runtimeSettings[provider];
  const apiKey = runtime?.apiKey ??
    (provider === "openai" ? env.OPENAI_API_KEY : env.ANTHROPIC_API_KEY);

  if (!apiKey) {
    const variable = provider === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY";
    throw new AgentGatewayError(
      `No API key configured for ${provider}. Enter one in settings or set ${variable}.`,
      "configuration",
      provider,
    );
  }

  const providerModel = provider === "openai" ? env.OPENAI_MODEL : env.ANTHROPIC_MODEL;
  const model = selection?.model || runtime?.model || env.AGENT_MODEL || providerModel || DEFAULT_AGENT_MODELS[provider];
  const baseURL = provider === "openai" ? env.OPENAI_BASE_URL : env.ANTHROPIC_BASE_URL;

  return {
    provider,
    model,
    apiKey,
    baseURL,
    timeoutMs: positiveInteger(env.AGENT_TIMEOUT_MS, 60_000, "AGENT_TIMEOUT_MS"),
    maxOutputTokens: positiveInteger(env.AGENT_MAX_OUTPUT_TOKENS, 2_048, "AGENT_MAX_OUTPUT_TOKENS"),
  };
}
