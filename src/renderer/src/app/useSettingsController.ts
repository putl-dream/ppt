import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Presentation } from "@shared/presentation";
import type { AgentGatewayPreferences } from "@shared/agent-gateway-config";
import type { AgentStepLimits } from "@shared/agent-step-limits";
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
  type UiAccentColor,
  type UiControlShape,
  type UiReadingTone,
  type UiThemeMode,
} from "./appBootstrap";
import { getComputedTheme, useAppearanceRuntime } from "./useAppearanceRuntime";
import {
  DEFAULT_DESIGN_SYSTEM,
  designSystemV1Schema,
  type DesignSystemV1,
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
  selectedDesignSystem: DesignSystemV1;
  setSelectedDesignSystem: (value: DesignSystemV1) => void;
  logoUrl: string | null;
  uploadLogo: (url: string) => void;
  removeLogo: () => void;
  autoDownload: boolean;
  setAutoDownload: (value: boolean) => void;
  autoCloudSync: boolean;
  setAutoCloudSync: (value: boolean) => void;
  defaultRatio: "16:9" | "4:3";
  setDefaultRatio: (value: "16:9" | "4:3") => void;
  agentStepLimits: AgentStepLimits;
  setAgentStepLimits: (value: AgentStepLimits) => void;
  agentGatewayPreferences: AgentGatewayPreferences;
  setAgentGatewayPreferences: (value: AgentGatewayPreferences) => void;
  themeMode: UiThemeMode;
  setThemeMode: (value: UiThemeMode) => void;
  computedTheme: "light" | "dark";
  uiAccentColor: UiAccentColor;
  setUiAccentColor: (value: UiAccentColor) => void;
  uiControlShape: UiControlShape;
  setUiControlShape: (value: UiControlShape) => void;
  borderRadiusScale: number;
  setBorderRadiusScale: (value: number) => void;
  colorContrastOffset: number;
  setColorContrastOffset: (value: number) => void;
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
  const [autoDownload, setAutoDownloadState] = useState(() => persisted.autoDownload ?? true);
  const [autoCloudSync, setAutoCloudSyncState] = useState(() => persisted.autoCloudSync ?? false);
  const [defaultRatio, setDefaultRatioState] = useState<"16:9" | "4:3">(
    () => persisted.defaultRatio === "4:3" ? "4:3" : "16:9",
  );
  const [agentStepLimits, setAgentStepLimitsState] = useState(() => bootstrap.agentStepLimits);
  const [agentGatewayPreferences, setAgentGatewayPreferencesState] = useState(
    () => bootstrap.agentGatewayPreferences,
  );
  const [themeMode, setThemeModeState] = useState<UiThemeMode>(() => bootstrap.initialThemeMode);
  const uiReadingTone: UiReadingTone = themeMode === "cyan" || themeMode === "orange" ? themeMode : "classic";
  const [uiAccentColor, setUiAccentColorState] = useState<UiAccentColor>(() => {
    const accent = persisted.uiAccentColor;
    return accent === "green" || accent === "purple" || accent === "orange" ? accent : "cyan";
  });
  const [uiControlShape, setUiControlShapeState] = useState<UiControlShape>(() => {
    const shape = persisted.uiControlShape;
    return shape === "sharp" || shape === "round" ? shape : "soft";
  });
  const [borderRadiusScale, setBorderRadiusScaleState] = useState(() =>
    typeof persisted.borderRadiusScale === "number" ? persisted.borderRadiusScale : 0,
  );
  const [colorContrastOffset, setColorContrastOffsetState] = useState(() =>
    typeof persisted.colorContrastOffset === "number" ? persisted.colorContrastOffset : 0,
  );
  const [selectedDesignSystem, setSelectedDesignSystemState] = useState<DesignSystemV1>(() => {
    const parsed = designSystemV1Schema.safeParse(persisted.selectedDesignSystem);
    return parsed.success ? parsed.data : DEFAULT_DESIGN_SYSTEM;
  });
  const [logoUrl, setLogoUrl] = useState<string | null>(() => persisted.logoUrl ?? null);
  const [models, setModels] = useState<ManagedModel[]>(() => bootstrap.models);
  const [selectedModelId, setSelectedModelId] = useState(() => bootstrap.selectedModelId);
  const enabledModels = useMemo(() => models.filter(isModelEnabled), [models]);
  const visibleModels = useMemo(
    () => (enabledModels.length > 0 ? enabledModels : models),
    [enabledModels, models],
  );
  const selectedModel = visibleModels.find((model) => model.id === selectedModelId) ?? visibleModels[0];
  const computedTheme = getComputedTheme(themeMode);

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

  useEffect(() => {
    savePersistedUiSettings({
      autoDownload,
      autoCloudSync,
      defaultRatio,
      themeMode,
      uiAccentColor,
      uiControlShape,
      uiReadingTone,
      borderRadiusScale,
      colorContrastOffset,
      selectedDesignSystem,
      logoUrl,
    });
  }, [
    autoCloudSync,
    autoDownload,
    borderRadiusScale,
    colorContrastOffset,
    defaultRatio,
    logoUrl,
    selectedDesignSystem,
    themeMode,
    uiAccentColor,
    uiControlShape,
    uiReadingTone,
  ]);

  useAppearanceRuntime({
    themeMode,
    computedTheme,
    borderRadiusScale,
    colorContrastOffset,
    uiAccentColor,
    uiControlShape,
    uiReadingTone,
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
  const uploadLogo = (url: string) => {
    markSaving();
    setLogoUrl(url);
    notify("🖼️ 品牌 Logo 已应用至演示文稿模板");
  };
  const removeLogo = () => {
    markSaving();
    setLogoUrl(null);
    notify("🗑️ 品牌 Logo 已移除");
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
    logoUrl,
    uploadLogo,
    removeLogo,
    autoDownload,
    setAutoDownload: update(setAutoDownloadState),
    autoCloudSync,
    setAutoCloudSync: update(setAutoCloudSyncState),
    defaultRatio,
    setDefaultRatio: update(setDefaultRatioState),
    agentStepLimits,
    setAgentStepLimits: update(setAgentStepLimitsState),
    agentGatewayPreferences,
    setAgentGatewayPreferences: update(setAgentGatewayPreferencesState),
    themeMode,
    setThemeMode: update(setThemeModeState),
    computedTheme,
    uiAccentColor,
    setUiAccentColor: update(setUiAccentColorState),
    uiControlShape,
    setUiControlShape: update(setUiControlShapeState),
    borderRadiusScale,
    setBorderRadiusScale: update(setBorderRadiusScaleState),
    colorContrastOffset,
    setColorContrastOffset: update(setColorContrastOffsetState),
    saveStatus,
    markSaving,
  };
}
