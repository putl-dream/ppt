import { useEffect, useMemo, useRef, useState } from "react";
import {
  MODEL_VENDOR_PRESETS,
  buildModelVendorDraft,
  changeModelVendorDraftProtocol,
  getModelVendorPreset,
  isModelEnabled,
  materializeModelVendorDraft,
  type ManagedModel,
  type ModelTokenPricing,
  type ModelVendorDraft,
  type ModelVendorId,
} from "../modelCatalog";
import { Edit3Icon, PlusIcon, RefreshIcon, TrashIcon } from "./Icons";
import { Select } from "./Select";

interface ModelManagementProps {
  models: ManagedModel[];
  selectedModelId: string;
  onSelectModel: (id: string) => void;
  onSaveModel: (model: ManagedModel) => void;
  onDeleteModel: (id: string) => void;
  triggerToast: (message: string) => void;
}

const VENDOR_OPTIONS = [
  ...MODEL_VENDOR_PRESETS.map((preset) => ({
    value: preset.id,
    label: preset.label,
    hint: preset.hint,
  })),
  { value: "custom", label: "自定义兼容服务", hint: "手动配置一个模型" },
];

function validHttpURL(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function emptyPricing(): ModelTokenPricing {
  return {
    currency: "CNY",
    inputPerMillion: 0,
    cachedInputPerMillion: 0,
    outputPerMillion: 0,
    updatedAt: new Date().toISOString().slice(0, 10),
  };
}

function validPricing(pricing: ManagedModel["pricing"]): boolean {
  if (!pricing) return true;
  return [
    pricing.inputPerMillion,
    pricing.cachedInputPerMillion,
    pricing.outputPerMillion,
  ].every((value) => Number.isFinite(value) && value >= 0)
    && (pricing.cacheCreationInputPerMillion === undefined
      || (Number.isFinite(pricing.cacheCreationInputPerMillion)
        && pricing.cacheCreationInputPerMillion >= 0));
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
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [vendorDraft, setVendorDraft] = useState<ModelVendorDraft | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const dialogRef = useRef<HTMLElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const normalizedQuery = query.trim().toLowerCase();
  const dialogVisible = addDialogOpen || Boolean(dialogModel);

  const filteredModels = useMemo(() => {
    if (!normalizedQuery) return models;
    return models.filter((model) =>
      `${model.name} ${model.model}`.toLowerCase().includes(normalizedQuery));
  }, [models, normalizedQuery]);

  const enabledCount = models.filter(isModelEnabled).length;

  const rememberDialogFocus = () => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  };

  const openModelDialog = (model: ManagedModel) => {
    rememberDialogFocus();
    setDialogModel({
      ...model,
      apiKey: model.apiKey ?? "",
      baseURL: model.baseURL ?? "",
      openaiApiMode: model.openaiApiMode ?? "chat-completions",
    });
  };

  const openAddDialog = () => {
    rememberDialogFocus();
    setVendorDraft(null);
    setAdvancedOpen(false);
    setAddDialogOpen(true);
  };

  const closeDialog = () => {
    setDialogModel(null);
    setAddDialogOpen(false);
    setVendorDraft(null);
    setAdvancedOpen(false);
    window.setTimeout(() => returnFocusRef.current?.focus(), 0);
  };

  useEffect(() => {
    if (!dialogVisible) return;
    window.setTimeout(() => dialogRef.current?.querySelector<HTMLElement>(
      "input, select, button",
    )?.focus(), 0);

    const handleDialogKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeDialog();
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
  }, [dialogVisible]);

  const updateDialogModel = (patch: Partial<ManagedModel>) => {
    setDialogModel((current) => (current ? { ...current, ...patch } : current));
  };

  const updateVendorDraft = (patch: Partial<ModelVendorDraft>) => {
    setVendorDraft((current) => (current ? { ...current, ...patch } : current));
  };

  const updateVendorDraftModel = (id: string, patch: Partial<ManagedModel>) => {
    setVendorDraft((current) => current ? {
      ...current,
      models: current.models.map((model) => model.id === id ? { ...model, ...patch } : model),
    } : current);
  };

  const selectVendor = (value: string) => {
    const vendorId = value as ModelVendorId;
    setVendorDraft(buildModelVendorDraft(vendorId, models));
    setAdvancedOpen(vendorId === "custom");
  };

  const selectVendorProtocol = (value: string) => {
    setVendorDraft((current) => current
      ? changeModelVendorDraftProtocol(current, value as ManagedModel["provider"])
      : current);
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

  const saveVendorDraft = () => {
    if (!vendorDraft) {
      triggerToast("请先选择模型厂商");
      return;
    }
    if (!vendorDraft.apiKey.trim()) {
      triggerToast("请填写 API Key");
      return;
    }
    if (!vendorDraft.baseURL.trim() || !validHttpURL(vendorDraft.baseURL)) {
      triggerToast("请填写有效的 Base URL");
      return;
    }
    if (vendorDraft.models.some((model) => !model.name.trim() || !model.model.trim())) {
      triggerToast("请填写模型名称和模型标识");
      return;
    }
    if (vendorDraft.models.some((model) => !validPricing(model.pricing))) {
      triggerToast("请填写有效的非负模型单价");
      return;
    }

    const nextModels = materializeModelVendorDraft(vendorDraft);
    nextModels.forEach(onSaveModel);
    const preset = getModelVendorPreset(vendorDraft.vendorId);
    onSelectModel(preset?.defaultModelId ?? nextModels[0].id);
    closeDialog();
    setQuery("");
    triggerToast(preset ? `${preset.label} 模型已配置` : "自定义模型已添加");
  };

  const saveDialogModel = () => {
    if (!dialogModel) return;
    const name = dialogModel.name.trim();
    const modelId = dialogModel.model.trim();
    if (!name || !modelId) {
      triggerToast("请填写模型名称和模型标识");
      return;
    }
    if (!validPricing(dialogModel.pricing)) {
      triggerToast("请填写有效的非负模型单价");
      return;
    }

    const next: ManagedModel = {
      ...dialogModel,
      name,
      model: modelId,
      baseURL: dialogModel.baseURL.trim().replace(/\/+$/, ""),
      apiKey: dialogModel.apiKey.trim(),
      pricing: dialogModel.pricing ? {
        ...dialogModel.pricing,
        updatedAt: new Date().toISOString().slice(0, 10),
      } : dialogModel.pricing,
    };
    onSaveModel(next);
    if (next.enabled !== false) onSelectModel(next.id);
    closeDialog();
    triggerToast("模型已保存");
  };

  const deleteDialogModel = () => {
    if (!dialogModel || dialogModel.builtIn) return;
    if (isModelEnabled(dialogModel) && enabledCount <= 1) {
      triggerToast("至少保留一个可用模型");
      return;
    }
    const fallback = models.find((model) =>
      model.id !== dialogModel.id && isModelEnabled(model));
    onDeleteModel(dialogModel.id);
    if (fallback) onSelectModel(fallback.id);
    closeDialog();
    triggerToast("自定义模型已删除");
  };

  const renderPricingFields = (
    model: ManagedModel,
    updatePricing: (pricing: ModelTokenPricing | null) => void,
  ) => {
    const pricing = model.pricing;
    const updatePrice = (patch: Partial<ModelTokenPricing>) => {
      if (pricing) updatePricing({ ...pricing, ...patch });
    };
    const numberValue = (value: number | undefined) =>
      value === undefined || !Number.isFinite(value) ? "" : String(value);
    const requiredNumber = (value: string) => value === "" ? Number.NaN : Number(value);

    return (
      <div className="model-pricing-section model-form-span">
        <div className="model-capability-heading">
          <span className="config-label">费用估算</span>
          <label className="model-pricing-toggle">
            <input
              type="checkbox"
              aria-label={`${model.name} 启用费用估算`}
              checked={Boolean(pricing)}
              onChange={(event) => updatePricing(event.target.checked ? emptyPricing() : null)}
            />
            <span>{pricing ? "已启用" : "未配置"}</span>
          </label>
        </div>
        {pricing ? (
          <div className="model-pricing-fields">
            <div className="config-group model-pricing-currency">
              <span className="config-label">币种</span>
              <Select
                variant="block"
                ariaLabel={`${model.name} 定价币种`}
                value={pricing.currency}
                onChange={(value) => updatePrice({
                  currency: value as ModelTokenPricing["currency"],
                })}
                options={[
                  { value: "CNY", label: "人民币 (CNY)" },
                  { value: "USD", label: "美元 (USD)" },
                ]}
              />
            </div>
            <label className="config-group">
              <span className="config-label">普通输入 / 百万 Token</span>
              <input
                className="config-input"
                aria-label={`${model.name} 普通输入单价`}
                type="number"
                min="0"
                step="any"
                value={numberValue(pricing.inputPerMillion)}
                onChange={(event) => updatePrice({ inputPerMillion: requiredNumber(event.target.value) })}
              />
            </label>
            <label className="config-group">
              <span className="config-label">缓存命中 / 百万 Token</span>
              <input
                className="config-input"
                aria-label={`${model.name} 缓存命中单价`}
                type="number"
                min="0"
                step="any"
                value={numberValue(pricing.cachedInputPerMillion)}
                onChange={(event) => updatePrice({ cachedInputPerMillion: requiredNumber(event.target.value) })}
              />
            </label>
            <label className="config-group">
              <span className="config-label">缓存写入 / 百万 Token（可选）</span>
              <input
                className="config-input"
                aria-label={`${model.name} 缓存写入单价`}
                type="number"
                min="0"
                step="any"
                placeholder="留空时按普通输入价"
                value={numberValue(pricing.cacheCreationInputPerMillion)}
                onChange={(event) => updatePrice({
                  cacheCreationInputPerMillion: event.target.value === ""
                    ? undefined
                    : Number(event.target.value),
                })}
              />
            </label>
            <label className="config-group">
              <span className="config-label">输出 / 百万 Token</span>
              <input
                className="config-input"
                aria-label={`${model.name} 输出单价`}
                type="number"
                min="0"
                step="any"
                value={numberValue(pricing.outputPerMillion)}
                onChange={(event) => updatePrice({ outputPerMillion: requiredNumber(event.target.value) })}
              />
            </label>
          </div>
        ) : (
          <small className="model-pricing-hint">未配置价格时，用量页显示“费用未知”。</small>
        )}
      </div>
    );
  };

  const renderDraftModelFields = (model: ManagedModel) => (
    <div key={model.id} className="model-vendor-advanced-model">
      <div className="model-vendor-advanced-title">{model.name || "未命名模型"}</div>
      <div className="model-form-grid model-vendor-advanced-grid">
        <label className="config-group">
          <span className="config-label">显示名称</span>
          <input
            className="config-input"
            value={model.name}
            onChange={(event) => updateVendorDraftModel(model.id, { name: event.target.value })}
          />
        </label>
        <label className="config-group">
          <span className="config-label">模型标识</span>
          <input
            className="config-input"
            value={model.model}
            onChange={(event) => updateVendorDraftModel(model.id, { model: event.target.value })}
          />
        </label>
        {vendorDraft?.protocol === "openai" ? (
          <div className="config-group model-form-span">
            <span className="config-label">OpenAI API 模式</span>
            <Select
              variant="block"
              ariaLabel={`${model.name} OpenAI API 模式`}
              value={model.openaiApiMode}
              onChange={(value) => updateVendorDraftModel(model.id, {
                openaiApiMode: value as ManagedModel["openaiApiMode"],
              })}
              options={[
                { value: "responses", label: "Responses API" },
                { value: "chat-completions", label: "Chat Completions 兼容模式" },
              ]}
            />
          </div>
        ) : null}
        <label className="model-capability-option model-form-span">
          <input
            type="checkbox"
            checked={model.supports1MContext === true}
            onChange={(event) => updateVendorDraftModel(model.id, {
              supports1MContext: event.target.checked,
            })}
          />
          <span>
            <strong>支持 1M 上下文</strong>
            <small>未勾选时使用默认 256K 上下文</small>
          </span>
        </label>
        {renderPricingFields(model, (pricing) => updateVendorDraftModel(model.id, { pricing }))}
      </div>
    </div>
  );

  return (
    <div className="model-management-layout settings-panel-fade">
      <section className="cursor-model-card">
        <div className="cursor-model-search-row">
          <input
            className="cursor-model-search"
            value={query}
            placeholder="搜索模型"
            onChange={(event) => setQuery(event.target.value)}
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

        <button type="button" className="cursor-model-add-btn" onClick={openAddDialog}>
          <PlusIcon size={14} />
          <span>添加厂商模型</span>
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
                  onClick={() => openModelDialog(model)}
                  title="编辑模型"
                  aria-label={`编辑模型 ${model.name}`}
                >
                  <Edit3Icon size={14} />
                </button>
                <label className="toggle-switch cursor-model-toggle" title={enabled ? "关闭模型" : "开启模型"}>
                  <input type="checkbox" checked={enabled} onChange={() => toggleModel(model)} />
                  <span className="toggle-slider"></span>
                </label>
              </div>
            );
          })}
          {filteredModels.length === 0 ? (
            <div className="cursor-model-empty">没有匹配的模型</div>
          ) : null}
        </div>

        {normalizedQuery ? (
          <button type="button" className="cursor-model-view-all" onClick={() => setQuery("")}>
            查看全部模型
          </button>
        ) : null}
      </section>

      {addDialogOpen ? (
        <div
          className="model-dialog-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeDialog();
          }}
        >
          <section
            className="model-dialog model-vendor-dialog"
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="model-vendor-dialog-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="model-dialog-header">
              <div>
                <h3 id="model-vendor-dialog-title">添加厂商模型</h3>
                <p>选择厂商后只需填写 API Key，其余配置会自动完成</p>
              </div>
              <button type="button" className="model-dialog-close-btn" onClick={closeDialog} aria-label="关闭模型表单">
                <span aria-hidden="true">x</span>
              </button>
            </header>

            <div className="model-vendor-form">
              <div className="config-group">
                <span className="config-label">模型厂商</span>
                <Select
                  variant="block"
                  ariaLabel="模型厂商"
                  value={vendorDraft?.vendorId ?? ""}
                  placeholder="选择模型厂商"
                  onChange={selectVendor}
                  options={VENDOR_OPTIONS}
                />
              </div>

              {vendorDraft ? (
                <>
                  <label className="config-group">
                    <span className="config-label">API Key</span>
                    <input
                      className="config-input"
                      type="password"
                      value={vendorDraft.apiKey}
                      placeholder="填写厂商 API Key"
                      onChange={(event) => updateVendorDraft({ apiKey: event.target.value })}
                    />
                  </label>

                  {vendorDraft.vendorId !== "custom" ? (
                    <div className="model-vendor-summary">
                      <div className="model-vendor-summary-heading">
                        <span>将配置以下模型</span>
                        <span>{vendorDraft.models.length} 个</span>
                      </div>
                      {vendorDraft.models.map((model) => (
                        <div key={model.id} className="model-vendor-summary-row">
                          <span>
                            <strong>{model.name}</strong>
                            <small>{model.model}</small>
                          </span>
                          {model.supports1MContext ? <em>1M</em> : <em>256K</em>}
                        </div>
                      ))}
                    </div>
                  ) : null}

                  {vendorDraft.vendorId !== "custom" ? (
                    <button
                      type="button"
                      className={`model-vendor-advanced-toggle${advancedOpen ? " is-open" : ""}`}
                      onClick={() => setAdvancedOpen((open) => !open)}
                      aria-expanded={advancedOpen}
                    >
                      <span>高级设置</span>
                      <span>{advancedOpen ? "收起" : "展开"}</span>
                    </button>
                  ) : null}

                  {advancedOpen ? (
                    <div className="model-vendor-advanced">
                      <div className="config-group">
                        <span className="config-label">服务商协议</span>
                        <Select
                          variant="block"
                          ariaLabel="服务商协议"
                          value={vendorDraft.protocol}
                          disabled={(getModelVendorPreset(vendorDraft.vendorId)?.supportedProviders.length ?? 2) === 1}
                          onChange={selectVendorProtocol}
                          options={[
                            { value: "openai", label: "OpenAI 兼容" },
                            { value: "anthropic", label: "Anthropic 兼容" },
                          ]}
                        />
                      </div>
                      <label className="config-group">
                        <span className="config-label">Base URL</span>
                        <input
                          className="config-input"
                          value={vendorDraft.baseURL}
                          placeholder={vendorDraft.protocol === "openai" ? "https://api.example.com/v1" : "https://api.example.com"}
                          onChange={(event) => updateVendorDraft({ baseURL: event.target.value })}
                        />
                      </label>
                      <div className="model-vendor-advanced-model-list">
                        {vendorDraft.models.map(renderDraftModelFields)}
                      </div>
                    </div>
                  ) : null}
                </>
              ) : (
                <p className="model-vendor-empty-hint">选择厂商后，将自动填入请求地址、协议和模型能力。</p>
              )}
            </div>

            <footer className="model-dialog-footer">
              <span />
              <div className="model-dialog-actions">
                <button type="button" className="settings-secondary-btn" onClick={closeDialog}>取消</button>
                <button type="button" className="settings-primary-btn" onClick={saveVendorDraft}>添加模型</button>
              </div>
            </footer>
          </section>
        </div>
      ) : null}

      {dialogModel ? (
        <div
          className="model-dialog-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeDialog();
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
                <h3 id="model-dialog-title">编辑模型</h3>
                <p>{dialogModel.provider === "openai" ? "OpenAI 兼容服务" : "Anthropic 兼容服务"}</p>
              </div>
              <button type="button" className="model-dialog-close-btn" onClick={closeDialog} aria-label="关闭模型表单">
                <span aria-hidden="true">x</span>
              </button>
            </header>

            <div className="model-form-grid">
              <label className="config-group">
                <span className="config-label">显示名称</span>
                <input className="config-input" value={dialogModel.name} onChange={(event) => updateDialogModel({ name: event.target.value })} />
              </label>
              <div className="config-group">
                <span className="config-label">服务商协议</span>
                <Select
                  variant="block"
                  ariaLabel="服务商协议"
                  value={dialogModel.provider}
                  onChange={(value) => updateDialogModel({ provider: value as ManagedModel["provider"] })}
                  options={[
                    { value: "openai", label: "OpenAI 兼容" },
                    { value: "anthropic", label: "Anthropic 兼容" },
                  ]}
                />
              </div>
              <label className="config-group model-form-span">
                <span className="config-label">模型标识</span>
                <input className="config-input" value={dialogModel.model} onChange={(event) => updateDialogModel({ model: event.target.value })} />
              </label>
              <label className="config-group model-form-span">
                <span className="config-label">Base URL</span>
                <input
                  className="config-input"
                  value={dialogModel.baseURL}
                  placeholder={dialogModel.provider === "openai" ? "https://api.openai.com/v1" : "https://api.anthropic.com"}
                  onChange={(event) => updateDialogModel({ baseURL: event.target.value })}
                />
              </label>
              <label className="config-group model-form-span">
                <span className="config-label">API Key</span>
                <input className="config-input" type="password" value={dialogModel.apiKey} onChange={(event) => updateDialogModel({ apiKey: event.target.value })} />
              </label>
              {dialogModel.provider === "openai" ? (
                <div className="config-group model-form-span">
                  <span className="config-label">OpenAI API 模式</span>
                  <Select
                    variant="block"
                    ariaLabel="OpenAI API 模式"
                    value={dialogModel.openaiApiMode}
                    onChange={(value) => updateDialogModel({ openaiApiMode: value as ManagedModel["openaiApiMode"] })}
                    options={[
                      { value: "responses", label: "Responses API" },
                      { value: "chat-completions", label: "Chat Completions 兼容模式" },
                    ]}
                  />
                </div>
              ) : null}
              <div className="model-capability-section model-form-span">
                <div className="model-capability-heading">
                  <span className="config-label">模型能力</span>
                  <span className="model-capability-default">默认 256K</span>
                </div>
                <label className="model-capability-option">
                  <input
                    type="checkbox"
                    checked={dialogModel.supports1MContext === true}
                    onChange={(event) => updateDialogModel({ supports1MContext: event.target.checked })}
                  />
                  <span>
                    <strong>支持 1M 上下文</strong>
                    <small>仅当服务商明确支持 1,000,000 token 上下文时勾选</small>
                  </span>
                </label>
              </div>
              {renderPricingFields(dialogModel, (pricing) => updateDialogModel({ pricing }))}
            </div>

            <footer className="model-dialog-footer">
              {!dialogModel.builtIn ? (
                <button type="button" className="model-dialog-danger-btn" onClick={deleteDialogModel}>
                  <TrashIcon size={15} />
                  <span>删除模型</span>
                </button>
              ) : <span />}
              <div className="model-dialog-actions">
                <button type="button" className="settings-secondary-btn" onClick={closeDialog}>取消</button>
                <button type="button" className="settings-primary-btn" onClick={saveDialogModel}>保存</button>
              </div>
            </footer>
          </section>
        </div>
      ) : null}
    </div>
  );
}
