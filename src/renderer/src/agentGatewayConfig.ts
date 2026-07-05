import {
  resolveAgentGatewayPreferences,
  type AgentGatewayConfig,
  type AgentGatewayPreferences,
} from "@shared/agent-gateway-config";
import type { ManagedModel } from "./modelCatalog";
import { isModelEnabled, toAgentModelSettings } from "./modelCatalog";

export const AGENT_GATEWAY_CONFIG_STORAGE_KEY = "agent-ppt.gateway-config.v1";

export function loadAgentGatewayPreferences(): AgentGatewayPreferences {
  try {
    const stored = window.localStorage.getItem(AGENT_GATEWAY_CONFIG_STORAGE_KEY);
    if (!stored) return resolveAgentGatewayPreferences();
    return resolveAgentGatewayPreferences(JSON.parse(stored) as Partial<AgentGatewayPreferences>);
  } catch {
    return resolveAgentGatewayPreferences();
  }
}

export function saveAgentGatewayPreferences(preferences: AgentGatewayPreferences): void {
  window.localStorage.setItem(AGENT_GATEWAY_CONFIG_STORAGE_KEY, JSON.stringify(preferences));
}

export function buildAgentGatewayConfig(
  preferences: AgentGatewayPreferences,
  models: ManagedModel[],
): AgentGatewayConfig {
  const fallbackModel = preferences.fallbackModelId
    ? models.find((model) => model.id === preferences.fallbackModelId && isModelEnabled(model))
    : undefined;

  return {
    timeoutMs: preferences.timeoutMs,
    maxOutputTokens: preferences.maxOutputTokens,
    ...(fallbackModel ? { fallbackModel: toAgentModelSettings(fallbackModel) } : {}),
  };
}
