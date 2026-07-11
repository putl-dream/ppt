import React, { useEffect, useMemo, useRef, useState } from "react";
import type { AgentActivityItem } from "@shared/agent-activity";
import { summarizeProcessTrace } from "@shared/agent-activity";
import { ChevronDownIcon, ChevronRightIcon } from "./Icons";
import { MessageMarkdown } from "./MessageMarkdown";
import { ProcessTraceItem } from "./ProcessTraceItem";
import { buildProcessTraceRows } from "./process-trace-rows";

interface ProcessTracePanelProps {
  items: AgentActivityItem[];
  live?: boolean;
  liveContent?: string;
}

export const ProcessTracePanel: React.FC<ProcessTracePanelProps> = ({
  items,
  live = false,
  liveContent = "",
}) => {
  const [open, setOpen] = useState(live && (items.length > 0 || Boolean(liveContent.trim())));
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const wasLiveRef = useRef(live);
  const startedAtRef = useRef<number | null>(live ? Date.now() : null);

  useEffect(() => {
    if (!live) {
      if (startedAtRef.current !== null) {
        setElapsedSeconds(Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1_000)));
      }
      return;
    }

    if (startedAtRef.current === null) startedAtRef.current = Date.now();
    const updateElapsed = () => {
      if (startedAtRef.current === null) return;
      setElapsedSeconds(Math.max(0, Math.floor((Date.now() - startedAtRef.current) / 1_000)));
    };
    updateElapsed();
    const timer = window.setInterval(updateElapsed, 1_000);
    return () => window.clearInterval(timer);
  }, [live]);

  useEffect(() => {
    const wasLive = wasLiveRef.current;

    if (live) {
      if (!wasLive) {
        startedAtRef.current = Date.now();
        setElapsedSeconds(0);
      }
      setOpen(true);
    } else if (wasLive) {
      setOpen(false);
    }

    wasLiveRef.current = live;
  }, [live]);

  const rows = useMemo(() => buildProcessTraceRows(items, live), [items, live]);

  if (rows.length === 0 && !liveContent.trim()) return null;

  const processSummary = summarizeProcessTrace(items);
  const headerLabel = elapsedSeconds > 0
    ? `已工作 ${elapsedSeconds} 秒`
    : (live ? "正在工作" : processSummary);

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
          <span className="process-trace-panel-label">{headerLabel}</span>
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
              defaultExpanded={Boolean(row.active && row.kind !== "thought")}
            />
          ))}
          {liveContent.trim() && (
            <MessageMarkdown
              content={liveContent}
              className="assistant-response process-trace-live-content"
            />
          )}
        </div>
      )}
    </div>
  );
};
