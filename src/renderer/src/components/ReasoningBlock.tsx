import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronDownIcon, ChevronRightIcon } from "./Icons";

interface ReasoningBlockProps {
  content: string;
  /** 流式思考中默认展开，结束后默认折叠 */
  defaultExpanded?: boolean;
  isStreaming?: boolean;
  label?: string;
}

export const ReasoningBlock: React.FC<ReasoningBlockProps> = ({
  content,
  defaultExpanded = false,
  isStreaming = false,
  label,
}) => {
  const [expanded, setExpanded] = useState(defaultExpanded || isStreaming);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isStreaming) {
      setExpanded(true);
    } else if (!defaultExpanded) {
      setExpanded(false);
    }
  }, [isStreaming, defaultExpanded]);

  const scrollToBottom = useCallback(() => {
    const scrollEl = scrollRef.current;
    if (!scrollEl) return;
    scrollEl.scrollTop = scrollEl.scrollHeight;
  }, []);

  useLayoutEffect(() => {
    if (!isStreaming || !expanded) return;
    scrollToBottom();
  }, [content, isStreaming, expanded, scrollToBottom]);

  useEffect(() => {
    if (!isStreaming || !expanded) return;
    const scrollEl = scrollRef.current;
    const contentEl = scrollEl?.firstElementChild;
    if (!scrollEl || !contentEl) return;

    const observer = new ResizeObserver(() => {
      scrollToBottom();
    });
    observer.observe(contentEl);
    return () => observer.disconnect();
  }, [isStreaming, expanded, scrollToBottom]);

  if (!content.trim()) return null;

  return (
    <div className={`reasoning-block${isStreaming ? " reasoning-block--streaming" : ""}`}>
      <button
        type="button"
        className="reasoning-block-header"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
      >
        <span className="reasoning-block-label">
          {label ?? (isStreaming ? "思考中" : "思考过程")}
        </span>
        {expanded ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />}
      </button>
      {expanded && (
        <div className="reasoning-block-body">
          <div ref={scrollRef} className="reasoning-block-scroll">
            <pre className="reasoning-block-text">
              {content}
              {isStreaming && <span className="reasoning-cursor" aria-hidden="true" />}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
};
