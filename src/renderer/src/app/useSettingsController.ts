import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Presentation } from "@shared/presentation";
import type { AgentGatewayPreferences } from "@shared/agent-gateway-config";
import type { AgentStepLimits } from "@shared/agent-step-limits";
import type { AgentExecutionStrategy } from "@shared/agent";
import type { UiThemeSummary } from "@shared/ipc";
import {
  MODEL_STORAGE_KEY,
  SELECTED_MODEL_STORAGE_KEY,
  isModelEnabled,
  type ManagedModel,
} from "../modelCatalog";
import { saveAgentStepLimits } from "../agentStepLimits";
import { saveAgentGatewayPreferences } from "../agentGatewayConfig";
import {
  savePersistedUiSettings,
  type AppBootstrapSnapshot,
  type ComputedColorScheme,
  type UiColorScheme,
  type UiFontFamily,
  type UiSkin,
} from "./appBootstrap";
import { getComputedScheme, useAppearanceRuntime } from "./useAppearanceRuntime";
import { normalizePersistedUiThemeId } from "./userUiTheme";
import {
  normalizePersistedUiFontFamily,
  normalizePersistedUiFontSize,
  normalizePersistedUiLineHeight,
} from "./uiTypography";
import {
  DEFAULT_DESIGN_SYSTEM,
  designSystemV2Schema,
  type DesignSystemV2,
} from "@design-system";

export interface SettingsController {
  models: ManagedModel[];
  enabledModels: ManagedModel[];
  visibleModels: ManagedModel[];
  selectedModel?: ManagedModel;
  selectedModelId: string;
  selectModel: (id: string) => void;
  saveModel: (model: ManagedModel) => void;
  deleteModel: (id: string) => void;
  selectedDesignSystem: DesignSystemV2;
  setSelectedDesignSystem: (value: DesignSystemV2) => void;
  agentStepLimits: AgentStepLimits;
  setAgentStepLimits: (value: AgentStepLimits) => void;
  agentGatewayPreferences: AgentGatewayPreferences;
  setAgentGatewayPreferences: (value: AgentGatewayPreferences) => void;
  executionStrategy: AgentExecutionStrategy;
  setExecutionStrategy: (value: AgentExecutionStrategy) => void;
  skin: UiSkin;
  setSkin: (value: UiSkin) => void;
  uiThemeId: string;
  setUiThemeId: (value: string) => void;
  uiThemes: UiThemeSummary[];
  refreshUiThemes: () => Promise<void>;
  openUiThemesDirectory: () => Promise<void>;
  colorScheme: UiColorScheme;
  setColorScheme: (value: UiColorScheme) => void;
  computedScheme: ComputedColorScheme;
  uiFontFamily: UiFontFamily;
  setUiFontFamily: (value: UiFontFamily) => void;
  uiFontSize: number;
  setUiFontSize: (value: number) => void;
  uiLineHeight: number;
  setUiLineHeight: (value: number) => void;
  saveStatus: "saved" | "saving";
  markSaving: () => void;
}

