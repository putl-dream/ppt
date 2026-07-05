import React, { useState } from "react";
import { ChevronDownIcon, ChevronRightIcon } from "./Icons";
import type { ProcessTraceRow } from "./process-trace-rows";

interface ProcessTraceItemProps {
  row: ProcessTraceRow;
  defaultExpanded?: boolean;
  panelRevealed?: boolean;
  onRequestPanelReveal?: () => void;
}

export const ProcessTraceItem: React.FC<ProcessTraceItemProps> = ({
  row,
  defaultExpanded = false,
  panelRevealed = true,
  onRequestPanelReveal,
}) => {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const hasBody = Boolean(row.content?.trim() || (row.lines && row.lines.length > 0));
  const effectiveExpanded = hasBody && expanded;
  const CaretIcon = effectiveExpanded ? ChevronDownIcon : ChevronRightIcon;

  const handleTitleClick = () => {
    if (!hasBody) return;
    if (!panelRevealed) {
      onRequestPanelReveal?.();
      return;
    }
    setExpanded((value) => !value);
  };

  return (
    <div className={`process-trace-row${row.active ? " process-trace-row--active" : ""}`}>
      <button
        type="button"
        className="process-trace-row-title"
        onClick={handleTitleClick}
        aria-expanded={effectiveExpanded}
        aria-label={effectiveExpanded ? `收起${row.title}` : `展开${row.title}`}
        disabled={!hasBody}
      >
        {row.active && <span className="step-spinner" aria-hidden="true" />}
        <span className="process-trace-row-caret" aria-hidden="true">
          <CaretIcon size={12} />
        </span>
        <span className="process-trace-row-label">{row.title}</span>
      </button>
      {effectiveExpanded && (
        <div className="process-trace-row-body">
          {row.content !== undefined && (
            <pre className="process-trace-row-text">
              {row.content}
              {row.streaming && <span className="reasoning-cursor" aria-hidden="true" />}
            </pre>
          )}
          {row.lines?.map((line, index) => (
            <div key={index} className="process-trace-row-line">{line}</div>
          ))}
        </div>
      )}
    </div>
  );
};
