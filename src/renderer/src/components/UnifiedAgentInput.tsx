import React, { useEffect, useRef, useState } from "react";
import { CheckIcon, ChevronDownIcon, FolderIcon, SendIcon, StopIcon } from "./Icons";
import type { ManagedModel } from "../modelCatalog";
import { ToolApprovalOverlay, type PendingToolApproval } from "./ToolApprovalOverlay";

interface UnifiedAgentInputProps {
  request: string;
  onChangeRequest: (value: string) => void;
  onSubmitRequest: () => void;
  busy: boolean;
  models: ManagedModel[];
  selectedModelId: string;
  setSelectedModelId: (value: string) => void;
  layoutMode: "center" | "bottom";
  pendingToolApproval?: PendingToolApproval | null;
  onResolveToolApproval?: (approvalId: string, approved: boolean) => void;
  canCancelRun?: boolean;
  onCancelRun?: () => void;
  isCancellingRun?: boolean;
  sandboxReady?: boolean;
  sandboxName?: string;
  onPrepareWorkspace?: () => void;
}

function resizeTextarea(textarea: HTMLTextAreaElement) {
  const minHeight = Number.parseFloat(getComputedStyle(textarea).minHeight) || 52;
  textarea.style.height = "auto";
  const nextHeight = Math.min(Math.max(textarea.scrollHeight, minHeight), 180);
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
  layoutMode,
  pendingToolApproval = null,
  onResolveToolApproval,
  canCancelRun = false,
  onCancelRun,
  isCancellingRun = false,
  sandboxReady = true,
  sandboxName,
  onPrepareWorkspace,
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const modelMenuRef = useRef<HTMLDivElement>(null);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const selectedModel = models.find((model) => model.id === selectedModelId) ?? models[0];
  const isPermissionGateOpen = Boolean(pendingToolApproval && onResolveToolApproval);

  const handleSend = () => {
    if (busy || !sandboxReady || !request.trim()) return;
    onSubmitRequest();
    window.setTimeout(() => textareaRef.current?.focus(), 0);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  };

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    if (!request.trim()) {
      textarea.style.height = "";
      return;
    }
    resizeTextarea(textarea);
  }, [layoutMode, request]);

  useEffect(() => {
    if (!modelMenuOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!modelMenuRef.current?.contains(event.target as Node)) setModelMenuOpen(false);
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setModelMenuOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [modelMenuOpen]);

  return (
    <div className={`unified-agent-input-container ${layoutMode === "center" ? "center-focal-mode" : "bottom-anchored-mode"}`}>
      {layoutMode === "center" ? (
        <div className="center-welcome-header">
          <span className="center-welcome-eyebrow">AI PRESENTATION WORKSPACE</span>
          <h1 className="center-welcome-title">从一个清晰的目标开始</h1>
          <p className="center-welcome-subtitle">描述受众、场景和希望传达的核心结论，其余工作交给 Agent。</p>
        </div>
      ) : null}

      <div className="unified-agent-input-stack">
        {!sandboxReady ? (
          <section className="sandbox-preflight-card" aria-labelledby="sandbox-preflight-title">
            <div className="sandbox-preflight-icon"><FolderIcon size={18} /></div>
            <div className="sandbox-preflight-copy">
              <strong id="sandbox-preflight-title">先确定项目沙箱</strong>
              <span>新会话创建后将固定绑定到该目录，过程中不可更换。</span>
            </div>
            <button type="button" className="sandbox-preflight-btn" onClick={onPrepareWorkspace}>
              选择项目目录
            </button>
          </section>
        ) : (
          <div
            className="double-deck-panel-card unified-agent-input-shell"
            data-action-state={isPermissionGateOpen ? "permission" : busy ? "running" : "composing"}
          >
            {isPermissionGateOpen ? (
              <ToolApprovalOverlay approval={pendingToolApproval!} onResolve={onResolveToolApproval!} />
            ) : (
              <>
                <div className="input-textarea-row">
                  <textarea
                    ref={textareaRef}
                    value={request}
                    onChange={(event) => {
                      onChangeRequest(event.target.value);
                      resizeTextarea(event.target);
                    }}
                    onKeyDown={handleKeyDown}
                    placeholder="描述你的目标或直接提出修改要求…"
                    readOnly={busy}
                    autoFocus
                    rows={layoutMode === "center" ? 3 : 2}
                    className={`input-textarea${busy ? " input-textarea--busy" : ""}`}
                    aria-label="向演示文稿 Agent 输入指令"
                  />
                </div>

                <div className="functional-control-bar">
                  <div className="functional-left">
                    <span className={`action-dock-status${busy ? " is-running" : ""}`}>
                      <span className="action-dock-status-dot" aria-hidden="true" />
                      {busy ? "Agent 正在执行" : `沙箱 · ${sandboxName?.trim() || "当前项目"}`}
                    </span>
                  </div>

                  <div className="functional-right">
                    <div
                      ref={modelMenuRef}
                      className={`model-tier-select-wrapper${modelMenuOpen ? " is-open" : ""}${busy || models.length === 0 ? " is-disabled" : ""}`}
                    >
                      <button
                        type="button"
                        className="mini-model-select"
                        disabled={busy || models.length === 0}
                        aria-haspopup="listbox"
                        aria-expanded={modelMenuOpen}
                        onClick={() => setModelMenuOpen((open) => !open)}
                      >
                        <span>{selectedModel?.name ?? "选择模型"}</span>
                        <ChevronDownIcon size={12} className="model-tier-select-icon" />
                      </button>

                      {modelMenuOpen && !busy && models.length > 0 ? (
                        <div className="model-tier-menu" role="listbox" aria-label="选择智能体模型">
                          {models.map((model) => {
                            const selected = model.id === selectedModelId;
                            return (
                              <button
                                key={model.id}
                                type="button"
                                role="option"
                                aria-selected={selected}
                                className={`model-tier-option${selected ? " is-selected" : ""}`}
                                onClick={() => {
                                  setSelectedModelId(model.id);
                                  setModelMenuOpen(false);
                                }}
                              >
                                <span className="model-tier-option-name">{model.name}</span>
                                {selected ? <CheckIcon size={13} className="model-tier-option-check" /> : null}
                              </button>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>

                    <button
                      type="button"
                      onClick={canCancelRun && onCancelRun ? onCancelRun : handleSend}
                      disabled={canCancelRun ? isCancellingRun : busy || !request.trim()}
                      className={canCancelRun ? "stop-cta-btn" : "send-cta-btn"}
                      aria-label={canCancelRun ? "中止当前 Agent 会话" : "发送指令"}
                      title={canCancelRun ? "中止当前 Agent 会话" : "发送指令"}
                    >
                      {canCancelRun ? <StopIcon size={14} /> : <SendIcon size={14} />}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
