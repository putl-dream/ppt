import { describe, expect, it } from "vitest";
import type { PresentationCommand } from "@shared/commands";
import type { Presentation } from "@shared/presentation";
import {
  applyCommandsToDraft,
  collectAffectedSlideIds,
  hasLayoutVisualCommands,
} from "../src/main/agent/runtime/presentation/layout-command-utils";
import {
  buildRenderFeedback,
  formatRenderFeedbackMessage,
  shouldOfferRenderFeedback,
} from "../src/main/agent/runtime/presentation/render-feedback-loop";
import type { ToolContext } from "../src/main/agent/tools/tool-definition";
import { createDefaultToolRegistry } from "../src/main/agent/tools/tool-registry";
import { AgentRuntime } from "../src/main/agent/runtime/agent-runtime";
import type {
  AgentModelGateway,
  AgentModelRequest,
  AgentModelResponse,
  AgentModelToolUseBlock,
} from "../src/main/agent/gateway/types";
import { TEST_DESIGN_SYSTEM, testDesignSystem } from "./design-engine-test-utils";

function makePresentation(): Presentation {
  const slideId = crypto.randomUUID();
  return {
    id: crypto.randomUUID(),
    title: "Test Deck",
    revision: 1,
    designSystem: TEST_DESIGN_SYSTEM,
    slides: [{
      id: slideId,
      title: "Intro",
      layout: "concept",
      elements: [{
        id: crypto.randomUUID(),
        type: "text",
        x: 100,
        y: 100,
        width: 400,
        height: 80,
        text: "Hello",
        fontSize: 32,
      }],
    }],
  };
}

describe("layout-command-utils", () => {
  it("detects layout-visual commands", () => {
    const layoutCommands: PresentationCommand[] = [
      { id: "c1", type: "set-design-system", designSystem: TEST_DESIGN_SYSTEM },
      { id: "c2", type: "update-slide-layout", slideId: "s1", layout: "cover" },
    ];
    expect(hasLayoutVisualCommands(layoutCommands)).toBe(true);
    expect(hasLayoutVisualCommands([
      { id: "c3", type: "set-presentation-title", title: "New title" },
    ])).toBe(false);
  });

  it("applies commands to a draft presentation", () => {
    const presentation = makePresentation();
    const slideId = presentation.slides[0].id;
    const draft = applyCommandsToDraft(presentation, [
      { id: "c1", type: "set-design-system", designSystem: TEST_DESIGN_SYSTEM },
      { id: "c2", type: "update-slide-layout", slideId, layout: "cover" },
    ]);
    expect(draft.designSystem).toEqual(TEST_DESIGN_SYSTEM);
    expect(draft.slides[0].layout).toBe("cover");
  });

  it("collects affected slide ids and expands on set-design-system", () => {
    const presentation = makePresentation();
    const slideId = presentation.slides[0].id;
    const draft = applyCommandsToDraft(presentation, [
      { id: "c1", type: "set-design-system", designSystem: testDesignSystem({ palette: "warm-paper" }) },
    ]);
    expect(collectAffectedSlideIds([
      { id: "c1", type: "set-design-system", designSystem: testDesignSystem({ palette: "warm-paper" }) },
    ], draft)).toEqual([slideId]);
  });
});

