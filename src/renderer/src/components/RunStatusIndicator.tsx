import React, { useEffect, useRef, useState } from "react";
import type { AgentActivityItem } from "@shared/agent-activity";
import {
  deriveAgentRunPresentation,
  type AgentRunPhase,
} from "../agentRunPresentation";

interface RunStatusIndicatorProps {
  phase: AgentRunPhase;
  activityTrace: AgentActivityItem[];
  startedAt?: number;
}

export const RunStatusIndicator: React.FC<RunStatusIndicatorProps> = ({
  phase,
  activityTrace,
  startedAt,
}) => {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const startedAtRef = useRef(startedAt ?? Date.now());
  const presentation = deriveAgentRunPresentation(phase, activityTrace);

  useEffect(() => {
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
  }, [startedAt]);

  return (
    <span className="run-status" role="status" aria-live="polite">
      <span
        className={`run-glyph${presentation.animated ? "" : " run-glyph--paused"}`}
        aria-hidden="true"
      >
        <svg viewBox="0 0 16 16" width="14" height="14">
          <circle cx="8" cy="8" r="6" />
          <circle cx="8" cy="8" r="6" />
        </svg>
      </span>
      <span
        className={[
          "run-status-label",
          presentation.animated ? "agent-run-status--shimmer" : "agent-run-status--paused",
        ].join(" ")}
      >
        {presentation.label}
      </span>
      {elapsedSeconds > 0 && (
        <span className="run-status-elapsed">{elapsedSeconds} 秒</span>
      )}
    </span>
  );
};
