import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Presentation } from "@shared/presentation";
import type { AgentGatewayPreferences } from "@shared/agent-gateway-config";
import type { AgentStepLimits } from "@shared/agent-step-limits";
import type { AgentExecutionStrategy } from "@shared/agent";
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
  type UiAccentColor,
  type UiColorScheme,
  type UiControlShape,
  type UiSkin,
} from "./appBootstrap";
import { getComputedScheme, useAppearanceRuntime } from "./useAppearanceRuntime";
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
  logoUrl: string | null;
  uploadLogo: (url: string) => void;
  removeLogo: () => void;
  autoCloudSync: boolean;
  setAutoCloudSync: (value: boolean) => void;
  agentStepLimits: AgentStepLimits;
  setAgentStepLimits: (value: AgentStepLimits) => void;
  agentGatewayPreferences: AgentGatewayPreferences;
  setAgentGatewayPreferences: (value: AgentGatewayPreferences) => void;
  executionStrategy: AgentExecutionStrategy;
  setExecutionStrategy: (value: AgentExecutionStrategy) => void;
  skin: UiSkin;
  setSkin: (value: UiSkin) => void;
  colorScheme: UiColorScheme;
  setColorScheme: (value: UiColorScheme) => void;
  computedScheme: ComputedColorScheme;
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
  const [autoCloudSync, setAutoCloudSyncState] = useState(() => persisted.autoCloudSync ?? false);
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
  const [colorScheme, setColorSchemeState] = useState<UiColorScheme>(
    () => bootstrap.initialColorScheme,
  );
  const [uiAccentColor, setUiAccentColorState] = useState<UiAccentColor>(() => {
    const accent = persisted.uiAccentColor;
    return accent === "green" || accent === "orange" ? accent : "cyan";
  });
  const [uiControlShape, setUiControlShapeState] = useState<UiControlShape>(() => {
    const shape = persisted.uiControlShape;
    return shape === "sharp" || shape === "round" ? shape : "soft";
  });
  const [borderRadiusScale, setBorderRadiusScaleState] = useState(() =>
    typeof persisted.borderRadiusScale === "number" ? persisted.borderRadiusScale : 0.2,
  );
  const [colorContrastOffset, setColorContrastOffsetState] = useState(() =>
    typeof persisted.colorContrastOffset === "number" ? persisted.colorContrastOffset : 0,
  );
  const [selectedDesignSystem, setSelectedDesignSystemState] = useState<DesignSystemV2>(() => {
    const parsed = designSystemV2Schema.safeParse(persisted.selectedDesignSystem);
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

  useEffect(() => {
    savePersistedUiSettings({
      autoDownload: false,
      autoCloudSync,
      defaultRatio: "16:9",
      skin,
      colorScheme,
      uiAccentColor,
      uiControlShape,
      borderRadiusScale,
      colorContrastOffset,
      selectedDesignSystem,
      logoUrl,
      executionStrategy,
    });
  }, [
    autoCloudSync,
    borderRadiusScale,
    colorContrastOffset,
    colorScheme,
    executionStrategy,
    logoUrl,
    selectedDesignSystem,
    skin,
    uiAccentColor,
    uiControlShape,
  ]);

  useAppearanceRuntime({
    skin,
    colorScheme,
    computedScheme,
    borderRadiusScale,
    colorContrastOffset,
    uiAccentColor,
    uiControlShape,
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
    autoCloudSync,
    setAutoCloudSync: update(setAutoCloudSyncState),
    agentStepLimits,
    setAgentStepLimits: update(setAgentStepLimitsState),
    agentGatewayPreferences,
    setAgentGatewayPreferences: update(setAgentGatewayPreferencesState),
    executionStrategy,
    setExecutionStrategy: update(setExecutionStrategyState),
    skin,
    setSkin: update(setSkinState),
    colorScheme,
    setColorScheme: update(setColorSchemeState),
    computedScheme,
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
