import { useMemo, useState, type KeyboardEvent } from "react";
import type { ManagedModel } from "../modelCatalog";
import { isModelEnabled } from "../modelCatalog";
import { ChevronRightIcon, KeyIcon, RefreshIcon, TrashIcon } from "./Icons";

interface ModelManagementProps {
  models: ManagedModel[];
  selectedModelId: string;
  onSelectModel: (id: string) => void;
  onSaveModel: (model: ManagedModel) => void;
  onDeleteModel: (id: string) => void;
  triggerToast: (message: string) => void;
}

function slugifyModelName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "custom-model";
}

function createDraft(name: string): ManagedModel {
  return {
    id: `custom-${crypto.randomUUID()}`,
    name,
    provider: "openai",
    model: slugifyModelName(name),
    apiKey: "",
    baseURL: "",
    openaiApiMode: "chat-completions",
    enabled: true,
  };
}

export function ModelManagement({
  models,
  selectedModelId,
  onSelectModel,
  onSaveModel,
  onDeleteModel,
  triggerToast,
}: ModelManagementProps) {
  const [query, setQuery] = useState("");
  const [apiKeysOpen, setApiKeysOpen] = useState(false);

  const filteredModels = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return models;
    return models.filter((model) => {
      return `${model.name} ${model.model}`.toLowerCase().includes(normalizedQuery);
    });
  }, [models, query]);

  const selectedModel = models.find((model) => model.id === selectedModelId) ?? models[0];
  const enabledCount = models.filter(isModelEnabled).length;

  const updateModel = (model: ManagedModel, patch: Partial<ManagedModel>) => {
    const next = { ...model, ...patch };
    onSaveModel(next);
    if (next.enabled !== false && selectedModelId === model.id) {
      onSelectModel(next.id);
    }
  };

  const toggleModel = (model: ManagedModel) => {
    const nextEnabled = !isModelEnabled(model);
    if (!nextEnabled && enabledCount <= 1) {
      triggerToast("至少保留一个可用模型");
      return;
    }

    onSaveModel({ ...model, enabled: nextEnabled });

    if (nextEnabled) {
      onSelectModel(model.id);
      return;
    }

    if (selectedModelId === model.id) {
      const fallback = models.find((item) => item.id !== model.id && isModelEnabled(item));
      if (fallback) onSelectModel(fallback.id);
    }
  };

  const handleQueryKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;

    const name = query.trim();
    if (!name) return;

    const exactMatch = models.find((model) => {
      const normalized = name.toLowerCase();
      return model.name.toLowerCase() === normalized || model.model.toLowerCase() === normalized;
    });

    if (exactMatch) {
      onSelectModel(exactMatch.id);
      setQuery("");
      return;
    }

    const draft = createDraft(name);
    onSaveModel(draft);
    onSelectModel(draft.id);
    setApiKeysOpen(true);
    setQuery("");
    triggerToast("模型已添加");
  };

  const deleteSelectedModel = () => {
    if (!selectedModel || selectedModel.builtIn) return;
    const fallback = models.find((model) => model.id !== selectedModel.id && isModelEnabled(model));
    onDeleteModel(selectedModel.id);
    if (fallback) onSelectModel(fallback.id);
    triggerToast("自定义模型已删除");
  };

  return (
    <div className="model-management-layout settings-panel-fade">
      <div className="cursor-model-heading">
        <h3>模型列表</h3>
      </div>

      <section className="cursor-model-card">
        <div className="cursor-model-search-row">
          <input
            className="cursor-model-search"
            value={query}
            placeholder="添加或搜索模型"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleQueryKeyDown}
          />
          <button
            type="button"
            className="cursor-model-icon-btn"
            onClick={() => setQuery("")}
            title="重置模型筛选"
            aria-label="重置模型筛选"
          >
            <RefreshIcon size={16} />
          </button>
        </div>

        <div className="cursor-model-list">
          {filteredModels.map((model) => {
            const enabled = isModelEnabled(model);
            const selected = selectedModelId === model.id;

            return (
              <div key={model.id} className={`cursor-model-row ${selected ? "selected" : ""}`}>
                <button
                  type="button"
                  className="cursor-model-name-btn"
                  onClick={() => {
                    if (!enabled) toggleModel(model);
                    onSelectModel(model.id);
                  }}
                >
                  {model.name}
                </button>
                <label className="toggle-switch cursor-model-toggle" title={enabled ? "关闭模型" : "开启模型"}>
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={() => toggleModel(model)}
                  />
                  <span className="toggle-slider"></span>
                </label>
              </div>
            );
          })}

          {filteredModels.length === 0 && (
            <div className="cursor-model-empty">按 Enter 添加 “{query.trim()}”</div>
          )}
        </div>

        <button
          type="button"
          className="cursor-model-view-all"
          onClick={() => setQuery("")}
        >
          查看全部模型
        </button>
      </section>

      <section className="cursor-api-section">
        <button
          type="button"
          className={`cursor-api-trigger ${apiKeysOpen ? "open" : ""}`}
          onClick={() => setApiKeysOpen((open) => !open)}
        >
          <ChevronRightIcon size={16} />
          <KeyIcon size={15} />
          <span>API 密钥</span>
        </button>

        {apiKeysOpen && selectedModel && (
          <div className="cursor-api-panel settings-card">
            <div className="model-form-grid">
              <label className="config-group">
                <span className="config-label">显示名称</span>
                <input
                  className="config-input"
                  value={selectedModel.name}
                  onChange={(event) => updateModel(selectedModel, { name: event.target.value })}
                />
              </label>

              <label className="config-group">
                <span className="config-label">服务商协议</span>
                <select
                  className="model-select"
                  value={selectedModel.provider}
                  onChange={(event) => updateModel(selectedModel, {
                    provider: event.target.value as ManagedModel["provider"],
                  })}
                >
                  <option value="openai">OpenAI 兼容</option>
                  <option value="anthropic">Anthropic 兼容</option>
                </select>
              </label>

              <label className="config-group model-form-span">
                <span className="config-label">模型标识</span>
                <input
                  className="config-input"
                  value={selectedModel.model}
                  onChange={(event) => updateModel(selectedModel, { model: event.target.value })}
                />
              </label>

              <label className="config-group model-form-span">
                <span className="config-label">Base URL</span>
                <input
                  className="config-input"
                  value={selectedModel.baseURL}
                  placeholder={selectedModel.provider === "openai" ? "https://api.openai.com/v1" : "https://api.anthropic.com"}
                  onChange={(event) => updateModel(selectedModel, {
                    baseURL: event.target.value.trim().replace(/\/$/, ""),
                  })}
                />
              </label>

              <label className="config-group model-form-span">
                <span className="config-label">API Key</span>
                <input
                  className="config-input"
                  type="password"
                  value={selectedModel.apiKey}
                  onChange={(event) => updateModel(selectedModel, { apiKey: event.target.value.trim() })}
                />
              </label>

              {selectedModel.provider === "openai" && (
                <label className="config-group model-form-span">
                  <span className="config-label">OpenAI API 模式</span>
                  <select
                    className="model-select"
                    value={selectedModel.openaiApiMode}
                    onChange={(event) => updateModel(selectedModel, {
                      openaiApiMode: event.target.value as ManagedModel["openaiApiMode"],
                    })}
                  >
                    <option value="responses">Responses API</option>
                    <option value="chat-completions">Chat Completions 兼容模式</option>
                  </select>
                </label>
              )}
            </div>

            {!selectedModel.builtIn && (
              <button
                type="button"
                className="model-delete-btn cursor-api-delete"
                onClick={deleteSelectedModel}
                title="删除模型"
                aria-label="删除模型"
              >
                <TrashIcon size={15} />
              </button>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
