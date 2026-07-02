import React, { useCallback, useEffect, useState } from "react";
import type { DeckGenerationStatus } from "@shared/ipc";
import type { AgentModelSettings } from "@shared/agent";

interface DeckGenerationPanelProps {
  sessionId: string | undefined;
  busy: boolean;
  executionStrategy: "REQUEST_APPROVAL" | "AUTO";
  modelSettings?: AgentModelSettings;
  onRefreshPresentation: () => Promise<void>;
  triggerToast: (message: string) => void;
}

export const DeckGenerationPanel: React.FC<DeckGenerationPanelProps> = ({
  sessionId,
  busy,
  executionStrategy,
  modelSettings,
  onRefreshPresentation,
  triggerToast,
}) => {
  const [status, setStatus] = useState<DeckGenerationStatus | null>(null);
  const [loading, setLoading] = useState(false);

  const refreshStatus = useCallback(async () => {
    if (!sessionId) return;
    const next = await window.desktopApi.getDeckGenerationStatus(sessionId);
    setStatus(next);
  }, [sessionId]);

  useEffect(() => {
    void refreshStatus();
    const timer = window.setInterval(() => {
      void refreshStatus();
    }, 4000);
    return () => window.clearInterval(timer);
  }, [refreshStatus]);

  const handleResume = async () => {
    if (!sessionId || !status?.job) return;
    setLoading(true);
    try {
      await window.desktopApi.resumeDeckGeneration(
        sessionId,
        status.job.id,
        modelSettings,
        executionStrategy,
      );
      await onRefreshPresentation();
      await refreshStatus();
      triggerToast("已继续 deck 分批生成任务");
    } catch (error) {
      triggerToast(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  if (!sessionId || !status?.job) return null;

  const { job, doneSlides, pendingSlides, failedSlides, storyboard } = status;
  const progress = job.totalBatches > 0 ? Math.round((job.completedBatches / job.totalBatches) * 100) : 0;
  const canResume = !busy && !loading && (job.status === "paused" || job.status === "failed");

  return (
    <div
      style={{
        margin: "12px 16px 0",
        padding: "14px 16px",
        borderRadius: "12px",
        border: "1px solid var(--border-glass)",
        background: "rgba(255,255,255,0.02)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px" }}>
        <div>
          <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-primary)" }}>
            Deck 分批生成进度
          </div>
          <div style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "4px" }}>
            状态：{job.status} · 批次 {job.completedBatches}/{job.totalBatches} · 页面 done/pending/failed = {doneSlides}/{pendingSlides}/{failedSlides}
          </div>
        </div>
        {canResume && (
          <button
            className="secondary-btn"
            onClick={() => void handleResume()}
            style={{ padding: "8px 14px", borderRadius: "8px", fontSize: "12px", cursor: "pointer" }}
          >
            继续 / 重试
          </button>
        )}
      </div>

      <div
        style={{
          marginTop: "10px",
          height: "8px",
          borderRadius: "999px",
          background: "var(--bg-darker)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${progress}%`,
            height: "100%",
            background: "var(--accent-cyan)",
            transition: "width 0.3s ease",
          }}
        />
      </div>

      {job.errors && job.errors.length > 0 && (
        <div style={{ marginTop: "10px", fontSize: "12px", color: "#ef4444" }}>
          最近错误：{job.errors[job.errors.length - 1]?.message}
        </div>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "10px" }}>
        {storyboard.map((slide, index) => (
          <span
            key={slide.id}
            style={{
              fontSize: "11px",
              padding: "4px 8px",
              borderRadius: "999px",
              border: "1px solid var(--border-glass)",
              color:
                slide.status === "done"
                  ? "#10b981"
                  : slide.status === "failed"
                  ? "#ef4444"
                  : slide.status === "generating"
                  ? "#0ea5e9"
                  : "var(--text-muted)",
            }}
          >
            {index + 1}. {slide.title} ({slide.status ?? "pending"})
          </span>
        ))}
      </div>
    </div>
  );
};
