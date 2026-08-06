import { DEFAULT_DESIGN_SYSTEM, type DesignSystemV2, designSystemV2Schema } from "@design-system";
import type { AgentExecutionStrategy } from "@shared/agent";
import {
  type AgentGatewayPreferences,
  DEFAULT_WEB_SEARCH_ENDPOINT,
} from "@shared/agent-gateway-config";
import type { AgentStepLimits } from "@shared/agent-step-limits";
import {
  type CredentialStorageStatus,
  type ModelCredentialBinding,
  modelCredentialBindingFromSelection,
  normalizeWebSearchCredentialBinding,
} from "@shared/credentials";
import type { UiThemeSummary } from "@shared/ipc";
import type { Presentation } from "@shared/presentation";
import { getBuiltinTemplate } from "@shared/template-catalog";
import { APPLICATION_DEFAULT_TEMPLATE_ID, isUploadedTemplateId } from "@shared/template-protocol";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { saveAgentGatewayPreferences } from "../agentGatewayConfig";
import { saveAgentStepLimits } from "../agentStepLimits";
import {
  isModelEnabled,
  type ManagedModel,
  SELECTED_MODEL_STORAGE_KEY,
  saveManagedModels,
  toAgentModelSelection,
} from "../modelCatalog";
import {
  type AppBootstrapSnapshot,
  type ComputedColorScheme,
  savePersistedUiSettings,
  type UiColorScheme,
  type UiFontFamily,
  type UiSkin,
} from "./appBootstrap";
import {
  normalizePersistedUiFontFamily,
  normalizePersistedUiFontSize,
  normalizePersistedUiLineHeight,
} from "./uiTypography";
import { getComputedScheme, useAppearanceRuntime } from "./useAppearanceRuntime";
import { normalizePersistedUiThemeId } from "./userUiTheme";

