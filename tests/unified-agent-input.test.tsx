import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { UnifiedAgentInput } from "../src/renderer/src/components/UnifiedAgentInput";

describe("UnifiedAgentInput draft workspace", () => {
  it("keeps URL input and submission available before a workspace directory is selected", () => {
    const html = renderToStaticMarkup(
      <UnifiedAgentInput
        request="https://example.com/report"
        onChangeRequest={vi.fn()}
        onSubmitRequest={vi.fn()}
        busy={false}
        models={[]}
        selectedModelId=""
        setSelectedModelId={vi.fn()}
        layoutMode="center"
        sandboxReady={false}
        onPrepareWorkspace={vi.fn()}
      />,
    );

    expect(html).toContain("项目目录（可选）");
    expect(html).toContain("系统会自动创建托管沙箱");
    expect(html).toContain("向演示文稿 Agent 输入指令");
    expect(html).toContain("https://example.com/report");

    const sendButton = html.match(/<button[^>]*aria-label="发送指令"[^>]*>/)?.[0];
    expect(sendButton).toBeDefined();
    expect(sendButton).not.toContain("disabled");
  });
});
