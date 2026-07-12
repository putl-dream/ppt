import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AgentQuestionCard } from "../src/renderer/src/components/AgentQuestionCard";

describe("AgentQuestionCard", () => {
  it("renders a usable free-text form for markdown questions", () => {
    const html = renderToStaticMarkup(
      <AgentQuestionCard
        question={{
          variant: "markdown",
          selectionMode: "single",
          placeholder: "例如：面向高中生，约 8-10 页",
        }}
        onResolve={vi.fn()}
      />,
    );

    expect(html).toContain("<textarea");
    expect(html).toContain("例如：面向高中生，约 8-10 页");
    expect(html).toContain("提交回答");
  });
});
