import React, { useEffect, useState } from "react";
import { ChevronDownIcon, ChevronRightIcon } from "./Icons";

interface ReasoningBlockProps {
  content: string;
  /** 流式思考中默认展开，结束后默认折叠 */
  defaultExpanded?: boolean;
  isStreaming?: boolean;
}

export const ReasoningBlock: React.FC<ReasoningBlockProps> = ({
  content,
  defaultExpanded = false,
  isStreaming = false,
}) => {
  const [expanded, setExpanded] = useState(defaultExpanded || isStreaming);

  useEffect(() => {
    if (isStreaming) {
      setExpanded(true);
    } else if (!defaultExpanded) {
      setExpanded(false);
    }
  }, [isStreaming, defaultExpanded]);

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
          {isStreaming ? "思考中" : "思考过程"}
        </span>
        {expanded ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />}
      </button>
      {expanded && (
        <div className="reasoning-block-body">
          <pre className="reasoning-block-text">{content}</pre>
          {isStreaming && <span className="reasoning-cursor" aria-hidden="true" />}
        </div>
      )}
    </div>
  );
};
