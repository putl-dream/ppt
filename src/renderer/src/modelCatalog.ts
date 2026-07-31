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
  supports1MContext?: boolean;
  enabled?: boolean;
  builtIn?: boolean;
  pricing?: ModelTokenPricing;
}

export type ModelVendorId = "openai" | "anthropic" | "deepseek" | "custom";
export type PresetModelVendorId = Exclude<ModelVendorId, "custom">;

export interface ModelVendorPreset {
  id: PresetModelVendorId;
  label: string;
  hint: string;
  defaultProvider: AgentProvider;
  supportedProviders: readonly AgentProvider[];
  baseURLs: Partial<Record<AgentProvider, string>>;
  defaultModelId: string;
  models: readonly ManagedModel[];
}

export interface ModelVendorDraft {
  vendorId: ModelVendorId;
  protocol: AgentProvider;
  baseURL: string;
  apiKey: string;
  models: ManagedModel[];
}

export const MODEL_VENDOR_PRESETS: readonly ModelVendorPreset[] = [
  {
    id: "openai",
    label: "OpenAI",
    hint: "官方 Responses API",
    defaultProvider: "openai",
    supportedProviders: ["openai"],
    baseURLs: { openai: "https://api.openai.com/v1" },
    defaultModelId: "openai-gpt-5-5",
    models: [
      {
        id: "openai-gpt-5-5",
        name: "OpenAI GPT-5.5",
        provider: "openai",
        model: "gpt-5.5",
        apiKey: "",
        baseURL: "https://api.openai.com/v1",
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
        baseURL: "https://api.openai.com/v1",
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
    ],
  },
  {
    id: "anthropic",
    label: "Anthropic",
    hint: "官方 Messages API",
    defaultProvider: "anthropic",
    supportedProviders: ["anthropic"],
    baseURLs: { anthropic: "https://api.anthropic.com" },
    defaultModelId: "anthropic-sonnet-4-6",
    models: [
      {
        id: "anthropic-sonnet-4-6",
        name: "Anthropic Claude Sonnet 4.6",
        provider: "anthropic",
        model: "claude-sonnet-4-6",
        apiKey: "",
        baseURL: "https://api.anthropic.com",
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
        baseURL: "https://api.anthropic.com",
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
    ],
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    hint: "V4 Flash 与 V4 Pro",
    defaultProvider: "anthropic",
    supportedProviders: ["anthropic", "openai"],
    baseURLs: {
      anthropic: "https://api.deepseek.com/anthropic",
      openai: "https://api.deepseek.com",
    },
    defaultModelId: "deepseek-v4-flash",
    models: [
      {
        id: "deepseek-v4-flash",
        name: "DeepSeek V4 Flash",
        provider: "anthropic",
        model: "deepseek-v4-flash",
        apiKey: "",
        baseURL: "https://api.deepseek.com/anthropic",
        openaiApiMode: "responses",
        supports1MContext: true,
        enabled: true,
        builtIn: true,
      },
      {
        id: "deepseek-v4-pro",
        name: "DeepSeek V4 Pro",
        provider: "anthropic",
        model: "deepseek-v4-pro",
        apiKey: "",
        baseURL: "https://api.deepseek.com/anthropic",
        openaiApiMode: "chat-completions",
        supports1MContext: true,
        enabled: true,
        builtIn: true,
      },
    ],
  },
] as const;

export const MODEL_VENDOR_MODELS: ManagedModel[] = MODEL_VENDOR_PRESETS.flatMap((preset) =>
  preset.models.map((model) => ({ ...model })),
);

export const MODEL_STORAGE_KEY = "agent-ppt.models.v1";
export const SELECTED_MODEL_STORAGE_KEY = "agent-ppt.selected-model.v1";

function normalizedBaseURL(value: string | undefined): string {
  return (value ?? "").trim().replace(/\/+$/, "").toLowerCase();
}

function isSameModel(left: ManagedModel, right: ManagedModel): boolean {
  return left.id === right.id || (
    left.provider === right.provider
    && left.model === right.model
    && normalizedBaseURL(left.baseURL) === normalizedBaseURL(right.baseURL)
  );
}

export function getModelVendorPreset(
  vendorId: ModelVendorId,
): ModelVendorPreset | undefined {
  return MODEL_VENDOR_PRESETS.find((preset) => preset.id === vendorId);
}

export function buildModelVendorDraft(
  vendorId: ModelVendorId,
  existingModels: readonly ManagedModel[],
  customModelId = `custom-${crypto.randomUUID()}`,
): ModelVendorDraft {
  const preset = getModelVendorPreset(vendorId);
  if (!preset) {
    return {
      vendorId: "custom",
      protocol: "openai",
      baseURL: "",
      apiKey: "",
      models: [{
        id: customModelId,
        name: "自定义模型",
        provider: "openai",
        model: "",
        apiKey: "",
        baseURL: "",
        openaiApiMode: "chat-completions",
        supports1MContext: false,
        enabled: true,
      }],
    };
  }

  const models = preset.models.map((defaultModel) => ({
    ...defaultModel,
    ...existingModels.find((model) => model.id === defaultModel.id),
  }));
  const configuredReference = models.find((model) => model.apiKey.trim()) ?? models[0];
  const protocol = configuredReference
    && preset.supportedProviders.includes(configuredReference.provider)
    ? configuredReference.provider
    : preset.defaultProvider;
  const configuredKeys = [...new Set(
    models.map((model) => model.apiKey.trim()).filter(Boolean),
  )];

  return {
    vendorId,
    protocol,
    baseURL: configuredReference?.baseURL.trim()
      || preset.baseURLs[protocol]
      || "",
    apiKey: configuredKeys.length === 1 ? configuredKeys[0] : "",
    models,
  };
}

export function changeModelVendorDraftProtocol(
  draft: ModelVendorDraft,
  protocol: AgentProvider,
): ModelVendorDraft {
  const preset = getModelVendorPreset(draft.vendorId);
  const baseURL = preset?.baseURLs[protocol] ?? draft.baseURL;
  return {
    ...draft,
    protocol,
    baseURL,
    models: draft.models.map((model) => {
      const defaultModel = preset?.models.find((candidate) => candidate.id === model.id);
      return {
        ...model,
        provider: protocol,
        baseURL,
        openaiApiMode: protocol === "openai"
          ? defaultModel?.openaiApiMode ?? model.openaiApiMode
          : model.openaiApiMode,
      };
    }),
  };
}

export function materializeModelVendorDraft(draft: ModelVendorDraft): ManagedModel[] {
  const apiKey = draft.apiKey.trim();
  const baseURL = draft.baseURL.trim().replace(/\/+$/, "");
  return draft.models.map((model) => ({
    ...model,
    name: model.name.trim(),
    provider: draft.protocol,
    model: model.model.trim(),
    apiKey,
    baseURL,
    enabled: true,
    builtIn: false,
  }));
}

export function loadManagedModels(): ManagedModel[] {
  try {
    const stored = window.localStorage.getItem(MODEL_STORAGE_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored) as ManagedModel[];
    if (!Array.isArray(parsed) || parsed.length === 0) return [];
    return parsed.filter(
      (item) => item && item.id && item.name && item.model &&
        (item.provider === "openai" || item.provider === "anthropic"),
    ).flatMap((item) => {
      const bundledModel = MODEL_VENDOR_MODELS.find((model) => isSameModel(item, model));
      if (bundledModel && !item.apiKey.trim()) return [];
      return {
        ...item,
        ...(bundledModel ? { builtIn: false } : {}),
        supports1MContext: item.supports1MContext === true,
        enabled: item.enabled !== false,
        pricing: bundledModel?.pricing ?? item.pricing,
      };
    });
  } catch {
    return [];
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
    supports1MContext: model.supports1MContext === true,
  };
}
