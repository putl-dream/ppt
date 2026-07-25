// @vitest-environment jsdom

import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentQuestionCard } from "../src/renderer/src/components/AgentQuestionCard";

afterEach(cleanup);

describe("AgentQuestionCard", () => {
  it("submits trimmed free text as a structured answer", () => {
    const onResolve = vi.fn();
    render(
      <AgentQuestionCard
        question={{
          variant: "markdown",
          selectionMode: "single",
          placeholder: "例如：面向高中生，约 8-10 页",
        }}
        onResolve={onResolve}
      />,
    );

    const input = screen.getByPlaceholderText("例如：面向高中生，约 8-10 页");
    const submit = screen.getByRole("button", { name: "提交回答" });
    expect((submit as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(input, { target: { value: "  面向高中生，10 页  " } });
    expect((submit as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(submit);

    expect(onResolve).toHaveBeenCalledWith({
      optionIds: [],
      value: "面向高中生，10 页",
      label: "面向高中生，10 页",
      resolvedAt: expect.any(String),
    });
  });

  it("submits a single choice immediately and compacts resolved questions", () => {
    const onResolve = vi.fn();
    const view = render(
      <AgentQuestionCard
        question={{
          variant: "choices",
          selectionMode: "single",
          options: [{ id: "executives", title: "管理层", value: "面向管理层" }],
        }}
        onResolve={onResolve}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "管理层" }));
    expect(onResolve).toHaveBeenCalledWith({
      optionIds: ["executives"],
      value: "面向管理层",
      label: "管理层",
      resolvedAt: expect.any(String),
    });

    view.rerender(
      <AgentQuestionCard
        question={{
          variant: "choices",
          selectionMode: "single",
          options: [{ id: "executives", title: "管理层", value: "面向管理层" }],
          resolved: {
            optionIds: ["executives"],
            value: "面向管理层",
            label: "管理层",
            resolvedAt: "2026-07-25T00:00:00.000Z",
          },
        }}
        onResolve={onResolve}
      />,
    );

    expect(screen.queryByRole("button", { name: "管理层" })).toBeNull();
    expect(screen.getByText("已回答")).not.toBeNull();
    expect(screen.getByText("管理层")).not.toBeNull();
  });
});
