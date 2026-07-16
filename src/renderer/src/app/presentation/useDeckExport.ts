import {
  useCallback,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { Presentation } from "@shared/presentation";
import { createOpenExportFolderHref } from "@shared/export-links";
import { formatPublicErrorMessage } from "@shared/agent-activity-display";
import type { ChatMessage } from "../chatMessageRuntime";

interface UseDeckExportOptions {
  presentation: Presentation | undefined;
  logoUrl: string | null;
  setChatMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  notify: (message: string) => void;
}

export function useDeckExport({
  presentation,
  logoUrl,
  setChatMessages,
  notify,
}: UseDeckExportOptions) {
  const [isExportingDeck, setIsExportingDeck] = useState(false);

  const exportDeck = useCallback(async () => {
    if (!presentation || isExportingDeck) return;
    setIsExportingDeck(true);
    try {
      const savedPath = await window.desktopApi.exportPresentation(presentation, { logoUrl });
      setChatMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: savedPath
            ? `文件已保存。 [打开所在目录](${createOpenExportFolderHref(savedPath)})`
            : "已取消导出。",
        },
      ]);
      if (savedPath) notify(`🎉 成功导出至: ${savedPath}`);
    } catch (error) {
      console.error("Export failed:", error);
      const message = formatPublicErrorMessage(error, "导出时遇到问题，请重试。");
      setChatMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: `导出失败：${message}`,
        },
      ]);
      notify(`❌ 导出失败: ${message}`);
    } finally {
      setIsExportingDeck(false);
    }
  }, [isExportingDeck, logoUrl, notify, presentation, setChatMessages]);

  return { isExportingDeck, exportDeck };
}
