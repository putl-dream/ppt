import { createDisplayEventId } from "@shared/card-display-protocol";
import type { Presentation } from "@shared/presentation";
import { ingestDisplayEvent } from "../../cards/display-card-managers";
import type { ChatMessage } from "../chatMessageRuntime";

const PREVIEW_PROMPT_PATTERN =
  /预览.*(?:ppt|幻灯片|演示文稿)|(?:ppt|幻灯片|演示文稿).*预览|打开.*预览/i;

const isPreviewPrompt = (prompt: string) => PREVIEW_PROMPT_PATTERN.test(prompt.trim());

interface HandleLocalAgentCommandOptions {
  prompt: string;
  presentation?: Presentation;
  sessionId: string;
  clearRequest: boolean;
  appendChatMessage: (message: ChatMessage) => void;
  onClearRequest: () => void;
  openDeckPreview: () => void;
  notify: (message: string) => void;
}

/** Returns true when a Renderer-only command consumed the prompt. */
export function tryHandleLocalAgentCommand({
  prompt,
  presentation,
  sessionId,
  clearRequest,
  appendChatMessage,
  onClearRequest,
  openDeckPreview,
  notify,
}: HandleLocalAgentCommandOptions): boolean {
  if (!presentation || !isPreviewPrompt(prompt)) return false;

  appendChatMessage({ id: crypto.randomUUID(), role: "user", content: prompt });
  if (clearRequest) onClearRequest();
  openDeckPreview();

  const previewMessageId = crypto.randomUUID();
  ingestDisplayEvent({
    protocolVersion: 1,
    eventId: createDisplayEventId("artifact-preview"),
    emittedAt: new Date().toISOString(),
    kind: "artifact.ready",
    category: "artifact",
    source: {
      kind: "frontend",
      feature: "deck-preview-command",
    },
    scope: {
      ...(sessionId ? { sessionId } : {}),
      anchorMessageId: previewMessageId,
    },
    semantics: {
      blocking: false,
      requiresResponse: false,
      priority: "normal",
    },
    payload: {
      artifactId: "deck",
      artifactType: "deck",
      title: presentation.title,
      revision: presentation.revision,
    },
  });
  appendChatMessage({
    id: previewMessageId,
    role: "assistant",
    content: "已打开演示文稿预览，你可以在右侧或弹窗中查看全部页面。",
  });
  notify("已打开演示文稿预览");
  return true;
}