export function useSettingsController(
  bootstrap: AppBootstrapSnapshot,
  presentation: Presentation | undefined,
  notify: (message: string) => void,
): SettingsController {
  const persisted = bootstrap.persistedUiSettings;
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving">("saved");
  const saveTimerRef = useRef<number | null>(null);
  const [agentStepLimits, setAgentStepLimitsState] = useState(() => bootstrap.agentStepLimits);
  const [agentGatewayPreferences, setAgentGatewayPreferencesState] = useState(
    () => bootstrap.agentGatewayPreferences,
  );
  const [executionStrategy, setExecutionStrategyState] = useState<AgentExecutionStrategy>(
    () => persisted.executionStrategy === "AUTO" ? "AUTO" : "REQUEST_APPROVAL",
  );
  const [skin, setSkinState] = useState<UiSkin>(() =>
    persisted.skin === "studio" ? "studio" : "studio",
  );
  const [uiThemeId, setUiThemeIdState] = useState<string>(() =>
    normalizePersistedUiThemeId(persisted.uiThemeId),
  );
  const [uiThemes, setUiThemes] = useState<UiThemeSummary[]>([]);
  const [colorScheme, setColorSchemeState] = useState<UiColorScheme>(
    () => bootstrap.initialColorScheme,
  );
  const [uiFontFamily, setUiFontFamilyState] = useState<UiFontFamily>(() =>
    normalizePersistedUiFontFamily(persisted.uiFontFamily),
  );
  const [uiFontSize, setUiFontSizeState] = useState<number>(() =>
    normalizePersistedUiFontSize(persisted.uiFontSize),
  );
  const [uiLineHeight, setUiLineHeightState] = useState<number>(() =>
    normalizePersistedUiLineHeight(persisted.uiLineHeight),
  );
  const [selectedDesignSystem, setSelectedDesignSystemState] = useState<DesignSystemV2>(() => {
    const parsed = designSystemV2Schema.safeParse(persisted.selectedDesignSystem);
    return parsed.success ? parsed.data : DEFAULT_DESIGN_SYSTEM;
  });
  const [models, setModels] = useState<ManagedModel[]>(() => bootstrap.models);
  const [selectedModelId, setSelectedModelId] = useState(() => bootstrap.selectedModelId);
  const enabledModels = useMemo(() => models.filter(isModelEnabled), [models]);
  const visibleModels = useMemo(
    () => (enabledModels.length > 0 ? enabledModels : models),
    [enabledModels, models],
  );
  const selectedModel = visibleModels.find((model) => model.id === selectedModelId) ?? visibleModels[0];
  const computedScheme = getComputedScheme(colorScheme);

  const markSaving = useCallback(() => {
    setSaveStatus("saving");
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      setSaveStatus("saved");
      saveTimerRef.current = null;
    }, 500);
  }, []);

  useEffect(() => () => {
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
  }, []);

  useEffect(() => {
    window.localStorage.setItem(MODEL_STORAGE_KEY, JSON.stringify(models));
    if (!visibleModels.some((model) => model.id === selectedModelId) && visibleModels[0]) {
      setSelectedModelId(visibleModels[0].id);
    }
  }, [models, selectedModelId, visibleModels]);

  useEffect(() => {
    window.localStorage.setItem(SELECTED_MODEL_STORAGE_KEY, selectedModelId);
  }, [selectedModelId]);

  useEffect(() => saveAgentStepLimits(agentStepLimits), [agentStepLimits]);
  useEffect(() => saveAgentGatewayPreferences(agentGatewayPreferences), [agentGatewayPreferences]);

  const refreshUiThemes = useCallback(async () => {
    const desktopApi = window.desktopApi;
    if (!desktopApi?.listUiThemes) {
      setUiThemes([]);
      return;
    }
    try {
      const themes = await desktopApi.listUiThemes();
      setUiThemes(themes);
      const availableIds = new Set(themes.map((theme) => theme.id));
      setUiThemeIdState((current) => normalizePersistedUiThemeId(current, availableIds));
    } catch (error) {
      console.error("刷新 UI 主题列表失败:", error);
      setUiThemes([]);
    }
  }, []);

  const openUiThemesDirectory = useCallback(async () => {
    try {
      await window.desktopApi?.openUiThemesDirectory?.();
      await refreshUiThemes();
    } catch (error) {
      console.error("打开 UI 主题目录失败:", error);
      notify("无法打开主题文件夹");
    }
  }, [notify, refreshUiThemes]);

  useEffect(() => {
    void refreshUiThemes();
  }, [refreshUiThemes]);

  useEffect(() => {
    savePersistedUiSettings({
      defaultRatio: "16:9",
      skin,
      uiThemeId,
      colorScheme,
      uiFontFamily,
      uiFontSize,
      uiLineHeight,
      selectedDesignSystem,
      executionStrategy,
    });
  }, [
    colorScheme,
    executionStrategy,
    selectedDesignSystem,
    skin,
    uiFontFamily,
    uiFontSize,
    uiLineHeight,
    uiThemeId,
  ]);

  useAppearanceRuntime({
    skin,
    uiThemeId,
    colorScheme,
    computedScheme,
    uiFontFamily,
    uiFontSize,
    uiLineHeight,
  });

  useEffect(() => {
    if (presentation?.designSystem && JSON.stringify(presentation.designSystem) !== JSON.stringify(selectedDesignSystem)) {
      setSelectedDesignSystemState(presentation.designSystem);
    }
  }, [presentation, selectedDesignSystem]);

  const update = <T,>(setter: (value: T) => void) => (value: T) => {
    markSaving();
    setter(value);
  };

  const selectModel = update(setSelectedModelId);
  const saveModel = (model: ManagedModel) => {
    markSaving();
    setModels((current) => current.some((item) => item.id === model.id)
      ? current.map((item) => item.id === model.id ? model : item)
      : [...current, model]);
  };
  const deleteModel = (id: string) => {
    markSaving();
    setModels((current) => current.filter((model) => model.id !== id));
    if (selectedModelId === id) {
      const fallback = models.find((model) => model.id !== id && isModelEnabled(model));
      if (fallback) setSelectedModelId(fallback.id);
    }
  };
  return {
    models,
    enabledModels,
    visibleModels,
    selectedModel,
    selectedModelId,
    selectModel,
    saveModel,
    deleteModel,
    selectedDesignSystem,
    setSelectedDesignSystem: update(setSelectedDesignSystemState),
    agentStepLimits,
    setAgentStepLimits: update(setAgentStepLimitsState),
    agentGatewayPreferences,
    setAgentGatewayPreferences: update(setAgentGatewayPreferencesState),
    executionStrategy,
    setExecutionStrategy: update(setExecutionStrategyState),
    skin,
    setSkin: update(setSkinState),
    uiThemeId,
    setUiThemeId: update(setUiThemeIdState),
    uiThemes,
    refreshUiThemes,
    openUiThemesDirectory,
    colorScheme,
    setColorScheme: update(setColorSchemeState),
    computedScheme,
    uiFontFamily,
    setUiFontFamily: update(setUiFontFamilyState),
    uiFontSize,
    setUiFontSize: update(setUiFontSizeState),
    uiLineHeight,
    setUiLineHeight: update(setUiLineHeightState),
    saveStatus,
    markSaving,
  };
}
