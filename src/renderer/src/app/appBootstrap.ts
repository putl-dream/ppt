import type { DesignSystemV2 } from "@design-system";
import type { AgentExecutionStrategy } from "@shared/agent";
import type { AgentGatewayPreferences } from "@shared/agent-gateway-config";
import type { AgentStepLimits } from "@shared/agent-step-limits";
import { loadAgentGatewayPreferences } from "../agentGatewayConfig";
import { loadAgentStepLimits } from "../agentStepLimits";
import { consumeCredentialReentryNotice } from "../credentialMigration";
import { loadManagedModels, type ManagedModel, SELECTED_MODEL_STORAGE_KEY } from "../modelCatalog";
import type { UiFontFamily } from "./uiTypography";

export const UI_SETTINGS_STORAGE_KEY = "agent-ppt.ui-settings.v2";
const LEGACY_UI_SETTINGS_STORAGE_KEY = "agent-ppt.ui-settings.v1";

export type UiSkin = "studio";
export type UiColorScheme = "light" | "dark" | "system";
export type ComputedColorScheme = "light" | "dark";
export type { UiFontFamily };

/** @deprecated Use UiColorScheme. Kept for migration typing only. */
type LegacyThemeMode = "light" | "dark" | "cyan" | "orange" | "system";

export interface PersistedUiSettings {
  defaultRatio: "16:9" | "4:3";
  skin: UiSkin;
  /** Built-in `studio` or a custom theme id from `~/.agent-ppt/themes/<id>/theme.css`. */
  uiThemeId: string;
  colorScheme: UiColorScheme;
  uiFontFamily: UiFontFamily;
  /** Base UI font size in px. */
  uiFontSize: number;
  /** Leading multiplier applied on top of the size scale. */
  uiLineHeight: number;
  selectedDesignSystem: DesignSystemV2;
  /** Application default builtin template id for new projects. */
  defaultTemplateId: string;
  executionStrategy: AgentExecutionStrategy;
}

export interface AppBootstrapSnapshot {
  persistedUiSettings: Partial<PersistedUiSettings>;
  initialColorScheme: UiColorScheme;
  initialComputedScheme: ComputedColorScheme;
  models: ManagedModel[];
  selectedModelId: string;
  agentStepLimits: AgentStepLimits;
  agentGatewayPreferences: AgentGatewayPreferences;
  credentialReentryRequired: boolean;
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

function writeStorageItem(key: string, value: string): void {
  try {
    getBrowserStorage()?.setItem(key, value);
  } catch (error) {
    console.error("保存 UI 设置失败:", error);
  }
}

function removeStorageItem(key: string): void {
  try {
    getBrowserStorage()?.removeItem(key);
  } catch {
    /* ignore */
  }
}

export function prefersDarkColorScheme(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

/**
 * Migrate v1 settings (themeMode / uiReadingTone / cyan|orange modes)
 * into v2 (skin × colorScheme). Defaults to dark studio.
 */
function migrateLegacySettings(raw: Record<string, unknown>): Partial<PersistedUiSettings> {
  const migrated: Partial<PersistedUiSettings> = { ...raw } as Partial<PersistedUiSettings>;

  if (!migrated.skin) migrated.skin = "studio";

  if (!migrated.colorScheme) {
    const legacyMode = raw.themeMode as LegacyThemeMode | undefined;
    if (legacyMode === "dark") {
      migrated.colorScheme = "dark";
    } else if (legacyMode === "system") {
      migrated.colorScheme = "system";
    } else if (legacyMode === "cyan" || legacyMode === "orange" || legacyMode === "light") {
      migrated.colorScheme = "light";
    } else {
      const legacyTone = raw.uiReadingTone;
      if (legacyTone === "cyan" || legacyTone === "orange") {
        migrated.colorScheme = "light";
      } else {
        migrated.colorScheme = "dark";
      }
    }
  }

  delete (migrated as Record<string, unknown>).themeMode;
  delete (migrated as Record<string, unknown>).uiReadingTone;
  delete (migrated as Record<string, unknown>).colorContrastOffset;
  delete (migrated as Record<string, unknown>).uiAccentColor;
  delete (migrated as Record<string, unknown>).uiControlShape;
  delete (migrated as Record<string, unknown>).borderRadiusScale;
  delete (migrated as Record<string, unknown>).logoUrl;

  return migrated;
}

export function loadPersistedUiSettings(): Partial<PersistedUiSettings> {
  try {
    const v2 = readStorageItem(UI_SETTINGS_STORAGE_KEY);
    if (v2) {
      const parsed = JSON.parse(v2) as Record<string, unknown>;
      if (!parsed || typeof parsed !== "object") return {};
      delete parsed.colorContrastOffset;
      delete parsed.uiAccentColor;
      delete parsed.uiControlShape;
      delete parsed.borderRadiusScale;
      delete parsed.logoUrl;
      return parsed as Partial<PersistedUiSettings>;
    }

    const v1 = readStorageItem(LEGACY_UI_SETTINGS_STORAGE_KEY);
    if (!v1) return {};

    const parsed = JSON.parse(v1) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") return {};

    const migrated = migrateLegacySettings(parsed);
    writeStorageItem(UI_SETTINGS_STORAGE_KEY, JSON.stringify(migrated));
    removeStorageItem(LEGACY_UI_SETTINGS_STORAGE_KEY);
    return migrated;
  } catch {
    return {};
  }
}

export function savePersistedUiSettings(settings: PersistedUiSettings): void {
  writeStorageItem(UI_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
}

export function resolveColorScheme(scheme: UiColorScheme | undefined): ComputedColorScheme {
  if (scheme === "light") return "light";
  if (scheme === "dark") return "dark";
  if (scheme === "system") return prefersDarkColorScheme() ? "dark" : "light";
  return "dark";
}

export function resolveInitialColorScheme(settings: Partial<PersistedUiSettings>): UiColorScheme {
  const scheme = settings.colorScheme;
  if (scheme === "light" || scheme === "dark" || scheme === "system") return scheme;
  return "dark";
}

export function loadAppBootstrapSnapshot(): AppBootstrapSnapshot {
  const persistedUiSettings = loadPersistedUiSettings();
  const initialColorScheme = resolveInitialColorScheme(persistedUiSettings);
  const models = loadManagedModels();

  const agentGatewayPreferences = loadAgentGatewayPreferences();

  return {
    persistedUiSettings,
    initialColorScheme,
    initialComputedScheme: resolveColorScheme(initialColorScheme),
    models,
    selectedModelId: readStorageItem(SELECTED_MODEL_STORAGE_KEY) ?? models[0]?.id ?? "",
    agentStepLimits: loadAgentStepLimits(),
    agentGatewayPreferences,
    credentialReentryRequired: consumeCredentialReentryNotice(),
  };
}
