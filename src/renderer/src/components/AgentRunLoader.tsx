import React, { useEffect, useRef, useState } from "react";
import type { AgentActivityItem } from "@shared/agent-activity";
import {
  deriveAgentRunPresentation,
  type AgentRunPhase,
} from "../agentRunPresentation";

interface AgentRunLoaderProps {
  busy: boolean;
  phase: AgentRunPhase;
  activityTrace: AgentActivityItem[];
  startedAt?: number;
}

export const AgentRunLoader: React.FC<AgentRunLoaderProps> = ({
  busy,
  phase,
  activityTrace,
  startedAt,
}) => {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const startedAtRef = useRef(startedAt ?? Date.now());
  const hasRunningTool = phase === "tool" && activityTrace.some(
    (item) => item.kind === "tool" && item.status === "running",
  );
  const visible = busy && phase !== "responding" && !hasRunningTool;

  useEffect(() => {
    if (!visible) return;
    if (startedAt !== undefined) startedAtRef.current = startedAt;
    const updateElapsed = () => {
      setElapsedSeconds(Math.max(
        0,
        Math.floor((Date.now() - startedAtRef.current) / 1_000),
      ));
    };
    updateElapsed();
    const timer = window.setInterval(updateElapsed, 1_000);
    return () => window.clearInterval(timer);
  }, [startedAt, visible]);

  if (!visible) return null;

  const presentation = deriveAgentRunPresentation(phase, activityTrace);

  return (
    <div
      className="chat-message assistant agent-run-tail"
      data-run-tail-status={phase}
    >
      <div className="agent-run-tail-status" role="status" aria-live="polite">
        <span
          className={[
            "agent-run-loader",
            presentation.animated
              ? "agent-run-loader--active"
              : "agent-run-loader--paused",
          ].join(" ")}
          aria-hidden="true"
        >
          <i />
        </span>
        <span className="agent-run-tail-label">{presentation.label}</span>
        {elapsedSeconds > 0 && (
          <span className="agent-run-tail-elapsed">{elapsedSeconds} 秒</span>
        )}
      </div>
    </div>
  );
};
