import React, { useState } from "react";
import type { ProcessTraceRow } from "./process-trace-rows";

interface ProcessTraceItemProps {
  row: ProcessTraceRow;
}

export const ProcessTraceItem: React.FC<ProcessTraceItemProps> = ({ row }) => {
  const [expanded, setExpanded] = useState(false);
  const hasBody = Boolean(row.content?.trim() || (row.lines && row.lines.length > 0));

  return (
    <div className={`process-trace-row${row.active ? " process-trace-row--active" : ""}`}>
      <button
        type="button"
        className="process-trace-row-title"
        onClick={() => hasBody && setExpanded((value) => !value)}
        aria-expanded={expanded}
        disabled={!hasBody}
      >
        {row.active && <span className="step-spinner" aria-hidden="true" />}
        <span className="process-trace-row-caret" aria-hidden="true">
          {expanded ? "v" : ">"}
        </span>
        <span className="process-trace-row-label">{row.title}</span>
      </button>
      {expanded && hasBody && (
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
