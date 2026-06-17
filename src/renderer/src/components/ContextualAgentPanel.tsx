import React, { useState, useRef, useEffect } from "react";
import { useProjectStore, ArtifactId } from "./project-store";
import { BrainIcon, ChevronDownIcon, ChevronRightIcon } from "./Icons";
import { UnifiedAgentInput } from "./UnifiedAgentInput";
import type { ManagedModel } from "../modelCatalog";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  thought?: string[];
  progress?: number;
  outlineRequest?: any;
  approval?: any;
}

interface ContextualAgentPanelProps {
  chatMessages: ChatMessage[];
  thoughtProcess: string[];
  thoughtProgress: number;
  agentActivityMode: "idle" | "request" | "workflow";
  request: string;
  onChangeRequest: (val: string) => void;
  onSubmitRequest: () => void;
  busy: boolean;
  onConfirmOutline: () => void;
  onResolveApproval: (approved: boolean) => void;
  
  models: ManagedModel[];
  selectedModelId: string;
  setSelectedModelId: (val: string) => void;
  executionStrategy: "REQUEST_APPROVAL" | "AUTO";
  setExecutionStrategy: (val: "REQUEST_APPROVAL" | "AUTO") => void;
  localStoragePath: string;
  setLocalStoragePath: (val: string) => void;
  triggerToast: (msg: string) => void;
  onUpdateMessageContent: (msgId: string, newContent: string) => void;
  selectedSlideIndex: number | null;
  onClearContextTag: () => void;
}

const PLACEHOLDER_MAP: Record<ArtifactId, string> = {
  brief: "帮我丰富听众画像，或者调整汇报目的...",
  outline: "章节逻辑不对，帮我在第三章后插入一页市场分析...",
  research: "帮我整理该行业最近一年的市场增长率数据...",
  design: "帮我换个更有科技感的主题风格，配合亮绿的强调色...",
  slides: "把第五页的内容精简到三句话内，并引用 Research 里的数据...",
  deck: "为第2页添加图表元素，并将全篇色调进行微调...",
};

const STAGE_NAME_MAP: Record<ArtifactId, string> = {
  brief: "目的与听众 (Brief)",
  outline: "内容大纲 (Outline)",
  research: "资料收集 (Research)",
  design: "设计系统 (Design)",
  slides: "逐页方案 (Slides Plan)",
  deck: "PPT 预览与导出 (Deck)",
};

