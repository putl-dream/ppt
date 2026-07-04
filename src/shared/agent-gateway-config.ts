import { z } from "zod";
import { agentModelSettingsSchema } from "./agent";

export const DEFAULT_AGENT_GATEWAY_CONFIG = {
  timeoutMs: 180_000,
  maxOutputTokens: 16_384,
} as const;

/** Persisted in renderer settings (fallback resolved to full model at run time). */
export const agentGatewayPreferencesSchema = z.object({
  timeoutMs: z.number().int().positive().default(DEFAULT_AGENT_GATEWAY_CONFIG.timeoutMs),
  maxOutputTokens: z.number().int().positive().default(DEFAULT_AGENT_GATEWAY_CONFIG.maxOutputTokens),
  fallbackModelId: z.string().trim().optional(),
});

/** Passed to main process with each Agent run. */
export const agentGatewayConfigSchema = z.object({
  timeoutMs: z.number().int().positive().default(DEFAULT_AGENT_GATEWAY_CONFIG.timeoutMs),
  maxOutputTokens: z.number().int().positive().default(DEFAULT_AGENT_GATEWAY_CONFIG.maxOutputTokens),
  fallbackModel: agentModelSettingsSchema.optional(),
});

export type AgentGatewayPreferences = z.infer<typeof agentGatewayPreferencesSchema>;
export type AgentGatewayConfig = z.infer<typeof agentGatewayConfigSchema>;

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
