import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { AgentActivityItem } from "@shared/agent-activity";
import { summarizeProcessTrace } from "@shared/agent-activity";
import { ChevronDownIcon, ChevronRightIcon } from "./Icons";
import { ProcessTraceItem } from "./ProcessTraceItem";
import { buildProcessTraceRows } from "./process-trace-rows";
import { useChatScroll, type FoldToken } from "./useChatScroll";

interface ProcessTracePanelProps {
  items: AgentActivityItem[];
  live?: boolean;
  startedAt?: number;
  defaultOpen?: boolean;
  defaultExpandRows?: boolean;
  collapseOnComplete?: boolean;
}

export const ProcessTracePanel: React.FC<ProcessTracePanelProps> = ({
  items,
  live = false,
  startedAt,
  defaultOpen = false,
  defaultExpandRows = false,
  collapseOnComplete = false,
}) => {
  const chatScroll = useChatScroll();
  const [open, setOpen] = useState(
    defaultOpen || live,
  );
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const wasLiveRef = useRef(live);
  const startedAtRef = useRef<number | null>(live ? (startedAt ?? Date.now()) : null);
  const headerRef = useRef<HTMLButtonElement>(null);
  const pendingFoldRef = useRef<FoldToken | null>(null);
  const openRef = useRef(open);
  openRef.current = open;

  const setOpenWithScroll = (nextOpen: boolean) => {
    // #region agent log
    fetch('http://127.0.0.1:7758/ingest/f715bfbd-c4b3-4d7c-91d3-b40633f1a70c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'482d6b'},body:JSON.stringify({sessionId:'482d6b',hypothesisId:'B',location:'ProcessTracePanel.tsx:setOpenWithScroll',message:'fold open change',data:{nextOpen,prevOpen:openRef.current,live,collapseOnComplete,itemCount:items.length,itemIds:items.map((i)=>i.id).slice(0,8)},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    pendingFoldRef.current = chatScroll.beginFold(headerRef.current);
    setOpen(nextOpen);
  };

  useLayoutEffect(() => {
    const pending = pendingFoldRef.current;
    if (!pending) return;
    pendingFoldRef.current = null;
    chatScroll.commitFold(pending);
  }, [chatScroll, open]);

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
    // #region agent log
    fetch('http://127.0.0.1:7758/ingest/f715bfbd-c4b3-4d7c-91d3-b40633f1a70c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'482d6b'},body:JSON.stringify({sessionId:'482d6b',runId:'post-fix',hypothesisId:'A',location:'ProcessTracePanel.tsx:liveEffect',message:'live effect tick',data:{live,wasLive,open:openRef.current,collapseOnComplete,startedAt,itemCount:items.length,kinds:items.map((i)=>i.kind),toolStatuses:items.filter((i)=>i.kind==='tool').map((i)=>({id:i.id,status:i.status})),reasoning:items.filter((i)=>i.kind==='reasoning').map((i)=>({id:i.id,streaming:i.streaming}))},timestamp:Date.now()})}).catch(()=>{});
    // #endregion

    if (live) {
      if (!wasLive) {
        if (startedAt !== undefined) startedAtRef.current = startedAt;
        // #region agent log
        fetch('http://127.0.0.1:7758/ingest/f715bfbd-c4b3-4d7c-91d3-b40633f1a70c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'482d6b'},body:JSON.stringify({sessionId:'482d6b',runId:'post-fix',hypothesisId:'A',location:'ProcessTracePanel.tsx:liveEdge',message:'became live -> open',data:{wasClosed:!openRef.current,itemCount:items.length},timestamp:Date.now()})}).catch(()=>{});
        // #endregion
        if (!openRef.current) {
          setOpenWithScroll(true);
        } else {
          setOpen(true);
        }
      }
      // While the run stays live, keep current open state (do not re-force).
    } else if (wasLive && collapseOnComplete && openRef.current) {
      // #region agent log
      fetch('http://127.0.0.1:7758/ingest/f715bfbd-c4b3-4d7c-91d3-b40633f1a70c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'482d6b'},body:JSON.stringify({sessionId:'482d6b',runId:'post-fix',hypothesisId:'A',location:'ProcessTracePanel.tsx:collapse',message:'live ended -> collapseOnComplete',data:{itemCount:items.length,toolStatuses:items.filter((i)=>i.kind==='tool').map((i)=>({id:i.id,status:i.status}))},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      setOpenWithScroll(false);
    }

    wasLiveRef.current = live;
  }, [collapseOnComplete, live, startedAt]);

  const rows = useMemo(() => buildProcessTraceRows(items, live), [items, live]);

  if (rows.length === 0 && !live) return null;

  const processSummary = summarizeProcessTrace(items);
  const headerLabel = live
    ? "执行过程"
    : elapsedSeconds > 0
      ? `已工作 ${elapsedSeconds} 秒`
      : processSummary;

  const handleHeaderClick = () => {
    if (live) return;
    setOpenWithScroll(!open);
  };

  return (
    <div className={`process-trace-panel${live ? " process-trace-panel--active" : ""}`}>
      <button
        ref={headerRef}
        type="button"
        className="process-trace-panel-header"
        onClick={handleHeaderClick}
        disabled={live}
        aria-expanded={open}
        aria-label={live ? "执行过程中保持展开" : (open ? "收起执行过程" : "展开执行过程")}
        title={processSummary}
      >
        <span className="process-trace-panel-header-left">
          <span className="process-trace-panel-label">
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
          {rows.map((row) => {
            // Live panel header is a neutral group label — don't nest a
            // second "思考中" title under it.
            const suppressThoughtTitle = live
              && row.kind === "thought"
              && Boolean(row.active);
            if (suppressThoughtTitle && !row.content?.trim()) {
              return null;
            }
            return (
              <div
                key={row.id}
                className="agent-run-block agent-run-block--activity"
                data-run-block-id={row.id}
                data-run-block-kind={row.kind}
              >
                <ProcessTraceItem
                  row={row}
                  defaultExpanded={
                    defaultExpandRows
                    || Boolean(row.active && row.kind !== "thought")
                    || suppressThoughtTitle
                  }
                  suppressTitle={suppressThoughtTitle}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
