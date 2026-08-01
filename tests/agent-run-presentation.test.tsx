// @vitest-environment jsdom

import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { deriveAgentRunPresentation } from "../src/renderer/src/agentRunPresentation";
import { AgentRunTimeline } from "../src/renderer/src/components/AgentRunTimeline";
import { AgentRunTerminalNotice } from "../src/renderer/src/components/AgentRunTerminalNotice";
import { ProcessTraceItem } from "../src/renderer/src/components/ProcessTraceItem";
import { RunStatusIndicator } from "../src/renderer/src/components/RunStatusIndicator";
import { buildProcessTraceRows } from "../src/renderer/src/components/process-trace-rows";
import type { AgentActivityItem } from "../src/shared/agent-activity";
import type { AgentTaskNode } from "../src/shared/agent-task-list";

afterEach(cleanup);

describe("agent run presentation", () => {
  it("keeps activity at the tail while appending text, tool, then text", () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: () => ({
        matches: true,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }),
    });

    const Surface = ({
      items,
      content,
      busy,
    }: {
      items: AgentActivityItem[];
      content: string;
      busy: boolean;
    }) => (
      <div data-testid="surface">
        <AgentRunTimeline items={items} content={content} live={busy} />
      </div>
    );

    const view = render(
      <Surface items={[]} content="" busy />,
    );
    const surface = screen.getByTestId("surface");
    expect(surface.querySelector("[data-run-block-kind]")).toBeNull();

    const firstText: AgentActivityItem[] = [{
      id: "response-1",
      kind: "response",
      start: 0,
      end: 5,
      streaming: true,
    }];
    view.rerender(
      <Surface items={firstText} content="我先检查。" busy />,
    );
    const firstResponse = surface.querySelector('[data-run-block-id="response-1"]');
    expect(firstResponse).not.toBeNull();
    expect(surface.querySelector(".process-trace-row-status--running")).toBeNull();

    const withTool: AgentActivityItem[] = [
      { ...firstText[0]!, streaming: false },
      {
        id: "tool-1",
        kind: "tool",
        toolCallId: "call-1",
        toolName: "ReadPresentationSnapshot",
        status: "running",
      },
    ];
    view.rerender(
      <Surface items={withTool} content="我先检查。" busy />,
    );
    const tool = surface.querySelector('[data-run-block-id="tool-1"]');
    expect(surface.querySelector('[data-run-block-id="response-1"]')).toBe(firstResponse);
    expect(tool).not.toBeNull();
    expect(surface.querySelectorAll(".process-trace-row-status--running")).toHaveLength(1);

    const finalItems: AgentActivityItem[] = [
      withTool[0]!,
      { ...withTool[1]!, status: "completed" },
      {
        id: "response-2",
        kind: "response",
        start: 5,
        end: 9,
        streaming: true,
      },
    ];
    view.rerender(
      <Surface
        items={finalItems}
        content="我先检查。处理完成"
        busy
      />,
    );
    expect(
      [...surface.querySelectorAll("[data-run-block-kind]")]
        .map((element) => element.getAttribute("data-run-block-kind")),
    ).toEqual(["response", "tool", "response"]);
    expect(surface.querySelector('[data-run-block-id="response-1"]')).toBe(firstResponse);
    expect(surface.querySelector('[data-run-block-id="tool-1"]')).toBe(tool);
    expect(surface.querySelector(".process-trace-row-status--running")).toBeNull();

    view.rerender(
      <Surface
        items={finalItems.map((item) =>
          item.kind === "response" ? { ...item, streaming: false } : item
        )}
        content="我先检查。处理完成"
        busy={false}
      />,
    );
    expect(surface.querySelector('[data-run-block-id="response-1"]')).toBe(firstResponse);
    expect(surface.querySelector('[data-run-block-id="tool-1"]')).toBe(tool);
  });

  it("uses the active tool as the primary loading message", () => {
    const trace: AgentActivityItem[] = [{
      id: "tool-1",
      kind: "tool",
      toolCallId: "call-1",
      toolName: "ReadPresentationSnapshot",
      status: "running",
    }];

    expect(deriveAgentRunPresentation("tool", trace)).toEqual({
      phase: "tool",
      label: "正在读取演示文稿…",
      animated: true,
    });
  });

  it.each(["requesting", "thinking", "working"] as const)(
    "shows run status with glyph and shimmer during a %s gap",
    (phase) => {
      render(
        <RunStatusIndicator
          phase={phase}
          activityTrace={[]}
        />,
      );

      expect(document.querySelector(".loading-indicator--sm")).not.toBeNull();
      expect(document.querySelectorAll(".agent-run-status--shimmer")).toHaveLength(1);
      expect(screen.getByRole("status").textContent).toBeTruthy();
    },
  );

  it("keeps timeline process label neutral while dock status owns the step copy", () => {
    render(
      <div data-testid="surface">
        <AgentRunTimeline
          content=""
          live
          items={[{
            id: "reason-1",
            kind: "reasoning",
            content: "",
            streaming: true,
          }]}
        />
        <RunStatusIndicator
          phase="thinking"
          activityTrace={[{
            id: "reason-1",
            kind: "reasoning",
            content: "",
            streaming: true,
          }]}
        />
      </div>,
    );

    const surface = screen.getByTestId("surface");
    expect(surface.querySelector(".process-trace-panel-label")?.textContent).toBe("执行过程");
    expect(surface.querySelector(".loading-indicator--sm")).not.toBeNull();
    expect(surface.querySelectorAll(".agent-run-status--shimmer")).toHaveLength(1);
    expect(screen.getByRole("status").textContent).toContain("正在思考页面内容");
    expect(surface.textContent).not.toContain("思考中");
  });

  it("turns permission waiting into a static glyph instead of a shimmer", () => {
    render(
      <RunStatusIndicator
        phase="waiting"
        activityTrace={[{
          id: "tool-awaiting-approval",
          kind: "tool",
          toolCallId: "call-awaiting-approval",
          toolName: "ExecuteCommand",
          status: "running",
        }]}
      />,
    );

    expect(screen.getByRole("status").textContent).toContain("等待你的确认");
    expect(document.querySelector(".loading-indicator--paused")).not.toBeNull();
    expect(document.querySelector(".agent-run-status--paused")).not.toBeNull();
    expect(document.querySelector(".agent-run-status--shimmer")).toBeNull();
  });

  it("renders independent running pulse and failure state for same-name tool calls", () => {
    const rows = buildProcessTraceRows([
      {
        id: "tool-a",
        kind: "tool",
        toolCallId: "call-a",
        toolName: "ReadPresentationSnapshot",
        status: "running",
      },
      {
        id: "tool-b",
        kind: "tool",
        toolCallId: "call-b",
        toolName: "ReadPresentationSnapshot",
        status: "failed",
      },
    ], true);

    const running = render(<ProcessTraceItem row={rows[0]!} />);
    expect(running.container.querySelector(".process-trace-row-status--running")).not.toBeNull();
    expect(running.container.textContent).toContain("正在读取演示文稿");
    running.unmount();

    const failed = render(<ProcessTraceItem row={rows[1]!} />);
    expect(failed.container.querySelector(".process-trace-row-status--failed")).not.toBeNull();
    expect(failed.container.textContent).toContain("读取演示文稿未完成");
    expect(failed.container.textContent).not.toContain("ReadPresentationSnapshot");
  });

  it("exposes one keyboard target for an expandable trace row", () => {
    render(<ProcessTraceItem row={{
      id: "thought-1",
      kind: "thought",
      title: "查看思考过程",
      content: "正在分析页面结构",
      active: false,
    }} />);

    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.getByRole("button").textContent).toContain("查看思考过程");
  });

  it("collapses adjacent completed tools into one disclosure", () => {
    render(
      <AgentRunTimeline
        content=""
        items={[
          {
            id: "preview-1",
            kind: "tool",
            toolCallId: "preview-call-1",
            toolName: "PreviewSlide",
            status: "completed",
          },
          {
            id: "preview-2",
            kind: "tool",
            toolCallId: "preview-call-2",
            toolName: "PreviewSlide",
            status: "completed",
          },
        ]}
      />,
    );

    const disclosure = screen.getByRole("button", { name: "展开执行过程" });
    expect(disclosure.textContent).toContain("2 项操作");
    expect(document.querySelector('[data-run-block-id="preview-1"]')).toBeNull();

    fireEvent.click(disclosure);
    expect(document.querySelector('[data-run-block-id="preview-1"]')).not.toBeNull();
    expect(document.querySelector('[data-run-block-id="preview-2"]')).not.toBeNull();
  });

  it("does not duplicate a task activity already represented by the task panel", () => {
    const graphTask: AgentTaskNode = {
      id: "layout-task",
      revision: 1,
      subject: "生成排版计划",
      description: "为每页选择版式",
      status: "in_progress",
      routing: { executionTarget: "teammate" },
      completionPolicy: "review_required",
      owner: "layout_planner",
      blocks: [],
      blockedBy: [],
      review: { state: "none" },
      reviewReceipts: [],
    };

    render(
      <AgentRunTimeline
        content=""
        live
        teamGraphTasks={[graphTask]}
        items={[{
          id: "layout-activity",
          kind: "task",
          taskId: "layout-task",
          taskListId: "layout-task",
          agentName: "layout_planner",
          description: graphTask.description,
          status: "running",
          steps: [],
        }]}
      />,
    );

    expect(document.querySelector('[data-run-block-kind="task"]')).toBeNull();
    expect(document.querySelector(".team-session-card")).toBeNull();
  });

  it("renders interrupted and failed outcomes outside assistant transcript text", () => {
    const interrupted = render(
      <AgentRunTerminalNotice status="interrupted" />,
    );
    expect(interrupted.getByRole("status").textContent).toBe("会话已中断");
    interrupted.unmount();

    render(
      <AgentRunTerminalNotice
        status="failed"
        error="模型服务暂时不可用"
        onRetry={() => undefined}
      />,
    );
    expect(screen.getByRole("status").textContent).toContain("本次处理未完成");
    expect(screen.getByRole("status").textContent).toContain("模型服务暂时不可用");
    expect(screen.getByRole("button", { name: "重试" })).not.toBeNull();
  });
});