describe("render-feedback-loop", () => {
  it("offers feedback only once in layout stages with visual commands", () => {
    const commands: PresentationCommand[] = [
      { id: "c1", type: "update-slide-layout", slideId: "s1", layout: "cover" },
    ];
    expect(shouldOfferRenderFeedback("style", commands, false)).toBe(true);
    expect(shouldOfferRenderFeedback("style", commands, true)).toBe(false);
    expect(shouldOfferRenderFeedback("author", commands, false)).toBe(false);
  });

  it("builds structured feedback without thumbnails outside Electron", async () => {
    const presentation = makePresentation();
    const slideId = presentation.slides[0].id;
    const registry = createDefaultToolRegistry();
    const context: ToolContext = {
      presentation,
      currentSlideId: slideId,
      selectedElementIds: [],
      discoverySession: { discoveredToolNames: new Set() },
      registry,
      messageHistory: [],
      skillSession: { loadedSkillNames: new Set() },
      promptStage: "style",
    };

    const payload = await buildRenderFeedback({
      presentation,
      commands: [
        { id: "c1", type: "set-design-system", designSystem: TEST_DESIGN_SYSTEM },
        { id: "c2", type: "update-slide-layout", slideId, layout: "cover" },
      ],
      proposalSummary: "Apply cover layout",
      context,
    });

    expect(payload.slides.length).toBe(1);
    expect(payload.slides[0].layout).toBe("cover");
    expect(payload.slides[0].scores.overall).toBeGreaterThan(0);
    expect(payload.deckScores.consistency).toBe(100);
    expect(payload.visualAssetAudit.totalImageCount).toBe(0);
    expect(payload.hasThumbnails).toBe(false);
    expect(formatRenderFeedbackMessage(payload)).toContain("排版视觉反馈");
    expect(formatRenderFeedbackMessage(payload)).toContain("Deck 总分");
  });

  it("keeps structured feedback for every affected slide", async () => {
    const base = makePresentation();
    const presentation: Presentation = {
      ...base,
      slides: Array.from({ length: 8 }, (_, index) => ({
        ...structuredClone(base.slides[0]),
        id: `slide-${index + 1}`,
        title: `Slide ${index + 1}`,
        elements: base.slides[0].elements.map((element) => ({
          ...structuredClone(element),
          id: `${element.id}-${index + 1}`,
        })),
      })),
    };
    const context: ToolContext = {
      presentation,
      selectedElementIds: [],
      discoverySession: { discoveredToolNames: new Set() },
      registry: createDefaultToolRegistry(),
      messageHistory: [],
      promptStage: "style",
    };

    const payload = await buildRenderFeedback({
      presentation,
      commands: [{
        id: "restyle-all",
        type: "set-design-system",
        designSystem: testDesignSystem({ palette: "warm-paper" }),
      }],
      proposalSummary: "Restyle all slides",
      context,
    });

    expect(payload.slides).toHaveLength(8);
  });
});

function createNativeGateway(
  turns: Array<{ text?: string; toolCalls?: AgentModelToolUseBlock[] }>,
): AgentModelGateway & { requests: AgentModelRequest[] } {
  let index = 0;
  const requests: AgentModelRequest[] = [];
  return {
    requests,
    async generateText(request): Promise<AgentModelResponse> {
      requests.push(request);
      const turn = turns[index++];
      if (!turn) throw new Error("Unexpected gateway call");
      return {
        provider: "anthropic",
        model: "test-model",
        content: [
          ...(turn.text ? [{ type: "text" as const, text: turn.text }] : []),
          ...(turn.toolCalls ?? []),
        ],
      };
    },
    async *generateTextStream() {
      const turn = turns[index++];
      if (!turn) throw new Error("Unexpected gateway call");
      yield {
        type: "complete" as const,
        content: [
          ...(turn.text ? [{ type: "text" as const, text: turn.text }] : []),
          ...(turn.toolCalls ?? []),
        ],
      };
    },
  };
}

describe("render feedback runtime integration", () => {
  it("defers finish after layout SubmitCommands and continues for visual review", async () => {
    const registry = createDefaultToolRegistry();

    const presentation = makePresentation();
    const slideId = presentation.slides[0].id;

    const gateway = createNativeGateway([
      {
        toolCalls: [{
          type: "tool_use",
          id: "call-1",
          name: "SubmitCommands",
          input: {
            summary: "Apply design system and cover layout",
            commands: [
              { id: "c1", type: "set-design-system", designSystem: TEST_DESIGN_SYSTEM },
              { id: "c2", type: "update-slide-layout", slideId, layout: "cover" },
            ],
            risk: "low",
          },
        }],
      },
      {
        toolCalls: [{
          type: "tool_use",
          id: "call-2",
          name: "SubmitCommands",
          input: {
            summary: "Visual review passed",
            commands: [
              { id: "c3", type: "set-design-system", designSystem: TEST_DESIGN_SYSTEM },
            ],
            risk: "low",
          },
        }],
      },
    ]);

    const runtime = new AgentRuntime(registry, gateway);
    const progressEvents: string[] = [];

    const result = await runtime.run({
      threadId: "render-feedback-thread",
      request: "执行标准排版",
      presentationSnapshot: presentation,
      currentSlideId: slideId,
      selectedElementIds: [],
      stageHint: "style",
      onProgress: (event) => {
        if (event.type === "render-feedback" || event.type === "render-feedback-ready") {
          progressEvents.push(event.type);
        }
      },
    });

    expect(progressEvents).toEqual(["render-feedback", "render-feedback-ready"]);
    expect(gateway.requests.length).toBe(2);
    expect(result.type).toBe("command_proposal");
    if (result.type === "command_proposal") {
      expect(result.summary).toBe("Visual review passed");
    }

    const feedbackTurn = gateway.requests[1];
    const feedbackBlock = feedbackTurn.messages
      ?.flatMap((message) => message.content)
      .find((block) => block.type === "tool_result" && block.content.some((entry) =>
        entry.type === "text" && entry.text.includes("排版视觉反馈")));
    expect(feedbackBlock?.type).toBe("tool_result");
  });
});
