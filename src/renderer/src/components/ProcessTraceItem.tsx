import React, { useEffect, useRef, useState } from "react";
import type { AgentToolDisplayCategory } from "@shared/agent-activity-display";
import {
  AlertTriangleIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CircleIcon,
  Edit3Icon,
  EyeIcon,
  FileIcon,
  SearchIcon,
  SlashCircleIcon,
  UsersIcon,
} from "./Icons";
import { MessageMarkdown } from "./MessageMarkdown";
import type { ProcessTraceRow } from "./process-trace-rows";

interface ProcessTraceItemProps {
  row: ProcessTraceRow;
  defaultExpanded?: boolean;
  /** Parent panel already shows the live status; render body only. */
  suppressTitle?: boolean;
}

type IconComponent = React.FC<{ size?: number; className?: string }>;

const TOOL_CATEGORY_ICONS: Record<AgentToolDisplayCategory, IconComponent> = {
  read: FileIcon,
  search: SearchIcon,
  inspect: EyeIcon,
  change: Edit3Icon,
  coordinate: UsersIcon,
  other: CircleIcon,
};

function renderStatusGlyph(status: NonNullable<ProcessTraceRow["status"]>) {
  if (status === "running") return <i />;
  if (status === "completed") {
    return <CheckIcon size={12} className="process-trace-row-status-glyph" />;
  }
  if (status === "denied") {
    return <SlashCircleIcon size={12} className="process-trace-row-status-glyph" />;
  }
  return <AlertTriangleIcon size={12} className="process-trace-row-status-glyph" />;
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
  const ToolCategoryIcon = row.toolCategory
    ? TOOL_CATEGORY_ICONS[row.toolCategory]
    : null;

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
      {renderStatusGlyph(row.status)}
    </span>
  ) : null;

  const toolCategoryIcon = ToolCategoryIcon && row.toolCategory ? (
    <span
      className={`process-trace-row-tool-icon process-trace-row-tool-icon--${row.toolCategory}`}
      aria-hidden="true"
    >
      <ToolCategoryIcon size={12} />
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
        row.kind === "tool" ? "process-trace-row--enter" : "",
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
          {toolCategoryIcon}
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
          {toolCategoryIcon}
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
