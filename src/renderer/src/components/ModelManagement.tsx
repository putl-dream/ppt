import { useEffect, useState } from "react";
import type { ManagedModel } from "../modelCatalog";
import { PlusIcon, TrashIcon } from "./Icons";

interface ModelManagementProps {
  models: ManagedModel[];
  selectedModelId: string;
  onSelectModel: (id: string) => void;
  onSaveModel: (model: ManagedModel) => void;
  onDeleteModel: (id: string) => void;
  triggerToast: (message: string) => void;
}

function createDraft(): ManagedModel {
  return {
    id: `custom-${crypto.randomUUID()}`,
    name: "",
    provider: "openai",
    model: "",
    apiKey: "",
    baseURL: "",
    openaiApiMode: "chat-completions",
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
  const [editingId, setEditingId] = useState(models[0]?.id ?? "");
  const [draft, setDraft] = useState<ManagedModel>(models[0] ?? createDraft());
  const [showApiKey, setShowApiKey] = useState(false);

  useEffect(() => {
    const model = models.find((item) => item.id === editingId);
    if (model) setDraft({ ...model });
  }, [editingId, models]);

  const beginCreate = () => {
    const next = createDraft();
    setEditingId(next.id);
    setDraft(next);
    setShowApiKey(false);
  };

  const save = (): ManagedModel | undefined => {
    if (!draft.name.trim() || !draft.model.trim()) {
      triggerToast("请填写模型名称和模型标识");
      return;
    }
    if (draft.baseURL.trim()) {
      try {
        new URL(draft.baseURL);
      } catch {
        triggerToast("Base URL 格式不正确");
        return;
      }
    }
    const normalized = {
      ...draft,
      name: draft.name.trim(),
      model: draft.model.trim(),
      apiKey: draft.apiKey.trim(),
      baseURL: draft.baseURL.trim().replace(/\/$/, ""),
    };
    onSaveModel(normalized);
    setEditingId(normalized.id);
    triggerToast("模型配置已保存");
    return normalized;
  };

  const remove = (model: ManagedModel) => {
    if (model.builtIn) return;
    onDeleteModel(model.id);
    const fallback = models.find((item) => item.id !== model.id);
    if (fallback) setEditingId(fallback.id);
    triggerToast("自定义模型已删除");
  };

  return (
    <div className="model-management-layout settings-panel-fade">
      <section className="settings-card model-list-card">
        <div className="model-card-heading">
          <div>
            <h3>模型目录</h3>
            <p>{models.length} 个模型可用于 Agent 工作流</p>
          </div>
          <button className="secondary-btn model-add-btn" onClick={beginCreate}>
            <PlusIcon size={15} /> 新增模型
          </button>
        </div>

        <div className="managed-model-list">
          {models.map((model) => (
            <button
              key={model.id}
              className={`managed-model-item ${editingId === model.id ? "editing" : ""}`}
              onClick={() => setEditingId(model.id)}
            >
              <span className={`provider-badge provider-${model.provider}`}>
                {model.provider === "openai" ? "OA" : "AN"}
              </span>
              <span className="managed-model-copy">
                <strong>{model.name}</strong>
                <small>{model.model}</small>
              </span>
              {selectedModelId === model.id && <span className="active-model-badge">使用中</span>}
            </button>
          ))}
        </div>
      </section>

      <section className="settings-card model-editor-card">
        <div className="model-card-heading">
          <div>
            <h3>{draft.builtIn ? "配置内置模型" : models.some((item) => item.id === draft.id) ? "编辑自定义模型" : "新增自定义模型"}</h3>
            <p>配置将保存在当前设备，并在发起 Agent 请求时传给后端。</p>
          </div>
          {models.some((item) => item.id === draft.id) && !draft.builtIn && (
            <button className="model-delete-btn" onClick={() => remove(draft)} title="删除模型">
              <TrashIcon size={16} />
            </button>
          )}
        </div>

        <div className="model-form-grid">
          <label className="config-group">
            <span className="config-label">显示名称</span>
            <input className="config-input" value={draft.name} placeholder="例如：公司内部 GPT" onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
          </label>

          <label className="config-group">
            <span className="config-label">服务商协议</span>
            <select className="model-select" value={draft.provider} onChange={(event) => setDraft({ ...draft, provider: event.target.value as ManagedModel["provider"] })}>
              <option value="openai">OpenAI 兼容</option>
              <option value="anthropic">Anthropic 兼容</option>
            </select>
          </label>

          <label className="config-group model-form-span">
            <span className="config-label">模型标识</span>
            <input className="config-input" value={draft.model} placeholder="例如：gpt-4.1 / deepseek-chat / claude-sonnet-4" onChange={(event) => setDraft({ ...draft, model: event.target.value })} />
            <span className="config-help">填写服务端实际接收的 model 参数。</span>
          </label>

          <label className="config-group model-form-span">
            <span className="config-label">Base URL（可选）</span>
            <input className="config-input" value={draft.baseURL} placeholder={draft.provider === "openai" ? "https://api.openai.com/v1" : "https://api.anthropic.com"} onChange={(event) => setDraft({ ...draft, baseURL: event.target.value })} />
            <span className="config-help">留空时使用后端环境变量中的默认地址。</span>
          </label>

          <label className="config-group model-form-span">
            <span className="config-label">API Key</span>
            <div className="model-secret-row">
              <input className="config-input" type={showApiKey ? "text" : "password"} value={draft.apiKey} placeholder="留空则使用后端环境变量" onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })} />
              <button type="button" className="secondary-btn" onClick={() => setShowApiKey((value) => !value)}>{showApiKey ? "隐藏" : "显示"}</button>
            </div>
          </label>

          {draft.provider === "openai" && (
            <label className="config-group model-form-span">
              <span className="config-label">OpenAI API 模式</span>
              <select className="model-select" value={draft.openaiApiMode} onChange={(event) => setDraft({ ...draft, openaiApiMode: event.target.value as ManagedModel["openaiApiMode"] })}>
                <option value="responses">Responses API</option>
                <option value="chat-completions">Chat Completions 兼容模式</option>
              </select>
            </label>
          )}
        </div>

        <div className="model-editor-actions">
          <button className="secondary-btn" onClick={save}>保存配置</button>
          <button className="optimize-slide-btn" onClick={() => {
            const saved = save();
            if (saved) onSelectModel(saved.id);
          }}>
            保存并设为当前模型
          </button>
        </div>
      </section>
    </div>
  );
}
