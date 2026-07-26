import type { AgentModelSettings, AgentProvider } from "@shared/agent";

export interface ModelTokenPricing {
  inputPerMillionUsd: number;
  cachedInputPerMillionUsd: number;
  cacheCreationInputPerMillionUsd?: number;
  outputPerMillionUsd: number;
  updatedAt: string;
}

export interface ManagedModel {
  id: string;
  name: string;
  provider: AgentProvider;
  model: string;
  apiKey: string;
  baseURL: string;
  openaiApiMode: "responses" | "chat-completions";
  enabled?: boolean;
  builtIn?: boolean;
  pricing?: ModelTokenPricing;
}

export const DEFAULT_MODELS: ManagedModel[] = [
  {
    id: "openai-gpt-5-5",
    name: "OpenAI GPT-5.5",
    provider: "openai",
    model: "gpt-5.5",
    apiKey: "",
    baseURL: "",
    openaiApiMode: "responses",
    enabled: true,
    builtIn: true,
    pricing: {
      inputPerMillionUsd: 5,
      cachedInputPerMillionUsd: 0.5,
      outputPerMillionUsd: 30,
      updatedAt: "2026-07-26",
    },
  },
  {
    id: "openai-gpt-5-mini",
    name: "OpenAI GPT-5 mini",
    provider: "openai",
    model: "gpt-5-mini",
    apiKey: "",
    baseURL: "",
    openaiApiMode: "responses",
    enabled: true,
    builtIn: true,
    pricing: {
      inputPerMillionUsd: 0.25,
      cachedInputPerMillionUsd: 0.025,
      outputPerMillionUsd: 2,
      updatedAt: "2026-07-26",
    },
  },
  {
    id: "anthropic-sonnet-4-6",
    name: "Anthropic Claude Sonnet 4.6",
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    apiKey: "",
    baseURL: "",
    openaiApiMode: "responses",
    enabled: true,
    builtIn: true,
    pricing: {
      inputPerMillionUsd: 3,
      cachedInputPerMillionUsd: 0.3,
      cacheCreationInputPerMillionUsd: 3.75,
      outputPerMillionUsd: 15,
      updatedAt: "2026-07-26",
    },
  },
  {
    id: "anthropic-opus-4-6",
    name: "Anthropic Claude Opus 4.6",
    provider: "anthropic",
    model: "claude-opus-4-6",
    apiKey: "",
    baseURL: "",
    openaiApiMode: "responses",
    enabled: true,
    builtIn: true,
    pricing: {
      inputPerMillionUsd: 5,
      cachedInputPerMillionUsd: 0.5,
      cacheCreationInputPerMillionUsd: 6.25,
      outputPerMillionUsd: 25,
      updatedAt: "2026-07-26",
    },
  },
];

export const MODEL_STORAGE_KEY = "agent-ppt.models.v1";
export const SELECTED_MODEL_STORAGE_KEY = "agent-ppt.selected-model.v1";

export function loadManagedModels(): ManagedModel[] {
  try {
    const stored = window.localStorage.getItem(MODEL_STORAGE_KEY);
    if (!stored) return DEFAULT_MODELS;
    const parsed = JSON.parse(stored) as ManagedModel[];
    if (!Array.isArray(parsed) || parsed.length === 0) return DEFAULT_MODELS;
    return parsed.filter(
      (item) => item && item.id && item.name && item.model &&
        (item.provider === "openai" || item.provider === "anthropic"),
    ).map((item) => {
      const builtIn = DEFAULT_MODELS.find((model) =>
        model.provider === item.provider
        && model.model === item.model
        && !(item.baseURL ?? "").trim());
      return {
        ...item,
        enabled: item.enabled !== false,
        pricing: builtIn?.pricing,
      };
    });
  } catch {
    return DEFAULT_MODELS;
  }
}

export function isModelEnabled(model: ManagedModel): boolean {
  return model.enabled !== false;
}

export function toAgentModelSettings(model: ManagedModel): AgentModelSettings {
  return {
    provider: model.provider,
    model: model.model.trim(),
    apiKey: model.apiKey.trim() || undefined,
    baseURL: model.baseURL.trim() || undefined,
    openaiApiMode: model.provider === "openai" ? model.openaiApiMode : undefined,
  };
}