export interface SettingsController {
  models: ManagedModel[];
  enabledModels: ManagedModel[];
  visibleModels: ManagedModel[];
  selectedModel?: ManagedModel;
  selectedModelId: string;
  selectModel: (id: string) => void;
  saveModel: (model: ManagedModel, apiKey?: string) => Promise<boolean>;
  saveModels: (models: ManagedModel[], apiKey: string) => Promise<boolean>;
  deleteModel: (id: string) => Promise<boolean>;
  credentialStorageStatus: CredentialStorageStatus | null;
  webSearchCredentialConfigured: boolean;
  saveWebSearchCredential: (apiKey: string, endpoint?: string) => Promise<boolean>;
  deleteWebSearchCredential: () => Promise<boolean>;
  selectedDesignSystem: DesignSystemV2;
  setSelectedDesignSystem: (value: DesignSystemV2) => void;
  defaultTemplateId: string;
  setDefaultTemplateId: (value: string) => void;
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
  const [executionStrategy, setExecutionStrategyState] = useState<AgentExecutionStrategy>(() =>
    persisted.executionStrategy === "AUTO" ? "AUTO" : "REQUEST_APPROVAL",
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
  const [defaultTemplateId, setDefaultTemplateIdState] = useState<string>(() => {
    const requested = persisted.defaultTemplateId ?? APPLICATION_DEFAULT_TEMPLATE_ID;
    if (isUploadedTemplateId(requested)) return requested;
    return getBuiltinTemplate(requested)?.id ?? APPLICATION_DEFAULT_TEMPLATE_ID;
  });
  const [models, setModels] = useState<ManagedModel[]>(() => bootstrap.models);
  const modelsRef = useRef(models);
  modelsRef.current = models;
  const [credentialStorageStatus, setCredentialStorageStatus] =
    useState<CredentialStorageStatus | null>(null);
  const [webSearchCredentialConfigured, setWebSearchCredentialConfigured] = useState(false);
  const credentialRefreshIdRef = useRef(0);
  const [selectedModelId, setSelectedModelId] = useState(() => bootstrap.selectedModelId);
  const credentialStatusLoaded = credentialStorageStatus !== null;
  const enabledModels = useMemo(
    () =>
      credentialStatusLoaded
        ? models.filter((model) => isModelEnabled(model) && model.credentialConfigured === true)
        : [],
    [credentialStatusLoaded, models],
  );
  const visibleModels = useMemo(
    () =>
      credentialStatusLoaded ? enabledModels : enabledModels.length > 0 ? enabledModels : models,
    [credentialStatusLoaded, enabledModels, models],
  );
  const selectedModel =
    visibleModels.find((model) => model.id === selectedModelId) ?? visibleModels[0];
  const computedScheme = getComputedScheme(colorScheme);

  const markSaving = useCallback(() => {
    setSaveStatus("saving");
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      setSaveStatus("saved");
      saveTimerRef.current = null;
    }, 500);
  }, []);

  useEffect(
    () => () => {
      if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    saveManagedModels(models);
    if (!visibleModels.some((model) => model.id === selectedModelId) && visibleModels[0]) {
      setSelectedModelId(visibleModels[0].id);
    }
  }, [models, selectedModelId, visibleModels]);

  useEffect(() => {
    window.localStorage.setItem(SELECTED_MODEL_STORAGE_KEY, selectedModelId);
  }, [selectedModelId]);

  useEffect(() => saveAgentStepLimits(agentStepLimits), [agentStepLimits]);
  useEffect(() => saveAgentGatewayPreferences(agentGatewayPreferences), [agentGatewayPreferences]);

  const modelCredentialBindings = useMemo(
    () =>
      models.flatMap((model) => {
        try {
          return [modelCredentialBindingFromSelection(toAgentModelSelection(model))];
        } catch {
          return [];
        }
      }),
    [models],
  );
  const modelCredentialBindingsFingerprint = JSON.stringify(modelCredentialBindings);
  const webSearchEndpoint =
    agentGatewayPreferences.webSearchEndpoint?.trim() || DEFAULT_WEB_SEARCH_ENDPOINT;

  const refreshCredentialStatus = useCallback(async () => {
    const desktopApi = window.desktopApi;
    const refreshId = ++credentialRefreshIdRef.current;
    setCredentialStorageStatus(null);
    setWebSearchCredentialConfigured(false);
    setModels((current) =>
      current.map((model) =>
        model.credentialConfigured === false ? model : { ...model, credentialConfigured: false },
      ),
    );
    const failClosed = (message: string) => {
      setCredentialStorageStatus({
        state: "unavailable",
        backend: "unknown",
        warning: "safe-storage-unavailable",
      });
      setWebSearchCredentialConfigured(false);
      setModels((current) =>
        current.map((model) =>
          model.credentialConfigured === false ? model : { ...model, credentialConfigured: false },
        ),
      );
      notify(message);
    };
    if (!desktopApi?.getCredentialStatus) {
      failClosed("凭据状态读取失败: 桌面安全存储接口不可用");
      return;
    }
    let webSearch;
    try {
      webSearch = normalizeWebSearchCredentialBinding({ endpoint: webSearchEndpoint });
    } catch (error) {
      failClosed(`搜索凭据状态读取失败: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }

    try {
      const snapshot = await desktopApi.getCredentialStatus({
        models: modelCredentialBindings,
        webSearch,
      });
      if (refreshId !== credentialRefreshIdRef.current) return;
      const configuredById = new Map(
        snapshot.models.map((model) => [model.configurationId, model.configured]),
      );
      setCredentialStorageStatus(snapshot.storage);
      setWebSearchCredentialConfigured(snapshot.webSearchConfigured);
      setModels((current) => {
        let changed = false;
        const next = current.map((model) => {
          const configured = configuredById.get(model.id) ?? false;
          if (model.credentialConfigured === configured) return model;
          changed = true;
          return { ...model, credentialConfigured: configured };
        });
        return changed ? next : current;
      });
    } catch (error) {
      if (refreshId !== credentialRefreshIdRef.current) return;
      failClosed(`凭据状态读取失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, [modelCredentialBindingsFingerprint, notify, webSearchEndpoint]);

  useEffect(() => {
    void refreshCredentialStatus();
  }, [refreshCredentialStatus]);

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
      defaultTemplateId,
      executionStrategy,
    });
  }, [
    colorScheme,
    defaultTemplateId,
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
    if (
      presentation?.designSystem &&
      JSON.stringify(presentation.designSystem) !== JSON.stringify(selectedDesignSystem)
    ) {
      setSelectedDesignSystemState(presentation.designSystem);
    }
  }, [presentation, selectedDesignSystem]);

  const update =
    <T>(setter: (value: T) => void) =>
    (value: T) => {
      markSaving();
      setter(value);
    };

  const selectModel = update(setSelectedModelId);
  const credentialBindingForModel = (model: ManagedModel): ModelCredentialBinding =>
    modelCredentialBindingFromSelection(toAgentModelSelection(model));

  const saveModel = async (model: ManagedModel, apiKey?: string): Promise<boolean> => {
    markSaving();
    const nextApiKey = apiKey?.trim();
    let binding: ModelCredentialBinding;
    try {
      binding = credentialBindingForModel(model);
    } catch (error) {
      notify(`模型连接配置无效: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }

    const existing = modelsRef.current.find((item) => item.id === model.id);
    let bindingChanged = !existing;
    if (existing) {
      try {
        bindingChanged =
          JSON.stringify(credentialBindingForModel(existing)) !== JSON.stringify(binding);
      } catch {
        bindingChanged = true;
      }
    }

    if (nextApiKey) {
      try {
        await window.desktopApi.setModelCredentials({ bindings: [binding], apiKey: nextApiKey });
        credentialRefreshIdRef.current += 1;
      } catch (error) {
        notify(`API Key 保存失败: ${error instanceof Error ? error.message : String(error)}`);
        return false;
      }
    } else if (bindingChanged && existing) {
      try {
        await window.desktopApi.deleteModelCredential({ configurationId: existing.id });
        credentialRefreshIdRef.current += 1;
      } catch (error) {
        notify(`旧模型凭据清除失败: ${error instanceof Error ? error.message : String(error)}`);
        return false;
      }
    }

    const credentialConfigured =
      Boolean(nextApiKey) || (!bindingChanged && existing?.credentialConfigured === true);
    const persistedModel = { ...model, credentialConfigured };
    setModels((current) =>
      current.some((item) => item.id === persistedModel.id)
        ? current.map((item) => (item.id === persistedModel.id ? persistedModel : item))
        : [...current, persistedModel],
    );
    return true;
  };

  const saveModels = async (nextModels: ManagedModel[], apiKey: string): Promise<boolean> => {
    markSaving();
    const normalizedApiKey = apiKey.trim();
    if (!normalizedApiKey) {
      notify("请填写 API Key");
      return false;
    }
    let bindings: ModelCredentialBinding[];
    try {
      bindings = nextModels.map(credentialBindingForModel);
    } catch (error) {
      notify(`模型连接配置无效: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
    try {
      await window.desktopApi.setModelCredentials({ bindings, apiKey: normalizedApiKey });
      credentialRefreshIdRef.current += 1;
    } catch (error) {
      notify(`API Key 保存失败: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
    const configuredModels = nextModels.map((model) => ({
      ...model,
      credentialConfigured: true,
    }));
    const replacementIds = new Set(configuredModels.map((model) => model.id));
    setModels((current) => [
      ...current.filter((model) => !replacementIds.has(model.id)),
      ...configuredModels,
    ]);
    return true;
  };

  const deleteModel = async (id: string): Promise<boolean> => {
    markSaving();
    try {
      await window.desktopApi.deleteModelCredential({ configurationId: id });
      credentialRefreshIdRef.current += 1;
    } catch (error) {
      notify(`模型凭据删除失败: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
    setModels((current) => current.filter((model) => model.id !== id));
    if (selectedModelId === id) {
      const fallback = modelsRef.current.find((model) => model.id !== id && isModelEnabled(model));
      if (fallback) setSelectedModelId(fallback.id);
    }
    return true;
  };

  const saveWebSearchCredential = async (
    apiKey: string,
    endpoint = webSearchEndpoint,
  ): Promise<boolean> => {
    const normalizedApiKey = apiKey.trim();
    if (!normalizedApiKey) {
      notify("请填写 Tavily API Key");
      return false;
    }
    try {
      const binding = normalizeWebSearchCredentialBinding({ endpoint });
      await window.desktopApi.setWebSearchCredential({ binding, apiKey: normalizedApiKey });
      credentialRefreshIdRef.current += 1;
      setWebSearchCredentialConfigured(true);
      markSaving();
      return true;
    } catch (error) {
      notify(`搜索 API Key 保存失败: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  };

  const deleteWebSearchCredential = async (): Promise<boolean> => {
    try {
      await window.desktopApi.deleteWebSearchCredential();
      setWebSearchCredentialConfigured(false);
      markSaving();
      void refreshCredentialStatus();
      return true;
    } catch (error) {
      notify(`搜索 API Key 清除失败: ${error instanceof Error ? error.message : String(error)}`);
      return false;
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
    saveModels,
    deleteModel,
    credentialStorageStatus,
    webSearchCredentialConfigured,
    saveWebSearchCredential,
    deleteWebSearchCredential,
    selectedDesignSystem,
    setSelectedDesignSystem: update(setSelectedDesignSystemState),
    defaultTemplateId,
    setDefaultTemplateId: (value: string) => {
      if (isUploadedTemplateId(value)) {
        markSaving();
        setDefaultTemplateIdState(value);
        return;
      }
      const template = getBuiltinTemplate(value);
      if (!template) return;
      markSaving();
      setDefaultTemplateIdState(template.id);
      setSelectedDesignSystemState(template.designSystem);
    },
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
