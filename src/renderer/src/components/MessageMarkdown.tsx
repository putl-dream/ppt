import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface MessageMarkdownProps {
  content: string;
  className?: string;
}

export const MessageMarkdown: React.FC<MessageMarkdownProps> = ({
  content,
  className,
}) => {
  if (!content.trim()) return null;

  return (
    <div className={`markdown-body${className ? ` ${className}` : ""}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
};
