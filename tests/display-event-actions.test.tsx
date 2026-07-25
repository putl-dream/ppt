// @vitest-environment jsdom

import React, { useRef, useState } from "react";
import { act } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DisplayEvent } from "../src/shared/card-display-protocol";
import type { AgentActivityItem } from "../src/shared/agent-activity";
import type { ChatMessage } from "../src/renderer/src/app/chatMessageRuntime";
import {
  useAgentResultHandler,
  type ApplyAgentResult,
} from "../src/renderer/src/app/agent/useAgentResultHandler";
import {
  useDisplayEventActions,
  type DisplayEventActions,
} from "../src/renderer/src/app/cards/useDisplayEventActions";
import type { AgentActivityStreamController } from "../src/renderer/src/app/agent/useAgentActivityStream";
import { useProjectStore } from "../src/renderer/src/components/project-store";
import {
  clearAllDisplayCardManagers,
  ingestDisplayEvent,
  setDisplayCardStatus,
  useReviewCardManager,
} from "../src/renderer/src/cards/display-card-managers";

const approvalEvent = {
  protocolVersion: 1 as const,
  eventId: "command-proposal:thread-1",
  emittedAt: "2026-07-25T00:00:00.000Z",
  kind: "review.command-proposal" as const,
  category: "review" as const,
  source: { kind: "tool" as const, toolName: "SubmitCommands" },
  scope: {
    sessionId: "session-1",
    runId: "run-1",
    threadId: "thread-1",
    anchorMessageId: "assistant-1",
  },
  semantics: {
    blocking: true,
    requiresResponse: true,
    priority: "high" as const,
  },
  payload: {
    threadId: "thread-1",
    summary: "更新标题",
    commands: [{
      id: "command-1",
      type: "set-presentation-title" as const,
      title: "新标题",
    }],
  },
} satisfies Extract<DisplayEvent, { kind: "review.command-proposal" }>;

let actions: DisplayEventActions;
let messages: ChatMessage[];
let busy: boolean;
const notify = vi.fn();
const syncPresentation = vi.fn(async () => undefined);
const startAgent = vi.fn(async () => undefined);
const originalHydrate = useProjectStore.getState().hydrateProjectArtifacts;

function Harness() {
  const initialTrace: AgentActivityItem[] = [{
    id: "response-waiting",
    kind: "response",
    start: 0,
    end: 20,
    streaming: false,
  }];
  const [isBusy, setBusy] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([{
    id: "assistant-1",
    role: "assistant",
    content: "已提出排版更新方案，请在下方审核后应用。",
    activityTrace: initialTrace,
    runId: "run-1",
    runStatus: "waiting",
    threadId: "thread-1",
  }]);
  const activeRunTraceRef = useRef<AgentActivityItem[]>(initialTrace);
  const streamMessageIdsRef = useRef(new Map<string, string>());
  const sidechainRunRef = useRef<string | null>(null);
  const activeRunIdRef = useRef<string | null>(null);
  const applyAgentResult: ApplyAgentResult = useAgentResultHandler({
    activeSessionId: "session-1",
    setChatMessages,
    syncPresentation,
    activity: {
      activeRunTraceRef,
      streamMessageIdsRef,
      sidechainRunRef,
    },
    notify,
  });
  const activity = {
    activityTrace: [],
    agentRunPhase: "idle",
    activeRunIdRef,
    activeRunTraceRef,
    streamMessageIdsRef,
    sidechainRunRef,
    syncActivityTrace(next: AgentActivityItem[]) {
      activeRunTraceRef.current = next;
    },
    beginRunActivity: vi.fn(),
    finishRunActivity: vi.fn(),
    waitForRunStreamCompletion: vi.fn(async () => undefined),
  } satisfies AgentActivityStreamController;

  actions = useDisplayEventActions({
    busy: isBusy,
    setBusy,
    activeSessionId: "session-1",
    setChatMessages,
    syncPresentation,
    setSelectedDesignSystem: vi.fn(),
    activity,
    agentRun: {
      startAgent,
      applyAgentResult,
    },
    notify,
  });
  messages = chatMessages;
  busy = isBusy;
  return null;
}

describe("display event approval actions", () => {
  beforeEach(() => {
    clearAllDisplayCardManagers();
    notify.mockClear();
    syncPresentation.mockClear();
    startAgent.mockClear();
    useProjectStore.setState({
      hydrateProjectArtifacts: vi.fn(async () => undefined),
    });
  });

  afterEach(() => {
    cleanup();
    useProjectStore.setState({ hydrateProjectArtifacts: originalHydrate });
  });

  it("settles a failed resume on the original waiting message", async () => {
    Object.defineProperty(window, "desktopApi", {
      configurable: true,
      value: {
        resumeAgentRun: vi.fn(async () => ({
          status: "failed" as const,
          error: "演示文稿已变化，请重新生成方案。",
        })),
      },
    });
    render(<Harness />);

    await act(async () => {
      await actions.resolveApproval(approvalEvent, true);
    });

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      id: "assistant-1",
      runStatus: "failed",
      runError: "演示文稿已变化，请重新生成方案。",
    });
    expect(busy).toBe(false);
  });

  it("reactivates the review card when IPC itself fails without adding raw transcript text", async () => {
    Object.defineProperty(window, "desktopApi", {
      configurable: true,
      value: {
        resumeAgentRun: vi.fn(async () => {
          throw new Error("internal stack detail");
        }),
      },
    });
    ingestDisplayEvent(approvalEvent);
    setDisplayCardStatus(approvalEvent.eventId, "resolved");
    render(<Harness />);

    await act(async () => {
      await actions.resolveApproval(approvalEvent, true);
    });

    expect(messages).toHaveLength(1);
    expect(messages[0]?.runStatus).toBe("waiting");
    expect(useReviewCardManager.getState().cards[0]?.status).toBe("active");
    expect(notify).toHaveBeenCalledWith("确认变更失败，请重试。");
    expect(busy).toBe(false);
  });

  it("settles the waiting question message before continuing its thread", () => {
    render(<Harness />);
    const questionEvent = {
      protocolVersion: 1 as const,
      eventId: "question-1",
      emittedAt: "2026-07-25T00:00:00.000Z",
      kind: "interaction.question-requested" as const,
      category: "interaction" as const,
      source: { kind: "tool" as const, toolName: "AskUser" },
      scope: {
        sessionId: "session-1",
        runId: "run-1",
        threadId: "thread-1",
        anchorMessageId: "assistant-1",
      },
      semantics: {
        blocking: true,
        requiresResponse: true,
        priority: "high" as const,
      },
      payload: {
        message: "请选择目标受众",
      },
    } satisfies Extract<DisplayEvent, { kind: "interaction.question-requested" }>;

    act(() => {
      actions.resolveQuestion(questionEvent, {
        optionIds: [],
        value: "面向管理层",
        label: "管理层",
        resolvedAt: "2026-07-25T00:00:00.000Z",
      });
    });

    expect(messages[0]?.runStatus).toBe("completed");
    expect(startAgent).toHaveBeenCalledWith(
      "面向管理层",
      undefined,
      {
        userDisplayContent: "管理层",
        generationMode: "agent",
      },
    );
  });
});
