import type { AgentGatewayPreferences } from "@shared/agent-gateway-config";
import type { AgentStepLimits } from "@shared/agent-step-limits";
import { loadAgentGatewayPreferences } from "../agentGatewayConfig";
import { loadAgentStepLimits } from "../agentStepLimits";
import {
  DEFAULT_MODELS,
  SELECTED_MODEL_STORAGE_KEY,
  loadManagedModels,
  type ManagedModel,
} from "../modelCatalog";

export const UI_SETTINGS_STORAGE_KEY = "agent-ppt.ui-settings.v1";

export type UiThemeMode = "light" | "dark" | "cyan" | "orange";
export type UiAccentColor = "cyan" | "green" | "purple" | "orange";
export type UiControlShape = "sharp" | "soft" | "round";
export type UiReadingTone = "classic" | "cyan" | "orange";

export interface PersistedUiSettings {
  autoDownload: boolean;
  autoCloudSync: boolean;
  defaultRatio: "16:9" | "4:3";
  themeMode: UiThemeMode | "system";
  uiAccentColor: UiAccentColor;
  uiControlShape: UiControlShape;
  uiReadingTone: UiReadingTone;
  borderRadiusScale: number;
  colorContrastOffset: number;
  selectedTheme: string;
  selectedPalette: string;
  logoUrl: string | null;
}

export interface AppBootstrapSnapshot {
  persistedUiSettings: Partial<PersistedUiSettings>;
  initialThemeMode: UiThemeMode;
  models: ManagedModel[];
  selectedModelId: string;
  agentStepLimits: AgentStepLimits;
  agentGatewayPreferences: AgentGatewayPreferences;
}

function getBrowserStorage(): Storage | undefined {
  return typeof window === "undefined" ? undefined : window.localStorage;
}

function readStorageItem(key: string): string | null {
  try {
    return getBrowserStorage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function loadPersistedUiSettings(): Partial<PersistedUiSettings> {
  try {
    const stored = readStorageItem(UI_SETTINGS_STORAGE_KEY);
    if (!stored) return {};
    const parsed = JSON.parse(stored) as Partial<PersistedUiSettings>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function savePersistedUiSettings(settings: PersistedUiSettings): void {
  try {
    getBrowserStorage()?.setItem(UI_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch (error) {
    console.error("保存 UI 设置失败:", error);
  }
}

function prefersDarkColorScheme(): boolean {
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function resolveInitialThemeMode(settings: Partial<PersistedUiSettings>): UiThemeMode {
  const mode = settings.themeMode;
  if (mode === "dark" || mode === "cyan" || mode === "orange") return mode;
  if (mode === "system") return prefersDarkColorScheme() ? "dark" : "light";

  const legacyTone = settings.uiReadingTone;
  return legacyTone === "cyan" || legacyTone === "orange" ? legacyTone : "light";
}

export function loadAppBootstrapSnapshot(): AppBootstrapSnapshot {
  const persistedUiSettings = loadPersistedUiSettings();

  return {
    persistedUiSettings,
    initialThemeMode: resolveInitialThemeMode(persistedUiSettings),
    models: loadManagedModels(),
    selectedModelId: readStorageItem(SELECTED_MODEL_STORAGE_KEY) ?? DEFAULT_MODELS[0].id,
    agentStepLimits: loadAgentStepLimits(),
    agentGatewayPreferences: loadAgentGatewayPreferences(),
  };
}
