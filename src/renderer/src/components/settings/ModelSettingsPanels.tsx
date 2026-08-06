import {
  type AgentGatewayPreferences,
  DEFAULT_WEB_SEARCH_ENDPOINT,
} from "@shared/agent-gateway-config";
import type { CredentialStorageStatus } from "@shared/credentials";
import { normalizeCredentialUrl } from "@shared/credentials";
import {
  MAX_OUTPUT_TOKENS,
  MIN_OUTPUT_TOKENS,
  normalizeOutputTokenDraft,
} from "@shared/generation-settings-inputs";
import React from "react";
import { isModelEnabled, type ManagedModel } from "../../modelCatalog";
import { ModelManagement } from "../ModelManagement";
import { Select } from "../Select";
import { SettingsPanel, SettingsRow, SettingsSection } from "./SettingsPrimitives";

export function credentialStorageLabel(status: CredentialStorageStatus | null): string {
  if (!status) return "正在读取系统安全存储状态…";
  if (status.state === "secure") return "系统安全存储可用";
  if (status.state === "degraded") {
    return "降级模式：Linux basic_text 后端不会提供强加密保护";
  }
  return "系统安全存储不可用；可改用进程环境变量提供凭据";
}

function normalizedSearchEndpoint(value: string): string | undefined {
  const normalized = value.trim() || DEFAULT_WEB_SEARCH_ENDPOINT;
  try {
    return normalizeCredentialUrl(normalized);
  } catch {
    return undefined;
  }
}

export interface WebSearchSettingsController {
  apiKeyDraft: string;
  setApiKeyDraft: (value: string) => void;
  endpointDraft: string;
  setEndpointDraft: (value: string) => void;
  pending: boolean;
  commitEndpoint: () => string | undefined;
  saveCredential: () => Promise<void>;
  clearCredential: () => Promise<void>;
}

export function useWebSearchSettings({
  preferences,
  setPreferences,
  onSaveCredential,
  onDeleteCredential,
  notify,
}: {
  preferences: AgentGatewayPreferences;
  setPreferences: (value: AgentGatewayPreferences) => void;
  onSaveCredential: (apiKey: string, endpoint?: string) => Promise<boolean>;
  onDeleteCredential: () => Promise<boolean>;
  notify: (message: string) => void;
}): WebSearchSettingsController {
  const [apiKeyDraft, setApiKeyDraft] = React.useState("");
  const [endpointDraft, setEndpointDraft] = React.useState(
    () => preferences.webSearchEndpoint ?? DEFAULT_WEB_SEARCH_ENDPOINT,
  );
  const [pending, setPending] = React.useState(false);

  React.useEffect(() => {
    setEndpointDraft(preferences.webSearchEndpoint ?? DEFAULT_WEB_SEARCH_ENDPOINT);
  }, [preferences.webSearchEndpoint]);

  const commitEndpoint = (): string | undefined => {
    const normalized = normalizedSearchEndpoint(endpointDraft);
    if (!normalized) {
      notify("请填写有效的 Search Endpoint");
      return undefined;
    }
    setEndpointDraft(normalized);
    const persisted = normalized === DEFAULT_WEB_SEARCH_ENDPOINT ? undefined : normalized;
    if (preferences.webSearchEndpoint !== persisted) {
      setPreferences({ ...preferences, webSearchEndpoint: persisted });
    }
    return normalized;
  };

  const saveCredential = async () => {
    const endpoint = commitEndpoint();
    if (!endpoint) return;
    if (!apiKeyDraft.trim()) {
      notify("请填写 Tavily API Key");
      return;
    }
    setPending(true);
    const saved = await onSaveCredential(apiKeyDraft, endpoint);
    setPending(false);
    if (!saved) return;
    setApiKeyDraft("");
    notify("Tavily API Key 已保存到系统安全存储");
  };

  const clearCredential = async () => {
    setPending(true);
    const deleted = await onDeleteCredential();
    setPending(false);
    if (!deleted) return;
    setApiKeyDraft("");
    notify("已清除系统安全存储中的 Tavily API Key；环境变量仍可能生效");
  };

  return {
    apiKeyDraft,
    setApiKeyDraft,
    endpointDraft,
    setEndpointDraft,
    pending,
    commitEndpoint,
    saveCredential,
    clearCredential,
  };
}

export function ModelListSettingsPanel({
  models,
  selectedModelId,
  onSelectModel,
  onSaveModel,
  onSaveModels,
  onDeleteModel,
  credentialStorageStatus,
  notify,
}: {
  models: ManagedModel[];
  selectedModelId: string;
  onSelectModel: (id: string) => void;
  onSaveModel: (model: ManagedModel, apiKey?: string) => Promise<boolean>;
  onSaveModels: (models: ManagedModel[], apiKey: string) => Promise<boolean>;
  onDeleteModel: (id: string) => Promise<boolean>;
  credentialStorageStatus: CredentialStorageStatus | null;
  notify: (message: string) => void;
}) {
  return (
    <SettingsPanel>
      <p className="settings-help-text">
        {credentialStorageLabel(credentialStorageStatus)}。API Key 不会保存到浏览器存储。
      </p>
      <ModelManagement
        models={models}
        selectedModelId={selectedModelId}
        onSelectModel={onSelectModel}
        onSaveModel={onSaveModel}
        onSaveModels={onSaveModels}
        onDeleteModel={onDeleteModel}
        triggerToast={notify}
      />
    </SettingsPanel>
  );
}

