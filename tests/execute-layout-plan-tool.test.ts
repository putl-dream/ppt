import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { executeLayoutPlanTool } from "../src/main/agent/tools/core/execute-layout-plan";
import { submitCommandsTool } from "../src/main/agent/tools/core/submit-commands";
import { AgentRuntime } from "../src/main/agent/runtime/agent-runtime";
import { applyCommandsToDraft } from "../src/main/agent/runtime/presentation/layout-command-utils";
import type { AgentModelGateway } from "../src/main/agent/gateway";
import type { ToolContext } from "../src/main/agent/tools/tool-definition";
import { ToolRegistry } from "../src/main/agent/tools/tool-registry";
import type { Presentation } from "../src/shared/presentation";
import type { LayoutPlan } from "../src/shared/layout-plan";
import { TEST_DESIGN_SYSTEM } from "./design-engine-test-utils";

const TINY_PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2n1cAAAAASUVORK5CYII=";
const TINY_GIF_DATA_URL =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

function makePresentation(slideIds: string[]): Presentation {
  return {
    id: "deck-1",
    title: "Deck",
    revision: 1,
    designSystem: TEST_DESIGN_SYSTEM,
    slides: slideIds.map((id, index) => ({
      id,
      title: `Slide ${index + 1}`,
      elements: [
        {
          id: `${id}-title`,
          type: "text",
          x: 120,
          y: 100,
          width: 800,
          height: 80,
          text: `Slide ${index + 1}`,
          fontSize: 44,
        },
        {
          id: `${id}-body`,
          type: "text",
          x: 120,
          y: 220,
          width: 600,
          height: 120,
          text: `Evidence narrative ${index + 1}`,
          fontSize: 22,
        },
        {
          id: `${id}-metric`,
          type: "text",
          x: 120,
          y: 380,
          width: 300,
          height: 100,
          text: `${index + 1}00%`,
          fontSize: 36,
          textRole: "metric",
        },
      ],
    })),
  };
}

function roleForLayout(
  layout: LayoutPlan["slides"][number]["layout"],
): LayoutPlan["slides"][number]["narrativeRole"] {
  if (layout === "cover") return "cover";
  if (layout === "toc") return "toc";
  if (layout === "section") return "section";
  if (layout === "summary") return "summary";
  if (layout === "comparison") return "comparison";
  if (layout === "case" || layout === "process") return "data";
  if (layout === "quote") return "quote";
  return "content";
}

function makePlan(
  slideIds: string[],
  layouts: Array<LayoutPlan["slides"][number]["layout"]>,
): LayoutPlan {
  return {
    version: 2,
    communicationContract: {
      audience: "Test audience",
      objective: "Verify layout-plan execution",
      desiredOutcome: "Produce a correctly laid out deck",
      coreMessage: "Layout and imagery must form one composition",
      deliveryContext: "Automated unit test",
      afterUse: "Review the rendered slides",
    },
    selectionSource: "user-locked",
    directions: [{
      id: "test-direction",
      tier: "locked",
      label: "Test direction",
      rationale: "Deterministic visual direction for layout tests.",
      designSystem: TEST_DESIGN_SYSTEM,
    }],
    selectedDirectionId: "test-direction",
    slides: slideIds.map((slideId, index) => ({
      slideId,
      title: `Slide ${index + 1}`,
      narrativeRole: roleForLayout(layouts[index] ?? "concept"),
      audienceMove: "Understand the slide's main point",
      rhythm: index === 0 ? "anchor" : "breathing",
      layoutIntent: "Express the content with a clear hierarchy",
      layout: layouts[index] ?? "concept",
      slideVariant: index === 0 ? "hero" : index % 2 === 0 ? "dark" : "light",
      rationale: "Test layout decision.",
      enhancements: [],
    })),
  };
}

async function writePlan(workspaceRoot: string, plan: LayoutPlan): Promise<void> {
  await mkdir(join(workspaceRoot, "slides"), { recursive: true });
  await writeFile(join(workspaceRoot, "slides", "layout-plan.json"), JSON.stringify(plan, null, 2), "utf8");
}

function makeContext(workspaceRoot: string, presentation: Presentation): ToolContext {
  return {
    presentation,
    selectedElementIds: [],
    discoverySession: { discoveredToolNames: new Set() },
    registry: new ToolRegistry(),
    messageHistory: [],
    workspaceRoot,
  };
}

function modelToolCall(toolName: string, args: Record<string, unknown> = {}) {
  return { type: "tool_use" as const, id: crypto.randomUUID(), name: toolName, input: args };
}

