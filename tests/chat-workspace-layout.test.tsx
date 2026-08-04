import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  ChatWorkspace,
  type ChatWorkspaceProps,
} from "../src/renderer/src/components/ChatWorkspace";

function workspaceProps(isNewChat: boolean): ChatWorkspaceProps {
  return {
    session: {
      isNewChat,
      conversationTitle: isNewChat ? undefined : "季度复盘",
      messages: [],
    },
    run: {
      activityTrace: [],
      phase: "idle",
      busy: false,
    },
    composer: {
      request: "",
      onChangeRequest: vi.fn(),
      onSubmitRequest: vi.fn(),
      models: [],
      selectedModelId: "",
      onSelectModel: vi.fn(),
      workspaceReady: false,
      onPrepareWorkspace: vi.fn(),
      onProposePrompt: vi.fn(),
    },
    deck: {
      isMirrorOpen: false,
      onToggleMirror: vi.fn(),
      onOpenPreview: vi.fn(),
      onExport: vi.fn(),
    },
    actions: {
      onResolveApproval: vi.fn(),
      onResolvePatch: vi.fn(),
      onResolveQuestion: vi.fn(),
      onReviseOutline: vi.fn(),
      onUpdateMessageContent: vi.fn(),
      notify: vi.fn(),
    },
  };
}

describe("ChatWorkspace layouts", () => {
  it("renders the focused welcome layout from grouped inputs", () => {
    const html = renderToStaticMarkup(<ChatWorkspace {...workspaceProps(true)} />);

    expect(html).toContain("center-focal-wrapper");
    expect(html).toContain("AI 新建会话");
    expect(html).toContain("center-suggestions");
  });

  it("renders the conversation layout and preview control", () => {
    const html = renderToStaticMarkup(<ChatWorkspace {...workspaceProps(false)} />);

    expect(html).not.toContain("center-focal-wrapper");
    expect(html).toContain("季度复盘");
    expect(html).toContain('aria-label="打开右侧预览"');
    expect(html).toContain("chat-workspace-footer-unified");
  });
});
