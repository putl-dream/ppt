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
import {
  requestExplicitlyAllowsContentOnly,
} from "../src/main/agent/runtime/presentation/presentation-completion-policy";
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
      { id: "c1", type: "set-design-system", designSystem: testDesignSystem({ colorScheme: "warm-paper" }) },
    ]);
    expect(collectAffectedSlideIds([
      { id: "c1", type: "set-design-system", designSystem: testDesignSystem({ colorScheme: "warm-paper" }) },
    ], draft)).toEqual([slideId]);
  });
});

describe("render-feedback-loop", () => {
  it("only treats explicit content-only wording as permission to skip design", () => {
    expect(requestExplicitlyAllowsContentOnly("只要内容草稿，暂时不要排版")).toBe(true);
    expect(requestExplicitlyAllowsContentOnly("Create a content-only deck")).toBe(true);
    expect(requestExplicitlyAllowsContentOnly("创建完整 PPT，不要让我选择排版类型")).toBe(false);
    expect(requestExplicitlyAllowsContentOnly("创建内容并自动完成视觉设计")).toBe(false);
  });

  it("offers feedback once for actual visual commands regardless of stage hint", () => {
    const commands: PresentationCommand[] = [
      { id: "c1", type: "update-slide-layout", slideId: "s1", layout: "cover" },
    ];
    expect(shouldOfferRenderFeedback("style", commands, false)).toBe(true);
    expect(shouldOfferRenderFeedback("style", commands, true)).toBe(false);
    expect(shouldOfferRenderFeedback("author", commands, false)).toBe(true);
    expect(shouldOfferRenderFeedback("style", [
      { id: "c2", type: "set-presentation-title", title: "Title" },
    ], false)).toBe(false);
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
        designSystem: testDesignSystem({ colorScheme: "warm-paper" }),
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
  it("rejects default creation through the legacy element/layout submit route", async () => {
    const registry = createDefaultToolRegistry();
    const presentation = { ...makePresentation(), slides: [] };
    const slide = {
      id: "new-slide",
      title: "核心观点",
      layout: "concept" as const,
      elements: [{
        id: "new-slide-body",
        type: "text" as const,
        x: 0,
        y: 0,
        width: 400,
        height: 80,
        text: "默认创建必须完成视觉排版",
        fontSize: 24,
      }],
    };
    const contentOnlyCommands: PresentationCommand[] = [{
      id: "add-slide",
      type: "add-slide",
      index: 0,
      slide,
    }];
    const gateway = createNativeGateway([
      {
        toolCalls: [{
          type: "tool_use",
          id: "call-legacy-create",
          name: "SubmitCommands",
          input: {
            summary: "创建完整演示",
            commands: contentOnlyCommands,
            risk: "low",
          },
        }],
      },
      { text: "旧 element/layout 创建路线已被拒绝，必须改走完整 SVG 工作流。" },
    ]);

    const result = await new AgentRuntime(registry, gateway).run({
      threadId: "create-with-design-thread",
      request: "创建一页完整 PPT",
      presentationSnapshot: presentation,
      selectedElementIds: [],
    });

    expect(gateway.requests).toHaveLength(2);
    const rejection = gateway.requests[1]?.messages
      ?.flatMap((message) => message.content)
      .find((block) => block.type === "tool_result" && block.content.some((entry) =>
        entry.type === "text" && entry.text.includes("SubmitSvgDeck")));
    expect(rejection?.type).toBe("tool_result");
    expect(result).toEqual({
      type: "message",
      content: "旧 element/layout 创建路线已被拒绝，必须改走完整 SVG 工作流。",
    });
  });

  it("allows an explicitly requested content-only proposal to finish", async () => {
    const registry = createDefaultToolRegistry();
    const presentation = { ...makePresentation(), slides: [] };
    const gateway = createNativeGateway([{
      toolCalls: [{
        type: "tool_use",
        id: "call-content-only",
        name: "SubmitCommands",
        input: {
          summary: "只创建内容草稿",
          commands: [{
            id: "add-content-slide",
            type: "add-slide",
            index: 0,
            slide: {
              id: "content-slide",
              title: "内容草稿",
              layout: "concept",
              elements: [{
                id: "content-body",
                type: "text",
                x: 0,
                y: 0,
                width: 400,
                height: 80,
                text: "仅包含内容",
                fontSize: 24,
              }],
            },
          }],
          risk: "low",
        },
      }],
    }]);

    const result = await new AgentRuntime(registry, gateway).run({
      threadId: "content-only-thread",
      request: "只要内容草稿，暂时不要排版",
      presentationSnapshot: presentation,
      selectedElementIds: [],
    });

    expect(gateway.requests).toHaveLength(1);
    expect(result.type).toBe("command_proposal");
  });

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
      request: "执行已确认的设计方向",
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