export function WebSearchSettingsPanel({
  credentialStorageStatus,
  credentialConfigured,
  preferences,
  setPreferences,
  controller,
}: {
  credentialStorageStatus: CredentialStorageStatus | null;
  credentialConfigured: boolean;
  preferences: AgentGatewayPreferences;
  setPreferences: (value: AgentGatewayPreferences) => void;
  controller: WebSearchSettingsController;
}) {
  return (
    <SettingsPanel>
      <SettingsSection title="搜索与联网" hint="可选">
        <SettingsRow label="凭据存储">
          <span className="ide-field-value">{credentialStorageLabel(credentialStorageStatus)}</span>
        </SettingsRow>
        <SettingsRow label="Tavily 状态">
          <span className="ide-field-value">
            {credentialConfigured ? "已配置（系统安全存储或环境变量）" : "未配置"}
          </span>
        </SettingsRow>
        <SettingsRow label="Tavily API Key">
          <div className="model-dialog-actions">
            <input
              className="ide-field"
              aria-label="Tavily API Key"
              type="password"
              value={controller.apiKeyDraft}
              placeholder={
                credentialConfigured
                  ? "留空不会覆盖当前凭据"
                  : "tvly-...（也可设置 TAVILY_API_KEY）"
              }
              onChange={(event) => controller.setApiKeyDraft(event.target.value)}
            />
            <button
              type="button"
              className="settings-primary-btn"
              disabled={controller.pending}
              onClick={() => void controller.saveCredential()}
            >
              保存
            </button>
            <button
              type="button"
              className="settings-secondary-btn"
              disabled={controller.pending || !credentialConfigured}
              onClick={() => void controller.clearCredential()}
            >
              清除
            </button>
          </div>
        </SettingsRow>
        <SettingsRow label="Search Endpoint">
          <input
            className="ide-field"
            value={controller.endpointDraft}
            placeholder={DEFAULT_WEB_SEARCH_ENDPOINT}
            onChange={(event) => controller.setEndpointDraft(event.target.value)}
            onBlur={() => void controller.commitEndpoint()}
          />
        </SettingsRow>
        <SettingsRow label="搜索超时">
          <span className="ide-field-value">
            {Math.round((preferences.webSearchTimeoutMs ?? 20_000) / 1000)} 秒
          </span>
          <input
            className="ide-range"
            type="range"
            min={5}
            max={120}
            step={5}
            value={Math.round((preferences.webSearchTimeoutMs ?? 20_000) / 1000)}
            onChange={(event) =>
              setPreferences({
                ...preferences,
                webSearchTimeoutMs: parseInt(event.target.value, 10) * 1000,
              })
            }
          />
        </SettingsRow>
      </SettingsSection>
    </SettingsPanel>
  );
}

export function ModelRuntimeSettingsPanel({
  models,
  selectedModelId,
  credentialStorageStatus,
  preferences,
  setPreferences,
}: {
  models: ManagedModel[];
  selectedModelId: string;
  credentialStorageStatus: CredentialStorageStatus | null;
  preferences: AgentGatewayPreferences;
  setPreferences: (value: AgentGatewayPreferences) => void;
}) {
  const [maxOutputTokensDraft, setMaxOutputTokensDraft] = React.useState(() =>
    String(preferences.maxOutputTokens),
  );
  React.useEffect(() => {
    setMaxOutputTokensDraft(String(preferences.maxOutputTokens));
  }, [preferences.maxOutputTokens]);

  const availableModels = models.filter(
    (model) =>
      isModelEnabled(model) &&
      (credentialStorageStatus === null || model.credentialConfigured === true),
  );
  const commitMaxOutputTokens = () => {
    const maxOutputTokens = normalizeOutputTokenDraft(
      maxOutputTokensDraft,
      preferences.maxOutputTokens,
    );
    setMaxOutputTokensDraft(String(maxOutputTokens));
    if (maxOutputTokens !== preferences.maxOutputTokens) {
      setPreferences({ ...preferences, maxOutputTokens });
    }
  };

  return (
    <SettingsPanel>
      <SettingsSection title="运行参数" hint={`${availableModels.length} 个模型可用`}>
        <SettingsRow label="最长等待时间">
          <span className="ide-field-value">{Math.round(preferences.timeoutMs / 1000)} 秒</span>
          <input
            className="ide-range"
            type="range"
            min={60}
            max={900}
            step={30}
            value={Math.round(preferences.timeoutMs / 1000)}
            onChange={(event) =>
              setPreferences({
                ...preferences,
                timeoutMs: parseInt(event.target.value, 10) * 1000,
              })
            }
          />
        </SettingsRow>
        <SettingsRow label="单次输出长度上限">
          <input
            className="ide-field"
            type="number"
            min={MIN_OUTPUT_TOKENS}
            max={MAX_OUTPUT_TOKENS}
            step={1024}
            value={maxOutputTokensDraft}
            onChange={(event) => setMaxOutputTokensDraft(event.target.value)}
            onBlur={commitMaxOutputTokens}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
          />
        </SettingsRow>
        <SettingsRow label="服务繁忙时备用模型">
          <Select
            variant="ide"
            ariaLabel="服务繁忙时备用模型"
            value={preferences.fallbackModelId ?? ""}
            onChange={(next) =>
              setPreferences({
                ...preferences,
                fallbackModelId: next || undefined,
              })
            }
            options={[
              { value: "", label: "不启用" },
              ...availableModels
                .filter((model) => model.id !== selectedModelId)
                .map((model) => ({ value: model.id, label: model.name, hint: model.model })),
            ]}
          />
        </SettingsRow>
      </SettingsSection>
    </SettingsPanel>
  );
}
