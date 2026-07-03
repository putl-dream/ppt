import React, { useEffect, useRef } from "react";
import { FolderIcon, PlusIcon, SendIcon } from "./Icons";
import type { ManagedModel } from "../modelCatalog";
import { getWorkspaceLabel } from "@shared/workspace";

interface UnifiedAgentInputProps {
  request: string;
  onChangeRequest: (val: string) => void;
  onSubmitRequest: () => void;
  busy: boolean;

  models: ManagedModel[];
  selectedModelId: string;
  setSelectedModelId: (val: string) => void;
  executionStrategy: "REQUEST_APPROVAL" | "AUTO";
  setExecutionStrategy: (val: "REQUEST_APPROVAL" | "AUTO") => void;
  localStoragePath: string;
  onSelectWorkspace?: () => void;

  layoutMode: "center" | "bottom";
  triggerToast: (msg: string) => void;
  selectedSlideIndex: number | null;
  onClearContextTag: () => void;
  submitLabel?: string;
  placeholder?: string;
}

function resizeTextarea(textarea: HTMLTextAreaElement) {
  const minHeight = Number.parseFloat(getComputedStyle(textarea).minHeight) || 52;
  textarea.style.height = "auto";
  const nextHeight = Math.min(Math.max(textarea.scrollHeight, minHeight), 160);
  textarea.style.height = `${nextHeight}px`;
}

export const UnifiedAgentInput: React.FC<UnifiedAgentInputProps> = ({
  request,
  onChangeRequest,
  onSubmitRequest,
  busy,
  models,
  selectedModelId,
  setSelectedModelId,
  executionStrategy,
  setExecutionStrategy,
  localStoragePath,
  onSelectWorkspace,
  layoutMode,
  selectedSlideIndex,
  onClearContextTag,
  submitLabel = "生成",
  placeholder,
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const folderName = getWorkspaceLabel(localStoragePath || undefined);
  const hasWorkspace = Boolean(localStoragePath);

  const handleSend = () => {
    if (busy || !request.trim()) return;
    onSubmitRequest();
    setTimeout(() => {
      textareaRef.current?.focus();
    }, 0);
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onChangeRequest(e.target.value);
    resizeTextarea(e.target);
  };

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    if (!request.trim()) {
      textarea.style.height = "";
      return;
    }
    resizeTextarea(textarea);
  }, [request, layoutMode]);

  const workspacePicker = (
    <button
      type="button"
      className={`workspace-picker-btn${hasWorkspace ? "" : " workspace-picker-btn--empty"}`}
      onClick={onSelectWorkspace}
      disabled={busy || !onSelectWorkspace}
      title={hasWorkspace ? localStoragePath : "选择项目目录作为沙箱"}
    >
      <FolderIcon size={13} />
      <span>{hasWorkspace ? folderName : "选择项目目录"}</span>
    </button>
  );

  return (
    <div className={`unified-agent-input-container ${layoutMode === "center" ? "center-focal-mode" : "bottom-anchored-mode"}`}>
      {layoutMode === "center" && (
        <div className="center-welcome-header">
          <h1 className="center-welcome-title">您今天想制作什么样的主题 PPT？</h1>
        </div>
      )}

      <div className="double-deck-panel-card">
        <div className="input-textarea-row">
          <textarea
            ref={textareaRef}
            value={request}
            onChange={handleChange}
            onKeyDown={handleKeyPress}
            placeholder={
              placeholder || (
                selectedSlideIndex !== null
                  ? `输入对第 ${selectedSlideIndex + 1} 页的局部指令（如："把背景换成白色"、"增大字号"）...`
                  : "输入修改意图，支持输入斜杠 / 唤醒快捷排版指令..."
              )
            }
            readOnly={busy}
            autoFocus
            rows={layoutMode === "center" ? 3 : 2}
            className={`input-textarea${busy ? " input-textarea--busy" : ""}`}
          />
        </div>

        <div className="functional-control-bar">
          <div className="functional-left">
            <button
              type="button"
              className="action-icon-btn upload-btn"
              title="上传外部参考资料 (暂未接入)"
              disabled
            >
              <PlusIcon size={14} />
            </button>
            {layoutMode === "bottom" ? workspacePicker : null}
            <div className="select-strategy-wrapper">
              <select
                value={executionStrategy}
                onChange={(e) => setExecutionStrategy(e.target.value as "REQUEST_APPROVAL" | "AUTO")}
                className="strategy-select"
                title="Agent 自治执行策略"
                disabled={busy}
              >
                <option value="REQUEST_APPROVAL">请求批准</option>
                <option value="AUTO">全自动运行</option>
              </select>
            </div>
          </div>

          <div className="functional-right">
            <div className="model-tier-select-wrapper">
              <select
                value={selectedModelId}
                onChange={(e) => setSelectedModelId(e.target.value)}
                className="mini-model-select"
                title="智能体模型级别"
                disabled={busy}
              >
                {models.map((model) => (
                  <option key={model.id} value={model.id}>{model.name}</option>
                ))}
              </select>
            </div>

            <button
              type="button"
              onClick={handleSend}
              disabled={busy || !request.trim()}
              className="send-cta-btn"
              title="启动智能体工作流"
            >
              <SendIcon size={14} />
              <span>{submitLabel}</span>
            </button>
          </div>
        </div>

        {layoutMode === "center" && (
          <div className="lower-deck-bar">
            <div className="context-left">
              {workspacePicker}
            </div>

            <div className="context-right">
              {selectedSlideIndex !== null ? (
                <span className="active-context-slide-pill">
                  选中范围: 第 {selectedSlideIndex + 1} 页
                  <button type="button" className="close-slide-pill-btn" onClick={onClearContextTag}>✕</button>
                </span>
              ) : (
                <span className="context-global-pill">全局文档设计</span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
