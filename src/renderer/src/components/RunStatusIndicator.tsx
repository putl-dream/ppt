import type { AgentActivityItem } from "@shared/agent-activity";
import { type AgentRunPhase, deriveAgentRunPresentation } from "@shared/agent-run-presentation";
import type React from "react";
import { useEffect, useRef, useState } from "react";

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
      setElapsedSeconds(Math.max(0, Math.floor((Date.now() - startedAtRef.current) / 1_000)));
    };
    updateElapsed();
    const timer = window.setInterval(updateElapsed, 1_000);
    return () => window.clearInterval(timer);
  }, [startedAt]);

  return (
    <span className="run-status" role="status" aria-live="polite">
      <span
        className={[
          "loading-indicator",
          "loading-indicator--sm",
          presentation.animated ? "" : "loading-indicator--paused",
        ]
          .filter(Boolean)
          .join(" ")}
        aria-hidden="true"
      />
      <span
        className={[
          "run-status-label",
          presentation.animated ? "agent-run-status--shimmer" : "agent-run-status--paused",
        ].join(" ")}
      >
        {presentation.label}
      </span>
      {elapsedSeconds > 0 && <span className="run-status-elapsed">{elapsedSeconds} 秒</span>}
    </span>
  );
};
