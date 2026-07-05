import React, { useEffect, useMemo, useState } from "react";
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
  const [open, setOpen] = useState(isActive);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    if (isActive) {
      setOpen(true);
      setRevealed(false);
      return;
    }
    if (!live) {
      setOpen(false);
      setRevealed(false);
    }
  }, [isActive, live]);

  const rows = useMemo(() => buildProcessTraceRows(items, live), [items, live]);

  if (items.length === 0) return null;

  const headerLabel = isActive ? "思考与执行中…" : summarizeProcessTrace(items);

  const handleHeaderClick = () => {
    if (!open) {
      setOpen(true);
      setRevealed(true);
      return;
    }
    if (!revealed) {
      setRevealed(true);
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
        <div className={bodyClassName}>
          {rows.map((row) => (
            <ProcessTraceItem key={row.id} row={row} />
          ))}
        </div>
      )}
    </div>
  );
};
