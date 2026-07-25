// @vitest-environment jsdom

import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { deriveAgentRunPresentation } from "../src/renderer/src/agentRunPresentation";
import { AgentRunLoader } from "../src/renderer/src/components/AgentRunLoader";
import { AgentRunTimeline } from "../src/renderer/src/components/AgentRunTimeline";
import { AgentRunTerminalNotice } from "../src/renderer/src/components/AgentRunTerminalNotice";
import { ProcessTraceItem } from "../src/renderer/src/components/ProcessTraceItem";
import { buildProcessTraceRows } from "../src/renderer/src/components/process-trace-rows";
import type { AgentActivityItem } from "../src/shared/agent-activity";

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
      phase,
    }: {
      items: AgentActivityItem[];
      content: string;
      busy: boolean;
      phase: "requesting" | "responding" | "tool";
    }) => (
      <div data-testid="surface">
        <AgentRunTimeline items={items} content={content} live={busy} />
        <AgentRunLoader
          busy={busy}
          phase={phase}
          activityTrace={items}
        />
      </div>
    );

    const view = render(
      <Surface items={[]} content="" busy phase="requesting" />,
    );
    const surface = screen.getByTestId("surface");
    const activeSpinners = () => surface.querySelectorAll([
      ".agent-run-loader--active",
      ".process-trace-row-status--running",
    ].join(", "));
    expect(surface.lastElementChild?.classList.contains("agent-run-tail")).toBe(true);
    expect(screen.getByRole("status").textContent).toBe("正在理解你的需求");
    expect(activeSpinners()).toHaveLength(1);

    const firstText: AgentActivityItem[] = [{
      id: "response-1",
      kind: "response",
      start: 0,
      end: 5,
      streaming: true,
    }];
    view.rerender(
      <Surface items={firstText} content="我先检查。" busy phase="responding" />,
    );
    const firstResponse = surface.querySelector('[data-run-block-id="response-1"]');
    expect(firstResponse).not.toBeNull();
    expect(surface.querySelector(".agent-run-tail")).toBeNull();
    expect(activeSpinners()).toHaveLength(0);

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
      <Surface items={withTool} content="我先检查。" busy phase="tool" />,
    );
    const tool = surface.querySelector('[data-run-block-id="tool-1"]');
    expect(surface.querySelector('[data-run-block-id="response-1"]')).toBe(firstResponse);
    expect(surface.querySelector(".agent-run-tail")).toBeNull();
    expect(tool).not.toBeNull();
    expect(activeSpinners()).toHaveLength(1);

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
        phase="responding"
      />,
    );
    expect(
      [...surface.querySelectorAll("[data-run-block-kind]")]
        .map((element) => element.getAttribute("data-run-block-kind")),
    ).toEqual(["response", "tool", "response"]);
    expect(surface.querySelector('[data-run-block-id="response-1"]')).toBe(firstResponse);
    expect(surface.querySelector('[data-run-block-id="tool-1"]')).toBe(tool);
    expect(surface.querySelector(".agent-run-tail")).toBeNull();
    expect(activeSpinners()).toHaveLength(0);

    view.rerender(
      <Surface
        items={finalItems.map((item) =>
          item.kind === "response" ? { ...item, streaming: false } : item
        )}
        content="我先检查。处理完成"
        busy={false}
        phase="responding"
      />,
    );
    expect(surface.querySelector('[data-run-block-id="response-1"]')).toBe(firstResponse);
    expect(surface.querySelector('[data-run-block-id="tool-1"]')).toBe(tool);
    expect(surface.querySelector(".agent-run-tail")).toBeNull();
    expect(activeSpinners()).toHaveLength(0);
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
    "keeps the tail loader during a %s gap",
    (phase) => {
      render(
        <AgentRunLoader
          busy
          phase={phase}
          activityTrace={[]}
        />,
      );

      expect(document.querySelector(".agent-run-tail")).not.toBeNull();
      expect(document.querySelectorAll(".agent-run-loader--active")).toHaveLength(1);
    },
  );

  it("turns permission waiting into a static state instead of a spinner", () => {
    render(
      <AgentRunLoader
        busy
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

    expect(screen.getByRole("status").textContent).toBe("等待你的确认");
    expect(document.querySelector(".agent-run-loader--paused")).not.toBeNull();
    expect(document.querySelector(".agent-run-loader--active")).toBeNull();
  });

  it("renders independent spinner and failure state for same-name tool calls", () => {
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

  it("renders interrupted and failed outcomes outside assistant transcript text", () => {
    const interrupted = render(
      <AgentRunTerminalNotice status="interrupted" />,
    );
    expect(interrupted.getByRole("status").textContent).toBe("■会话已中断");
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
