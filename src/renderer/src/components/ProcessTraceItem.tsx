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
    if (row.kind === "thought" || defaultExpanded || !row.active) return;
    setExpanded(true);
  }, [defaultExpanded, row.active, row.kind]);

  const toggleExpanded = () => setExpanded((value) => !value);

  const statusIndicator = row.status ? (
    <span
      className={`process-trace-row-status process-trace-row-status--${row.status}`}
      aria-hidden="true"
    >
      {row.status === "running" ? <i /> : row.status === "completed" ? "✓" : "!"}
    </span>
  ) : null;

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
    <div
      className={[
        "process-trace-row",
        `process-trace-row--${row.kind}`,
        row.active ? "process-trace-row--active" : "",
        row.status ? `process-trace-row--status-${row.status}` : "",
      ].filter(Boolean).join(" ")}
    >
      {hasBody ? (
        <button
          type="button"
          className="process-trace-row-title process-trace-row-title--interactive"
          onClick={toggleExpanded}
          aria-expanded={effectiveExpanded}
        >
          <span className="process-trace-row-toggle" aria-hidden="true">
            <CaretIcon size={12} />
          </span>
          <span className="process-trace-row-label">{row.title}</span>
        </button>
      ) : (
        <div className="process-trace-row-title">
          {statusIndicator ?? (
            <span className="process-trace-row-caret" aria-hidden="true" />
          )}
          <span className="process-trace-row-label">{row.title}</span>
        </div>
      )}
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
