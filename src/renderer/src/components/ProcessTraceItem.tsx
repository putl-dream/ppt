import React, { useEffect, useRef, useState } from "react";
import { ChevronDownIcon, ChevronRightIcon } from "./Icons";
import { MessageMarkdown } from "./MessageMarkdown";
import type { ProcessTraceRow } from "./process-trace-rows";

interface ProcessTraceItemProps {
  row: ProcessTraceRow;
  defaultExpanded?: boolean;
  /** Parent panel already shows the live status; render body only. */
  suppressTitle?: boolean;
}

export const ProcessTraceItem: React.FC<ProcessTraceItemProps> = ({
  row,
  defaultExpanded = false,
  suppressTitle = false,
}) => {
  const [expanded, setExpanded] = useState(defaultExpanded || suppressTitle);
  const liveBodyRef = useRef<HTMLDivElement>(null);
  const hasBody = Boolean(row.content?.trim() || (row.lines && row.lines.length > 0));
  const effectiveExpanded = hasBody && (suppressTitle || expanded);
  const CaretIcon = effectiveExpanded ? ChevronDownIcon : ChevronRightIcon;

  useEffect(() => {
    if (suppressTitle) {
      setExpanded(true);
      return;
    }
    if (row.kind === "thought" || defaultExpanded || !row.active) return;
    setExpanded(true);
  }, [defaultExpanded, row.active, row.kind, suppressTitle]);

  useEffect(() => {
    if (!suppressTitle || !row.streaming) return;
    const body = liveBodyRef.current;
    if (!body) return;
    body.scrollTop = body.scrollHeight;
  }, [row.content, row.streaming, suppressTitle]);

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

  if (suppressTitle) {
    if (!hasBody) return null;
    return (
      <div
        className={[
          "process-trace-row",
          `process-trace-row--${row.kind}`,
          "process-trace-row--content-only",
          row.active ? "process-trace-row--active" : "",
        ].filter(Boolean).join(" ")}
      >
        <div
          ref={liveBodyRef}
          className="process-trace-row-body process-trace-row-body--live"
        >
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
          {statusIndicator}
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
