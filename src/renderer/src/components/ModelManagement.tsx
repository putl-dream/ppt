import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { ManagedModel } from "../modelCatalog";
import { isModelEnabled } from "../modelCatalog";
import { Edit3Icon, PlusIcon, RefreshIcon, TrashIcon } from "./Icons";

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
  const [dialogModel, setDialogModel] = useState<ManagedModel | null>(null);
  const [dialogMode, setDialogMode] = useState<"create" | "edit">("create");
  const dialogRef = useRef<HTMLElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const normalizedQuery = query.trim().toLowerCase();

  const filteredModels = useMemo(() => {
    if (!normalizedQuery) return models;
    return models.filter((model) => {
      return `${model.name} ${model.model}`.toLowerCase().includes(normalizedQuery);
    });
  }, [models, normalizedQuery]);

  const enabledCount = models.filter(isModelEnabled).length;

  const openModelDialog = (mode: "create" | "edit", model: ManagedModel) => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setDialogMode(mode);
    setDialogModel({
      ...model,
      apiKey: model.apiKey ?? "",
      baseURL: model.baseURL ?? "",
      openaiApiMode: model.openaiApiMode ?? "chat-completions",
    });
  };

  const closeModelDialog = () => {
    setDialogModel(null);
    window.setTimeout(() => returnFocusRef.current?.focus(), 0);
  };

  useEffect(() => {
    if (!dialogModel) return;
    window.setTimeout(() => dialogRef.current?.querySelector<HTMLElement>("input, select, button")?.focus(), 0);

    const handleDialogKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeModelDialog();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleDialogKeyDown);
    return () => document.removeEventListener("keydown", handleDialogKeyDown);
  }, [Boolean(dialogModel)]);

  const updateDialogModel = (patch: Partial<ManagedModel>) => {
    setDialogModel((current) => (current ? { ...current, ...patch } : current));
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

  const addOrSelectModel = (rawName: string) => {
    const name = rawName.trim();
    if (!name) return;

    const exactMatch = models.find((model) => {
      const normalized = name.toLowerCase();
      return model.name.toLowerCase() === normalized || model.model.toLowerCase() === normalized;
    });

    if (exactMatch) {
      onSelectModel(exactMatch.id);
      openModelDialog("edit", exactMatch);
      setQuery("");
      return;
    }

    openModelDialog("create", createDraft(name));
  };

  const handleQueryKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    addOrSelectModel(query);
  };

  const handleAddModel = () => {
    const name = query.trim() || `自定义模型 ${models.length + 1}`;
    addOrSelectModel(name);
  };

  const saveDialogModel = () => {
    if (!dialogModel) return;
    const name = dialogModel.name.trim();
    const modelId = dialogModel.model.trim();

    if (!name || !modelId) {
      triggerToast("请填写模型名称和模型标识");
      return;
    }

    const next: ManagedModel = {
      ...dialogModel,
      name,
      model: modelId,
      baseURL: dialogModel.baseURL.trim().replace(/\/$/, ""),
      apiKey: dialogModel.apiKey.trim(),
    };

    onSaveModel(next);
    if (next.enabled !== false) onSelectModel(next.id);
    closeModelDialog();
    setQuery("");
    triggerToast(dialogMode === "create" ? "模型已添加" : "模型已保存");
  };

  const deleteDialogModel = () => {
    if (!dialogModel || dialogModel.builtIn) return;
    if (isModelEnabled(dialogModel) && enabledCount <= 1) {
      triggerToast("至少保留一个可用模型");
      return;
    }

    const fallback = models.find((model) => model.id !== dialogModel.id && isModelEnabled(model));
    onDeleteModel(dialogModel.id);
    if (fallback) onSelectModel(fallback.id);
    closeModelDialog();
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
            placeholder="搜索模型，或输入名称后添加"
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

        <button
          type="button"
          className="cursor-model-add-btn"
          onClick={handleAddModel}
        >
          <PlusIcon size={14} />
          <span>{query.trim() ? `添加 “${query.trim()}”` : "添加模型"}</span>
        </button>

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
                <button
                  type="button"
                  className="cursor-model-edit-btn"
                  onClick={() => openModelDialog("edit", model)}
                  title="编辑模型"
                  aria-label={`编辑模型 ${model.name}`}
                >
                  <Edit3Icon size={14} />
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

        {normalizedQuery ? (
          <button
            type="button"
            className="cursor-model-view-all"
            onClick={() => setQuery("")}
          >
            查看全部模型
          </button>
        ) : null}
      </section>

      {dialogModel && (
        <div
          className="model-dialog-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeModelDialog();
          }}
        >
          <section
            className="model-dialog"
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="model-dialog-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="model-dialog-header">
              <div>
                <h3 id="model-dialog-title">{dialogMode === "create" ? "新增模型" : "编辑模型"}</h3>
                <p>{dialogModel.provider === "openai" ? "OpenAI 兼容服务" : "Anthropic 兼容服务"}</p>
              </div>
              <button
                type="button"
                className="model-dialog-close-btn"
                onClick={closeModelDialog}
                title="关闭"
                aria-label="关闭模型表单"
              >
                <span aria-hidden="true">x</span>
              </button>
            </header>

            <div className="model-form-grid">
              <label className="config-group">
                <span className="config-label">显示名称</span>
                <input
                  className="config-input"
                  value={dialogModel.name}
                  onChange={(event) => updateDialogModel({ name: event.target.value })}
                />
              </label>

              <label className="config-group">
                <span className="config-label">服务商协议</span>
                <select
                  className="model-select"
                  value={dialogModel.provider}
                  onChange={(event) => updateDialogModel({
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
                  value={dialogModel.model}
                  onChange={(event) => updateDialogModel({ model: event.target.value })}
                />
              </label>

              <label className="config-group model-form-span">
                <span className="config-label">Base URL</span>
                <input
                  className="config-input"
                  value={dialogModel.baseURL}
                  placeholder={dialogModel.provider === "openai" ? "https://api.openai.com/v1" : "https://api.anthropic.com"}
                  onChange={(event) => updateDialogModel({
                    baseURL: event.target.value.trim().replace(/\/$/, ""),
                  })}
                />
              </label>

              <label className="config-group model-form-span">
                <span className="config-label">API Key</span>
                <input
                  className="config-input"
                  type="password"
                  value={dialogModel.apiKey}
                  onChange={(event) => updateDialogModel({ apiKey: event.target.value.trim() })}
                />
              </label>

              {dialogModel.provider === "openai" && (
                <label className="config-group model-form-span">
                  <span className="config-label">OpenAI API 模式</span>
                  <select
                    className="model-select"
                    value={dialogModel.openaiApiMode}
                    onChange={(event) => updateDialogModel({
                      openaiApiMode: event.target.value as ManagedModel["openaiApiMode"],
                    })}
                  >
                    <option value="responses">Responses API</option>
                    <option value="chat-completions">Chat Completions 兼容模式</option>
                  </select>
                </label>
              )}
            </div>

            <footer className="model-dialog-footer">
              {!dialogModel.builtIn && dialogMode === "edit" ? (
                <button
                  type="button"
                  className="model-dialog-danger-btn"
                  onClick={deleteDialogModel}
                >
                  <TrashIcon size={15} />
                  <span>删除模型</span>
                </button>
              ) : (
                <span />
              )}

              <div className="model-dialog-actions">
                <button
                  type="button"
                  className="settings-secondary-btn"
                  onClick={closeModelDialog}
                >
                  取消
                </button>
                <button
                  type="button"
                  className="settings-primary-btn"
                  onClick={saveDialogModel}
                >
                  {dialogMode === "create" ? "添加" : "保存"}
                </button>
              </div>
            </footer>
          </section>
        </div>
      )}
    </div>
  );
}
