import { z } from "zod";
import { agentModelSettingsSchema } from "./agent";

export const DEFAULT_AGENT_GATEWAY_CONFIG = {
  timeoutMs: 180_000,
  maxOutputTokens: 16_384,
} as const;

export const DEFAULT_AGENT_SEARCH_CONFIG = {
  webSearchTimeoutMs: 20_000,
} as const;

/** Persisted in renderer settings (fallback resolved to full model at run time). */
export const agentGatewayPreferencesSchema = z.object({
  timeoutMs: z.number().int().positive().default(DEFAULT_AGENT_GATEWAY_CONFIG.timeoutMs),
  maxOutputTokens: z.number().int().positive().default(DEFAULT_AGENT_GATEWAY_CONFIG.maxOutputTokens),
  fallbackModelId: z.string().trim().optional(),
  webSearchApiKey: z.string().trim().optional(),
  webSearchEndpoint: z.string().trim().optional(),
  webSearchTimeoutMs: z.number().int().positive().optional(),
});

/** Model-gateway runtime parameters passed into AgentGateway. */
export const agentGatewayConfigSchema = z.object({
  timeoutMs: z.number().int().positive().default(DEFAULT_AGENT_GATEWAY_CONFIG.timeoutMs),
  maxOutputTokens: z.number().int().positive().default(DEFAULT_AGENT_GATEWAY_CONFIG.maxOutputTokens),
  fallbackModel: agentModelSettingsSchema.optional(),
});

/** External search credentials; not part of the model gateway contract. */
export const agentSearchConfigSchema = z.object({
  webSearchApiKey: z.string().trim().optional(),
  webSearchEndpoint: z.string().trim().optional(),
  webSearchTimeoutMs: z.number().int().positive().optional(),
});

/**
 * Wire / legacy flat payload that may still combine gateway + search fields.
 * Main process splits this once at the IPC boundary.
 */
export const agentRunServicesWireSchema = agentGatewayConfigSchema.merge(agentSearchConfigSchema);

export type AgentGatewayPreferences = z.infer<typeof agentGatewayPreferencesSchema>;
export type AgentGatewayConfig = z.infer<typeof agentGatewayConfigSchema>;
export type AgentSearchConfig = z.infer<typeof agentSearchConfigSchema>;
export type AgentRunServicesWire = z.infer<typeof agentRunServicesWireSchema>;

export function resolveAgentGatewayPreferences(
  input?: Partial<AgentGatewayPreferences>,
): AgentGatewayPreferences {
  return agentGatewayPreferencesSchema.parse({
    ...DEFAULT_AGENT_GATEWAY_CONFIG,
    ...input,
  });
}

export function resolveAgentGatewayConfig(
  input?: Partial<AgentGatewayConfig>,
): AgentGatewayConfig {
  return agentGatewayConfigSchema.parse({
    ...DEFAULT_AGENT_GATEWAY_CONFIG,
    ...input,
  });
}

export function resolveAgentSearchConfig(
  input?: Partial<AgentSearchConfig>,
): AgentSearchConfig {
  return agentSearchConfigSchema.parse({
    ...input,
  });
}

/** Split a legacy flat run-services payload into gateway + search configs. */
export function splitAgentRunServicesConfig(
  input?: Partial<AgentRunServicesWire>,
): { gateway: AgentGatewayConfig; search: AgentSearchConfig } {
  const parsed = agentRunServicesWireSchema.parse({
    ...DEFAULT_AGENT_GATEWAY_CONFIG,
    ...input,
  });
  return {
    gateway: {
      timeoutMs: parsed.timeoutMs,
      maxOutputTokens: parsed.maxOutputTokens,
      ...(parsed.fallbackModel ? { fallbackModel: parsed.fallbackModel } : {}),
    },
    search: {
      ...(parsed.webSearchApiKey ? { webSearchApiKey: parsed.webSearchApiKey } : {}),
      ...(parsed.webSearchEndpoint ? { webSearchEndpoint: parsed.webSearchEndpoint } : {}),
      ...(parsed.webSearchTimeoutMs ? { webSearchTimeoutMs: parsed.webSearchTimeoutMs } : {}),
    },
  };
}
