import React, { useEffect, useState } from "react";
import { ChevronDownIcon, ChevronRightIcon } from "./Icons";
import { MessageMarkdown } from "./MessageMarkdown";
import type { ProcessTraceRow } from "./process-trace-rows";

interface ProcessTraceItemProps {
  row: ProcessTraceRow;
  defaultExpanded?: boolean;
}

export const ProcessTraceItem: React.FC<ProcessTraceItemProps> = ({
  row,
  defaultExpanded = false,
}) => {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const hasBody = Boolean(row.content?.trim() || (row.lines && row.lines.length > 0));
  const effectiveExpanded = hasBody && expanded;
  const CaretIcon = effectiveExpanded ? ChevronDownIcon : ChevronRightIcon;

  useEffect(() => {
    if (row.kind === "thought") return;
    setExpanded(Boolean(row.active));
  }, [row.active, row.kind]);

  if (row.kind === "progress") {
    return (
      <div className={`process-trace-row process-trace-row--progress${row.active ? " process-trace-row--active" : ""}`}>
        <MessageMarkdown
          content={row.title}
          className="assistant-response process-trace-progress-content"
        />
      </div>
    );
  }

  return (
    <div className={`process-trace-row process-trace-row--${row.kind}${row.active ? " process-trace-row--active" : ""}`}>
      <div className="process-trace-row-title">
        {hasBody ? (
          <button
            type="button"
            className="process-trace-row-toggle"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={effectiveExpanded}
            aria-label={effectiveExpanded ? `收起${row.title}` : `展开${row.title}`}
          >
            <CaretIcon size={12} />
          </button>
        ) : (
          <span className="process-trace-row-caret" aria-hidden="true" />
        )}
        <span className="process-trace-row-label">{row.title}</span>
      </div>
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
