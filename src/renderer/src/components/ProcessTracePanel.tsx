import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { AgentActivityItem } from "@shared/agent-activity";
import { isProcessTraceActive, summarizeProcessTrace } from "@shared/agent-activity";
import { ChevronDownIcon, ChevronRightIcon } from "./Icons";
import { ProcessTraceItem } from "./ProcessTraceItem";
import { buildProcessTraceRows } from "./process-trace-rows";

interface ProcessTracePanelProps {
  items: AgentActivityItem[];
  live?: boolean;
}

export const ProcessTracePanel: React.FC<ProcessTracePanelProps> = ({
  items,
  live = false,
}) => {
  const isActive = live && isProcessTraceActive(items);
  const [open, setOpen] = useState(live && items.length > 0);
  const [revealed, setRevealed] = useState(false);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const userRevealedRef = useRef(false);
  const wasLiveRef = useRef(live);

  useEffect(() => {
    const wasLive = wasLiveRef.current;

    if (live) {
      if (!wasLive) {
        userRevealedRef.current = false;
        setRevealed(false);
      }
      setOpen(true);
    } else if (!userRevealedRef.current) {
      setOpen(false);
      setRevealed(false);
    }

    wasLiveRef.current = live;
  }, [live]);

  const rows = useMemo(() => buildProcessTraceRows(items, live), [items, live]);

  useLayoutEffect(() => {
    if (!open || revealed) return;
    const body = bodyRef.current;
    if (!body) return;
    body.scrollTop = body.scrollHeight;
  }, [open, revealed, rows]);

  if (items.length === 0) return null;

  const headerLabel = isActive ? "思考与执行中…" : summarizeProcessTrace(items);

  const revealPanel = useCallback(() => {
    userRevealedRef.current = true;
    setOpen(true);
    setRevealed(true);
  }, []);

  const handleHeaderClick = () => {
    if (!open || !revealed) {
      revealPanel();
      return;
    }

    setOpen(false);
    setRevealed(false);
  };

  const bodyClassName = [
    "process-trace-panel-body",
    revealed ? "process-trace-panel-body--revealed" : "process-trace-panel-body--preview",
  ].join(" ");

  return (
    <div className={`process-trace-panel${isActive ? " process-trace-panel--active" : ""}`}>
      <button
        type="button"
        className="process-trace-panel-header"
        onClick={handleHeaderClick}
        aria-expanded={open && revealed}
      >
        <span className="process-trace-panel-header-left">
          {isActive && <span className="step-spinner" aria-hidden="true" />}
          <span className="process-trace-panel-label">{headerLabel}</span>
        </span>
        {open && revealed ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />}
      </button>
      {open && (
        <div ref={bodyRef} className={bodyClassName}>
          {rows.map((row) => (
            <ProcessTraceItem
              key={row.id}
              row={row}
              defaultExpanded
              panelRevealed={revealed}
              onRequestPanelReveal={revealPanel}
            />
          ))}
        </div>
      )}
    </div>
  );
};
