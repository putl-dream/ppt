// @vitest-environment jsdom

import React, { useRef, useState } from "react";
import { act } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentActivityItem } from "../src/shared/agent-activity";
import { formatTerminalAgentRunContent } from "../src/shared/agent-result-copy";
import type { AgentRunResult } from "../src/shared/ipc";
import { createSessionPresentation } from "../src/shared/session";
import {
  useAgentResultHandler,
  type ApplyAgentResult,
} from "../src/renderer/src/app/agent/useAgentResultHandler";
import { findActiveThreadId, type ChatMessage } from "../src/renderer/src/app/chatMessageRuntime";
import { useProjectStore } from "../src/renderer/src/components/project-store";
import {
  clearAllDisplayCardManagers,
  ingestDisplayEvent,
  usePermissionCardManager,
} from "../src/renderer/src/cards/display-card-managers";

let applyResult: ApplyAgentResult;
let messages: ChatMessage[];
const syncPresentation = vi.fn(async () => undefined);
const notify = vi.fn();
const originalHydrateProjectArtifacts = useProjectStore.getState().hydrateProjectArtifacts;

function Harness({ initialContent = "" }: { initialContent?: string }) {
  const initialTrace: AgentActivityItem[] = initialContent
    ? [{
        id: "response-initial",
        kind: "response",
        start: 0,
        end: initialContent.length,
        streaming: false,
      }]
    : [];
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([{
    id: "assistant-1",
    role: "assistant",
    content: initialContent,
    activityTrace: initialTrace,
    runId: "run-1",
    runStatus: "running",
  }]);
  const activeRunTraceRef = useRef<AgentActivityItem[]>(initialTrace);
  const sidechainRunRef = useRef<string | null>(null);
  const streamMessageIdsRef = useRef(new Map([["run-1", "assistant-1"]]));

  applyResult = useAgentResultHandler({
    activeSessionId: "session-1",
    setChatMessages,
    syncPresentation,
    activity: {
      activeRunTraceRef,
      sidechainRunRef,
      streamMessageIdsRef,
    },
    notify,
  });
  messages = chatMessages;
  return <div>{chatMessages.at(-1)?.content}</div>;
}

describe("agent result projection", () => {
  beforeEach(() => {
    clearAllDisplayCardManagers();
    syncPresentation.mockClear();
    notify.mockClear();
    useProjectStore.setState({
      hydrateProjectArtifacts: vi.fn(async () => undefined),
    });
  });

  afterEach(() => {
    cleanup();
    useProjectStore.setState({
      hydrateProjectArtifacts: originalHydrateProjectArtifacts,
    });
  });

  it("keeps a text-only AskUser result waiting on its durable thread", async () => {
    render(<Harness initialContent="我需要先确认一点。" />);
    await act(async () => {
      await applyResult({
        status: "waiting-user",
        message: "请直接输入目标受众",
        threadId: "thread-question",
      }, [], "run-1");
    });

    expect(messages.at(-1)).toMatchObject({
      content: "我需要先确认一点。\n\n请直接输入目标受众",
      runStatus: "waiting",
      threadId: "thread-question",
    });
    expect(findActiveThreadId(messages)).toBe("thread-question");
  });

  it("uses explicit interruption status and preserves partial response text", async () => {
    ingestDisplayEvent({
      protocolVersion: 1,
      eventId: "tool-approval:approval-1",
      emittedAt: "2026-07-25T00:00:00.000Z",
      kind: "permission.tool-requested",
      category: "permission",
      source: { kind: "tool", toolName: "ExportPptx" },
      scope: { sessionId: "session-1", runId: "run-1" },
      semantics: {
        blocking: true,
        requiresResponse: true,
        priority: "critical",
      },
      payload: {
        approvalId: "approval-1",
        toolName: "ExportPptx",
        reason: "需要写入文件",
        detail: "output.pptx",
      },
    });
    render(<Harness initialContent="已经完成前两页" />);
    await act(async () => {
      await applyResult({ status: "interrupted" }, [], "run-1");
    });

    expect(messages.at(-1)).toMatchObject({
      content: "已经完成前两页",
      runStatus: "interrupted",
      runError: undefined,
    });
    expect(notify).toHaveBeenCalledWith("会话已中断");
    expect(usePermissionCardManager.getState().cards[0]?.status).toBe("dismissed");
  });

  it("projects a recoverable service error as structural failure", async () => {
    render(<Harness initialContent="已经完成前两页" />);
    await act(async () => {
      await applyResult({
        status: "failed",
        error: "服务暂时繁忙，请稍后重试。",
      }, [], "run-1");
    });

    expect(messages.at(-1)).toMatchObject({
      content: "已经完成前两页",
      runStatus: "failed",
      runError: "服务暂时繁忙，请稍后重试。",
    });
  });

  it("uses the shared pending-layout copy for the terminal Renderer projection", async () => {
    const presentation = {
      ...createSessionPresentation("Layout result"),
      slides: [{
        id: "slide-needs-layout",
        title: "核心观点",
        layout: "concept" as const,
        elements: [{
          id: "body",
          type: "text" as const,
          x: 0,
          y: 0,
          width: 400,
          height: 80,
          text: "需要选择版式的正文",
          fontSize: 24,
        }],
      }],
    };
    const result: AgentRunResult = { status: "completed", presentation };

    render(<Harness />);
    await act(async () => {
      await applyResult(result, [], "run-1");
    });

    if (result.status !== "completed") throw new Error("Expected completed result");
    expect(messages.at(-1)).toMatchObject({
      content: formatTerminalAgentRunContent(result),
      runStatus: "completed",
    });
    expect(messages.at(-1)?.content).toContain("1 页待排版");
  });
});
