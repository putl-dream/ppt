import { getOpenExportFolderPath } from "@shared/export-links";
import type React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface MessageMarkdownProps {
  content: string;
  className?: string;
  renderEmpty?: boolean;
  ariaBusy?: boolean;
}

export const MessageMarkdown: React.FC<MessageMarkdownProps> = ({
  content,
  className,
  renderEmpty = false,
  ariaBusy,
}) => {
  if (!renderEmpty && !content.trim()) return null;

  return (
    <div className={`markdown-body${className ? ` ${className}` : ""}`} aria-busy={ariaBusy}>
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
