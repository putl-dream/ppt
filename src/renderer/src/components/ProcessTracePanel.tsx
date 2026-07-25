import React, { useEffect, useMemo, useRef, useState } from "react";
import type { AgentActivityItem } from "@shared/agent-activity";
import { summarizeProcessTrace } from "@shared/agent-activity";
import { ChevronDownIcon, ChevronRightIcon } from "./Icons";
import { ProcessTraceItem } from "./ProcessTraceItem";
import { buildProcessTraceRows } from "./process-trace-rows";
import {
  deriveAgentRunPresentation,
  type AgentRunPhase,
} from "../agentRunPresentation";

interface ProcessTracePanelProps {
  items: AgentActivityItem[];
  live?: boolean;
  phase?: AgentRunPhase;
  startedAt?: number;
  defaultOpen?: boolean;
  defaultExpandRows?: boolean;
}

export const ProcessTracePanel: React.FC<ProcessTracePanelProps> = ({
  items,
  live = false,
  phase = "idle",
  startedAt,
  defaultOpen = false,
  defaultExpandRows = false,
}) => {
  const [open, setOpen] = useState(
    defaultOpen || live,
  );
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const wasLiveRef = useRef(live);
  const startedAtRef = useRef<number | null>(live ? (startedAt ?? Date.now()) : null);

  useEffect(() => {
    if (!live) {
      if (startedAtRef.current !== null) {
        setElapsedSeconds(Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1_000)));
      }
      return;
    }

    if (startedAt !== undefined) {
      startedAtRef.current = startedAt;
    } else if (startedAtRef.current === null) {
      startedAtRef.current = Date.now();
    }
    const updateElapsed = () => {
      if (startedAtRef.current === null) return;
      setElapsedSeconds(Math.max(0, Math.floor((Date.now() - startedAtRef.current) / 1_000)));
    };
    updateElapsed();
    const timer = window.setInterval(updateElapsed, 1_000);
    return () => window.clearInterval(timer);
  }, [live, startedAt]);

  useEffect(() => {
    const wasLive = wasLiveRef.current;

    if (live) {
      if (!wasLive) {
        if (startedAt !== undefined) startedAtRef.current = startedAt;
      }
      setOpen(true);
    }

    wasLiveRef.current = live;
  }, [live, startedAt]);

  const rows = useMemo(() => buildProcessTraceRows(items, live), [items, live]);
  const hasRunningToolRow = rows.some((row) => row.status === "running");

  if (rows.length === 0 && !live) return null;

  const processSummary = summarizeProcessTrace(items);
  const runPresentation = deriveAgentRunPresentation(phase, items);
  const headerLabel = live
    ? runPresentation.label
    : elapsedSeconds > 0
      ? `已工作 ${elapsedSeconds} 秒`
      : processSummary;

  const handleHeaderClick = () => {
    if (live) return;
    setOpen((value) => !value);
  };

  return (
    <div className={`process-trace-panel${live ? " process-trace-panel--active" : ""}`}>
      <button
        type="button"
        className="process-trace-panel-header"
        onClick={handleHeaderClick}
        disabled={live}
        aria-expanded={open}
        aria-label={live ? "执行过程中保持展开" : (open ? "收起执行过程" : "展开执行过程")}
        title={processSummary}
      >
        <span className="process-trace-panel-header-left">
          {live && !hasRunningToolRow && (
            <span
              className={[
                "agent-run-loader",
                runPresentation.animated ? "agent-run-loader--active" : "agent-run-loader--paused",
              ].join(" ")}
              aria-hidden="true"
            >
              <i />
            </span>
          )}
          <span className="process-trace-panel-label" role="status" aria-live="polite">
            {headerLabel}
          </span>
          {live && elapsedSeconds > 0 && (
            <span className="process-trace-panel-elapsed">{elapsedSeconds} 秒</span>
          )}
          <span className="process-trace-panel-caret" aria-hidden="true">
            {open ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />}
          </span>
        </span>
      </button>
      {open && (
        <div className="process-trace-panel-body">
          {rows.map((row) => (
            <ProcessTraceItem
              key={row.id}
              row={row}
              defaultExpanded={defaultExpandRows || Boolean(row.active && row.kind !== "thought")}
            />
          ))}
        </div>
      )}
    </div>
  );
};
