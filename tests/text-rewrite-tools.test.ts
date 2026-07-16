import { describe, expect, it, vi } from "vitest";
import type { AgentModelGateway } from "../src/main/agent/gateway/types";
import { compressTextTool } from "../src/main/agent/tools/deferred/compress-text";
import { rewriteSlideContentTool } from "../src/main/agent/tools/deferred/rewrite-slide-content";
import type { ToolContext } from "../src/main/agent/tools/tool-definition";
import type { Presentation } from "../src/shared/presentation";
import { TEST_DESIGN_SYSTEM } from "./design-engine-test-utils";

function jsonGateway(output: Record<string, unknown>): AgentModelGateway {
  return {
    generateText: vi.fn(async () => ({
      provider: "openai" as const,
      model: "test-model",
      content: [{ type: "text" as const, text: JSON.stringify(output) }],
    })),
    async *generateTextStream() {
      yield { type: "complete" as const, content: [] };
    },
  };
}

function makeContext(
  presentation: Presentation,
  gateway?: AgentModelGateway,
): ToolContext {
  return {
    presentation,
    gateway,
    selectedElementIds: [],
    discoverySession: { discoveredToolNames: new Set() },
    registry: {} as ToolContext["registry"],
    messageHistory: [],
  };
}

function presentationWithText(text: string): {
  presentation: Presentation;
  slideId: string;
  elementId: string;
} {
  const slideId = crypto.randomUUID();
  const elementId = crypto.randomUUID();
  return {
    slideId,
    elementId,
    presentation: {
      id: crypto.randomUUID(),
      title: "Deck",
      revision: 1,
      designSystem: TEST_DESIGN_SYSTEM,
      slides: [{
        id: slideId,
        title: "Facts",
        elements: [{
          id: elementId,
          type: "text",
          x: 120,
          y: 180,
          width: 800,
          height: 180,
          text,
          fontSize: 24,
        }],
      }],
    },
  };
}

describe("fact-preserving text tools", () => {
  it("CompressText uses structured model output and preserves factual tokens", async () => {
    const text = [
      "2026 年项目收入预计增长 12%，完整说明见 https://example.com/report。",
      "其余文字用于反复解释背景、执行过程、沟通方式和不影响结论的补充信息。",
    ].join("");
    const compressedText = "2026 年项目收入预计增长 12%，详见 https://example.com/report";
    const result = await compressTextTool.execute(
      { text, maxLength: 65 },
      makeContext(
        presentationWithText(text).presentation,
        jsonGateway({ compressedText }),
      ),
    );

    expect(result.compressedText).toBe(compressedText);
  });

  it("CompressText rejects model output that drops a protected fact", async () => {
    const text = [
      "2026 年项目收入预计增长 12%。",
      "其余文字用于反复解释背景、执行过程、沟通方式和不影响结论的补充信息。",
    ].join("");
    await expect(compressTextTool.execute(
      { text, maxLength: 40 },
      makeContext(
        presentationWithText(text).presentation,
        jsonGateway({ compressedText: "项目收入预计增长。" }),
      ),
    )).rejects.toThrow("dropped protected factual tokens");
  });

  it("RewriteSlideContent returns a real update command without mock labels", async () => {
    const source = "2026 年客户续约率达到 92%，团队将继续优化交付流程。";
    const { presentation, slideId, elementId } = presentationWithText(source);
    const rewrittenText = "2026 年客户续约率已达 92%，下一阶段将持续优化交付流程。";

    const result = await rewriteSlideContentTool.execute(
      { slideId, elementId, style: "professional" },
      makeContext(presentation, jsonGateway({ rewrittenText })),
    );

    expect(result.commands).toHaveLength(1);
    expect(result.commands[0]).toMatchObject({
      type: "update-element",
      slideId,
      elementId,
      element: { text: rewrittenText },
    });
    expect(rewrittenText).not.toMatch(/\[专业版\]|Sparking|Key Value/);
  });

  it("does not fall back to destructive local rewriting without a gateway", async () => {
    const text = "需要保留的完整事实文本。".repeat(8);
    await expect(compressTextTool.execute(
      { text, maxLength: 30 },
      makeContext(presentationWithText(text).presentation),
    )).rejects.toThrow("requires a configured model gateway");
  });
});