export const ContextualAgentPanel: React.FC<ContextualAgentPanelProps> = ({
  chatMessages,
  thoughtProcess,
  thoughtProgress,
  agentActivityMode,
  request,
  onChangeRequest,
  onSubmitRequest,
  busy,
  onConfirmOutline,
  onResolveApproval,
  models,
  selectedModelId,
  setSelectedModelId,
  executionStrategy,
  setExecutionStrategy,
  localStoragePath,
  setLocalStoragePath,
  triggerToast,
  onUpdateMessageContent,
  selectedSlideIndex,
  onClearContextTag,
}) => {
  const currentStage = useProjectStore((state) => state.currentStage);
  const activeProject = useProjectStore((state) => state.activeProject);
  
  const [showThought, setShowThought] = useState(true);
  const [editingMsgId, setEditingMsgId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages, thoughtProcess, thoughtProgress, busy]);

  const activeStageArtifact = activeProject?.artifacts[currentStage];
  const isStale = activeStageArtifact?.status === "stale";

  const placeholder = PLACEHOLDER_MAP[currentStage] || "向 AI 助手发送指令...";

  // Start editing message
  const handleStartEdit = (msgId: string, currentText: string) => {
    setEditingMsgId(msgId);
    setEditingText(currentText);
  };

  // Save edits back into the chat block content
  const handleSaveEdit = (msgId: string) => {
    onUpdateMessageContent(msgId, editingText);
    setEditingMsgId(null);
  };

  return (
    <aside className="right-panel contextual-agent-panel" style={{
      width: "380px",
      display: "flex",
      flexDirection: "column",
      background: "var(--bg-app)",
      borderLeft: "1px solid var(--border-glass)",
      height: "100%"
    }}>
      {/* 顶部 Context 提醒栏 */}
      <div className="agent-context-header" style={{
        padding: "16px 20px",
        borderBottom: "1px solid var(--border-glass)",
        background: "rgba(255, 255, 255, 0.01)"
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span className="eyebrow" style={{ fontSize: "10px", color: "var(--text-muted)", margin: 0 }}>CONTEXT AGENT</span>
          <span style={{
            fontSize: "11px",
            background: "var(--border-glass-focused)",
            color: "var(--accent-cyan)",
            padding: "2px 8px",
            borderRadius: "12px",
            fontWeight: 600
          }}>
            聚焦: {STAGE_NAME_MAP[currentStage]}
          </span>
        </div>

        {isStale && (
          <div className="stale-warning-banner" style={{
            marginTop: "10px",
            background: "rgba(245, 158, 11, 0.08)",
            border: "1px solid rgba(245, 158, 11, 0.2)",
            borderRadius: "8px",
            padding: "8px 12px",
            fontSize: "12px",
            color: "#f59e0b",
            display: "flex",
            alignItems: "center",
            gap: "8px"
          }}>
            <span style={{ fontSize: "14px" }}>⚠️</span>
            <span>检测到上游发生变更，本阶段产物已过期。建议重新生成。</span>
          </div>
        )}
      </div>

      {/* 消息对话列表 */}
      <div className="chat-stream flex-1" style={{
        padding: "20px",
        overflowY: "auto",
        display: "flex",
        flexDirection: "column",
        gap: "16px"
      }}>
        {chatMessages.map((msg) => (
          <div key={msg.id} className={`chat-message ${msg.role}`} style={{ display: "flex", gap: "10px" }}>
            <div className="chat-avatar" style={{
              width: "28px",
              height: "28px",
              borderRadius: "50%",
              background: msg.role === "user" ? "var(--border-glass-focused)" : "var(--accent-cyan)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "11px",
              fontWeight: 600,
              color: "#fff"
            }}>
              {msg.role === "user" ? "U" : <BrainIcon size={12} />}
            </div>
            
            <div className="chat-bubble-content" style={{ flex: 1 }}>
              <div className="chat-bubble-text" style={{
                background: msg.role === "user" ? "var(--border-glass-focused)" : "rgba(255, 255, 255, 0.02)",
                border: "1px solid var(--border-glass)",
                borderRadius: "12px",
                padding: "10px 14px",
                fontSize: "13px",
                lineHeight: "1.5",
                color: "var(--text-primary)"
              }}>
                {editingMsgId === msg.id ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    <textarea
                      value={editingText}
                      onChange={(e) => setEditingText(e.target.value)}
                      style={{
                        width: "100%",
                        background: "var(--bg-darker)",
                        border: "1px solid var(--border-glass-focused)",
                        borderRadius: "4px",
                        color: "var(--text-primary)",
                        fontSize: "13px",
                        padding: "6px",
                        resize: "none",
                        outline: "none"
                      }}
                    />
                    <div style={{ display: "flex", justifyContent: "flex-end", gap: "6px" }}>
                      <button onClick={() => setEditingMsgId(null)} className="secondary-btn" style={{ padding: "2px 8px", fontSize: "11px" }}>取消</button>
                      <button onClick={() => handleSaveEdit(msg.id)} className="primary-btn" style={{ padding: "2px 8px", fontSize: "11px", background: "var(--accent-cyan)", border: "none", color: "#fff", borderRadius: "4px" }}>保存</button>
                    </div>
                  </div>
                ) : (
                  msg.content
                )}
              </div>

              {msg.role === "user" && editingMsgId !== msg.id && (
                <button
                  onClick={() => handleStartEdit(msg.id, msg.content)}
                  style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: "11px", marginTop: "4px" }}
                >
                  ✏️ 编辑并重发
                </button>
              )}

              {/* Accordion for agent thoughts */}
              {msg.thought && msg.thought.length > 0 && (
                <div style={{ marginTop: "8px" }}>
                  <div
                    onClick={() => setShowThought(!showThought)}
                    style={{ fontSize: "11px", color: "var(--text-muted)", cursor: "pointer", display: "flex", alignItems: "center", gap: "4px" }}
                  >
                    <span>推理轨迹</span>
                    {showThought ? <ChevronDownIcon size={10} /> : <ChevronRightIcon size={10} />}
                  </div>
                  {showThought && (
                    <ul style={{ margin: "4px 0 0 0", paddingLeft: "16px", fontSize: "11px", color: "var(--text-muted)", listStyle: "disc" }}>
                      {msg.thought.map((t, idx) => <li key={idx}>{t}</li>)}
                    </ul>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}

        {busy && thoughtProcess.length > 0 && (
          <div className="chat-message assistant active-thinking" style={{ display: "flex", gap: "10px" }}>
            <div className="chat-avatar animate-pulse" style={{ width: "28px", height: "28px", borderRadius: "50%", background: "var(--accent-cyan)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <BrainIcon size={12} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ background: "rgba(255, 255, 255, 0.02)", border: "1px solid var(--border-glass)", borderRadius: "12px", padding: "10px 14px", fontSize: "13px", color: "var(--text-primary)" }}>
                {agentActivityMode === "request" ? thoughtProcess.at(-1) : "AI 正在编排方案..."}
              </div>
              <div style={{ marginTop: "8px", height: "4px", background: "var(--border-glass)", borderRadius: "2px", overflow: "hidden" }}>
                <div style={{ width: `${thoughtProgress}%`, height: "100%", background: "var(--accent-cyan)", transition: "width 0.2s ease" }} />
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* 底部输入框与配置项 */}
      <div className="agent-input-footer" style={{
        padding: "16px 20px",
        borderTop: "1px solid var(--border-glass)",
        background: "rgba(255, 255, 255, 0.01)"
      }}>
        <UnifiedAgentInput
          request={request}
          onChangeRequest={onChangeRequest}
          onSubmitRequest={onSubmitRequest}
          busy={busy}
          models={models}
          selectedModelId={selectedModelId}
          setSelectedModelId={setSelectedModelId}
          executionStrategy={executionStrategy}
          setExecutionStrategy={setExecutionStrategy}
          localStoragePath={localStoragePath}
          setLocalStoragePath={setLocalStoragePath}
          layoutMode="bottom"
          triggerToast={triggerToast}
          placeholder={placeholder}
          submitLabel="生成"
          selectedSlideIndex={selectedSlideIndex}
          onClearContextTag={onClearContextTag}
        />
      </div>
    </aside>
  );
};
