import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { executeLayoutPlanTool } from "../src/main/agent/tools/core/execute-layout-plan";
import { AgentRuntime } from "../src/main/agent/runtime/agent-runtime";
import type { AgentModelGateway } from "../src/main/agent/gateway";
import type { ToolContext } from "../src/main/agent/tools/tool-definition";
import { ToolRegistry } from "../src/main/agent/tools/tool-registry";
import type { Presentation } from "../src/shared/presentation";
import type { LayoutPlan } from "../src/shared/layout-plan";
import { TEST_DESIGN_SYSTEM, testDesignSystem } from "./design-engine-test-utils";

function makePresentation(slideIds: string[]): Presentation {
  return {
    id: "deck-1",
    title: "Deck",
    revision: 1,
    designSystem: TEST_DESIGN_SYSTEM,
    slides: slideIds.map((id, index) => ({
      id,
      title: `Slide ${index + 1}`,
      elements: [],
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
    version: 1,
    styleMode: "creative",
    designSystem: testDesignSystem({ palette: "warm-paper" }),
    slides: slideIds.map((slideId, index) => ({
      slideId,
      title: `Slide ${index + 1}`,
      narrativeRole: roleForLayout(layouts[index] ?? "concept"),
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

    expect("type" in result ? result.type : undefined).toBe("command_proposal");
    if (!("type" in result) || result.type !== "command_proposal") {
      throw new Error("Expected command proposal");
    }
    expect(result.commands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "set-design-system" }),
        expect.objectContaining({ type: "update-slide-layout", slideId: "slide-1", layout: "cover" }),
        expect.objectContaining({ type: "update-slide-variant", slideId: "slide-1", slideVariant: "hero" }),
      ]),
    );
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

    const registry = new ToolRegistry();
    registry.register(executeLayoutPlanTool);
    const runtime = new AgentRuntime(registry, createSequenceGateway([
      modelToolCall("ExecuteLayoutPlan", { path: "slides/layout-plan.json" }),
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