function createSequenceGateway(responses: ReturnType<typeof modelToolCall>[]): AgentModelGateway {
  let index = 0;
  return {
    async generateText() {
      const value = responses[index++];
      if (value === undefined) throw new Error("Unexpected gateway call");
      return {
        provider: "anthropic",
        model: "test-model",
        content: [value],
      };
    },
    async *generateTextStream() {
      const value = responses[index++];
      if (value === undefined) throw new Error("Unexpected gateway call");
      yield { type: "complete" as const, content: [value] };
    },
  };
}

describe("ExecuteLayoutPlan", () => {
  it("reads layout-plan and builds design, layout, and variant commands", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "ppt-layout-plan-"));
    const presentation = makePresentation(["slide-1", "slide-2", "slide-3"]);
    await writePlan(workspaceRoot, makePlan(
      ["slide-1", "slide-2", "slide-3"],
      ["cover", "concept", "summary"],
    ));

    const result = await executeLayoutPlanTool.execute({}, makeContext(workspaceRoot, presentation));

    if (!("type" in result) || result.type !== "command_proposal") {
      throw new Error(`Expected command proposal, received: ${JSON.stringify(result)}`);
    }
    expect(result.type).toBe("command_proposal");
    expect(result.commands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "set-design-system" }),
        expect.objectContaining({ type: "update-slide-layout", slideId: "slide-1", layout: "cover" }),
        expect.objectContaining({ type: "update-slide-variant", slideId: "slide-1", slideVariant: "hero" }),
      ]),
    );
  });

  it("compiles insert-image enhancements into the same command proposal", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "ppt-layout-plan-image-"));
    const presentation = makePresentation(["slide-1"]);
    const plan = makePlan(["slide-1"], ["case"]);
    plan.slides[0].grammarVariant = "evidence";
    plan.slides[0].enhancements = [{
      type: "insert-image",
      slot: "side",
      url: TINY_PNG_DATA_URL,
      description: "Evidence image",
    }];
    await writePlan(workspaceRoot, plan);

    const result = await executeLayoutPlanTool.execute({}, makeContext(workspaceRoot, presentation));

    if (!("type" in result) || result.type !== "command_proposal") {
      throw new Error(`Expected command proposal, received: ${JSON.stringify(result)}`);
    }
    expect(result.type).toBe("command_proposal");
    expect(result.commands).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "update-slide-layout", grammarVariant: "evidence" }),
      expect.objectContaining({
        type: "restore-slide",
        slide: expect.objectContaining({ id: "slide-1", grammarVariant: "evidence" }),
      }),
    ]));
    const finalSlide = applyCommandsToDraft(presentation, result.commands).slides[0]!;
    const image = finalSlide.elements.find((element) => element.type === "image");
    expect(image).toMatchObject({
      type: "image",
      imageSlot: "side",
    });
    expect(image?.x).toBeGreaterThanOrEqual(120);
    expect(image?.width).toBeGreaterThan(500);
    expect(image?.height).toBeGreaterThan(350);
    expect(result.assumptions).toEqual(expect.arrayContaining([
      expect.stringContaining("insert-image enhancement"),
    ]));
  });

  it("reflows editorial-hero after inserting the planned hero image", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "ppt-layout-plan-editorial-hero-"));
    const presentation = makePresentation(["slide-1"]);
    const plan = makePlan(["slide-1"], ["cover"]);
    plan.slides[0].grammarVariant = "editorial-hero";
    plan.slides[0].enhancements = [{
      type: "insert-image",
      slot: "hero",
      url: TINY_PNG_DATA_URL,
      description: "Editorial hero",
    }];
    await writePlan(workspaceRoot, plan);

    const result = await executeLayoutPlanTool.execute({}, makeContext(workspaceRoot, presentation));
    if (!("type" in result) || result.type !== "command_proposal") {
      throw new Error(`Expected command proposal, received: ${JSON.stringify(result)}`);
    }

    const finalSlide = applyCommandsToDraft(presentation, result.commands).slides[0]!;
    const image = finalSlide.elements.find((element) => element.type === "image");
    const title = finalSlide.elements.find(
      (element) => element.type === "text" && element.id === "slide-1-title",
    );
    expect(image).toMatchObject({
      type: "image",
      imageSlot: "hero",
      x: 768,
      y: 152,
      width: 332,
      height: 392,
    });
    expect(title).toMatchObject({ type: "text", width: 560 });
  });

  it("uses image-grid grammar slots instead of the old fixed four-up geometry", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "ppt-layout-plan-image-grid-"));
    const presentation = makePresentation(["slide-1"]);
    const plan = makePlan(["slide-1"], ["image-grid"]);
    plan.slides[0].grammarVariant = "grid";
    plan.slides[0].enhancements = [
      {
        type: "insert-image",
        slot: "grid-0",
        url: TINY_PNG_DATA_URL,
        description: "Primary image",
      },
      {
        type: "insert-image",
        slot: "grid-1",
        url: TINY_GIF_DATA_URL,
        description: "Secondary image",
      },
    ];
    await writePlan(workspaceRoot, plan);

    const result = await executeLayoutPlanTool.execute({}, makeContext(workspaceRoot, presentation));
    if (!("type" in result) || result.type !== "command_proposal") {
      throw new Error(`Expected command proposal, received: ${JSON.stringify(result)}`);
    }

    const finalSlide = applyCommandsToDraft(presentation, result.commands).slides[0]!;
    const images = finalSlide.elements
      .filter((element) => element.type === "image")
      .sort((left, right) => (left.imageSlot ?? "").localeCompare(right.imageSlot ?? ""));
    expect(images.map((image) => image.imageSlot)).toEqual(["grid-0", "grid-1"]);
    expect(images[0]?.x).toBeLessThan(images[1]?.x ?? 0);
    expect(images[0]?.y).toBe(images[1]?.y);
    expect(images[0]?.width).toBe(images[1]?.width);
    expect(images[0]?.height).toBe(images[1]?.height);
    expect(images[0]?.width).toBeGreaterThan(400);
  });

  it("blocks execution when layout-plan slide ids do not match the snapshot", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "ppt-layout-plan-"));
    const presentation = makePresentation(["slide-1", "slide-2"]);
    await writePlan(workspaceRoot, makePlan(
      ["slide-1", "slide-x"],
      ["cover", "summary"],
    ));

    const result = await executeLayoutPlanTool.execute({}, makeContext(workspaceRoot, presentation));

    expect("success" in result && result.success).toBe(false);
    if (!("success" in result)) throw new Error("Expected validation failure");
    expect(result.issues.some((issue) => issue.severity === "error" && issue.message.includes("slide-x")))
      .toBe(true);
  });

  it("allows but warns on eight unique layouts in document mode", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "ppt-layout-plan-"));
    const slideIds = Array.from({ length: 8 }, (_, index) => `slide-${index + 1}`);
    const presentation = makePresentation(slideIds);
    await writePlan(workspaceRoot, makePlan(
      slideIds,
      ["cover", "toc", "section", "concept", "comparison", "process", "quote", "summary"],
    ));

    const result = await executeLayoutPlanTool.execute({}, makeContext(workspaceRoot, presentation));

    expect("type" in result ? result.type : undefined).toBe("command_proposal");
    if (!("type" in result) || result.type !== "command_proposal") {
      throw new Error("Expected command proposal");
    }
    expect(result.summary).toContain("warning/info");
  });

  it("blocks three consecutive identical layouts", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "ppt-layout-plan-"));
    const slideIds = ["slide-1", "slide-2", "slide-3", "slide-4", "slide-5"];
    const presentation = makePresentation(slideIds);
    await writePlan(workspaceRoot, makePlan(
      slideIds,
      ["cover", "concept", "concept", "concept", "summary"],
    ));

    const result = await executeLayoutPlanTool.execute({}, makeContext(workspaceRoot, presentation));

    expect("success" in result && result.success).toBe(false);
    if (!("success" in result)) throw new Error("Expected validation failure");
    expect(result.issues.some((issue) => issue.severity === "error" && issue.message.includes("consecutive")))
      .toBe(true);
  });

  it("lets the main agent consume a short Task conclusion by executing the file-backed plan", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "ppt-layout-plan-"));
    const presentation = makePresentation(["slide-1", "slide-2", "slide-3"]);
    await writePlan(workspaceRoot, makePlan(
      ["slide-1", "slide-2", "slide-3"],
      ["cover", "concept", "summary"],
    ));

    const proposal = await executeLayoutPlanTool.execute(
      { path: "slides/layout-plan.json" },
      makeContext(workspaceRoot, presentation),
    );
    if (!("type" in proposal) || proposal.type !== "command_proposal") {
      throw new Error("Expected the file-backed plan to compile into a command proposal");
    }

    const registry = new ToolRegistry();
    registry.register(executeLayoutPlanTool);
    registry.register(submitCommandsTool);
    const runtime = new AgentRuntime(registry, createSequenceGateway([
      modelToolCall("ExecuteLayoutPlan", { path: "slides/layout-plan.json" }),
      modelToolCall("SubmitCommands", {
        summary: `${proposal.summary}（已检查视觉反馈）`,
        commands: proposal.commands,
        risk: proposal.risk,
        assumptions: proposal.assumptions,
      }),
    ]));

    const result = await runtime.run({
      threadId: "execute-layout-plan-runtime",
      request: "Task 只返回 slides/layout-plan.json，共 3 种 layout；继续执行。",
      presentationSnapshot: presentation,
      selectedElementIds: [],
      workspaceRoot,
      stageHint: "author",
    });

    expect(result.type).toBe("command_proposal");
    if (result.type === "command_proposal") {
      expect(result.commands.some((command) => command.type === "update-slide-layout")).toBe(true);
    }
  });
});
