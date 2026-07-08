import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { getOpenExportFolderPath } from "@shared/export-links";

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
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ node: _node, href, children, ...props }) => {
            const exportFilePath = getOpenExportFolderPath(href);

            if (!exportFilePath) {
              return (
                <a href={href} {...props}>
                  {children}
                </a>
              );
            }

            const handleClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
              event.preventDefault();
              void window.desktopApi.openExportFolder(exportFilePath).catch((error) => {
                console.error("打开导出目录失败:", error);
              });
            };

            return (
              <a href={href} {...props} onClick={handleClick}>
                {children}
              </a>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
};
