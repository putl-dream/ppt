import { describe, expect, it } from "vitest";
import { createDefaultToolRegistry, ToolRegistry } from "../src/main/agent/tools/tool-registry";
import { askUserTool } from "../src/main/agent/tools/core/ask-user";
import { searchExtraToolsTool } from "../src/main/agent/tools/core/search-extra-tools";
import { executeExtraToolTool } from "../src/main/agent/tools/core/execute-extra-tool";
import { getSelectionTool } from "../src/main/agent/tools/core/get-selection";
import { listSlidesTool } from "../src/main/agent/tools/core/list-slides";
import { previewCommandsTool } from "../src/main/agent/tools/core/preview-commands";
import { readCurrentSlideTool } from "../src/main/agent/tools/core/read-current-slide";
import { readPresentationSnapshotTool } from "../src/main/agent/tools/core/read-presentation-snapshot";
import { submitCommandsTool } from "../src/main/agent/tools/core/submit-commands";
import { analyzeDeckConsistencyTool } from "../src/main/agent/tools/deferred/analyze-deck-consistency";
import { applyThemeStyleTool } from "../src/main/agent/tools/deferred/apply-theme-style";
import { autoLayoutSlideTool } from "../src/main/agent/tools/deferred/auto-layout-slide";
import { beautifyChartTool } from "../src/main/agent/tools/deferred/beautify-chart";
import { beautifyTableTool } from "../src/main/agent/tools/deferred/beautify-table";
import { compressTextTool } from "../src/main/agent/tools/deferred/compress-text";
import { detectOverflowTextTool } from "../src/main/agent/tools/deferred/detect-overflow-text";
import { detectRepeatedTitlesTool } from "../src/main/agent/tools/deferred/detect-repeated-titles";
import { exportPptxTool } from "../src/main/agent/tools/deferred/export-pptx";
import { rewriteSlideContentTool } from "../src/main/agent/tools/deferred/rewrite-slide-content";
import { selectStyleStrategyTool } from "../src/main/agent/tools/deferred/select-style-strategy";
import { toToolCard } from "../src/main/agent/tools/tool-card";
import { ToolLoader } from "../src/main/agent/tools/tool-loader";
import { SystemPromptBuilder } from "../src/main/agent/runtime/system-prompt";
import { RuntimeNormalizer } from "../src/main/agent/runtime/runtime-normalizer";
import { AgentRuntime } from "../src/main/agent/runtime/agent-runtime";
import { CommitGate } from "../src/main/agent/gate/commit-gate";
import { RiskPolicy } from "../src/main/agent/gate/risk-policy";
import { DesignPolicy } from "../src/main/agent/design/design-policy";
import { LayoutPolicy } from "../src/main/agent/design/layout-policy";
import { RefactoredAgentService } from "../src/main/agent/service";
import { createStarterPresentation } from "../src/shared/presentation";
import { CommandBus } from "../src/shared/commands";
import type { AgentModelGateway } from "../src/main/agent/gateway";

function createSequenceGateway(responses: unknown[]): AgentModelGateway {
  let index = 0;
  return {
    async generateText() {
      const value = responses[index++];
      if (value === undefined) throw new Error("Unexpected gateway call");
      return {
        provider: "openai",
        model: "test-model",
        text: JSON.stringify(value),
      };
    },
  };
}

describe("Agent Architecture Skeletons & Types", () => {
  it("creates the production registry with Core and Deferred Tools", () => {
    const registry = createDefaultToolRegistry();
    expect(registry.get("ReadPresentationSnapshot")?.loadPolicy).toBe("core");
    expect(registry.get("AutoLayoutSlide")?.loadPolicy).toBe("deferred");
    expect(registry.getCoreTools().length).toBeGreaterThan(0);
    expect(registry.getDeferredTools().length).toBeGreaterThan(0);
  });

  it("ToolRegistry can register and retrieve tools by category", () => {
    const registry = new ToolRegistry();
    
    // Register Core Tools
    registry.register(askUserTool);
    registry.register(searchExtraToolsTool);
    registry.register(executeExtraToolTool);
    registry.register(getSelectionTool);
    registry.register(listSlidesTool);
    registry.register(previewCommandsTool);
    registry.register(readCurrentSlideTool);
    registry.register(readPresentationSnapshotTool);
    registry.register(submitCommandsTool);

    // Register Deferred Tools
    registry.register(analyzeDeckConsistencyTool);
    registry.register(applyThemeStyleTool);
    registry.register(autoLayoutSlideTool);
    registry.register(beautifyChartTool);
    registry.register(beautifyTableTool);
    registry.register(compressTextTool);
    registry.register(detectOverflowTextTool);
    registry.register(detectRepeatedTitlesTool);
    registry.register(exportPptxTool);
    registry.register(rewriteSlideContentTool);
    registry.register(selectStyleStrategyTool);

    // Assertions
    expect(registry.get("AskUser")).toBe(askUserTool);
    expect(registry.getCoreTools()).toContain(askUserTool);
    expect(registry.getCoreTools()).not.toContain(autoLayoutSlideTool);
    expect(registry.getDeferredTools()).toContain(autoLayoutSlideTool);
    expect(registry.getDeferredTools()).not.toContain(askUserTool);

    // Registry search
    const results = registry.searchDeferredTools("consistency");
    expect(results.map(r => r.name)).toContain("AnalyzeDeckConsistency");
    expect(registry.searchDeferredTools("select:AutoLayoutSlide DetectRepeatedTitles").map(r => r.name))
      .toEqual(expect.arrayContaining(["AutoLayoutSlide", "DetectRepeatedTitles"]));
  });

  it("toToolCard converts complete tool definitions to model-visible summaries", () => {
    const card = toToolCard(autoLayoutSlideTool);
    expect(card.name).toBe("AutoLayoutSlide");
    expect(card.risk).toBe("medium");
    expect(card.approvalRequired).toBe(true);
    expect(card.parameterSummary).toHaveProperty("slideId");
    expect(card.parameterSummary).toHaveProperty("layout");
  });

  it("ToolLoader classifies tools correctly", () => {
    const allTools = [askUserTool, autoLayoutSlideTool];
    const core = ToolLoader.loadCoreTools(allTools);
    const deferred = ToolLoader.loadDeferredTools(allTools);

    expect(core).toContain(askUserTool);
    expect(core).not.toContain(autoLayoutSlideTool);
    expect(deferred).toContain(autoLayoutSlideTool);
    expect(deferred).not.toContain(askUserTool);
  });

  it("SystemPromptBuilder builds prompt containing core tools description", () => {
    const prompt = SystemPromptBuilder.build({
      coreTools: [askUserTool],
      currentSlideId: "slide-123",
    });
    
    expect(prompt).toContain("AskUser");
    expect(prompt).toContain("slide-123");
  });

  it("RuntimeNormalizer validates response schemas", () => {
    // Correct message response
    const res1 = RuntimeNormalizer.normalize({
      type: "message",
      content: "Hello!",
    });
    expect(res1.type).toBe("message");

    // Correct ask_user response
    const res2 = RuntimeNormalizer.normalize({
      type: "ask_user",
      message: "Need input",
      missingFields: ["theme"],
    });
    expect(res2.type).toBe("ask_user");

    // Correct command_proposal response
    const res3 = RuntimeNormalizer.normalize({
      type: "command_proposal",
      summary: "Update title",
      commands: [{ id: "1", type: "set-presentation-title", title: "New" }],
      risk: "low",
    });
    expect(res3.type).toBe("command_proposal");

    // Rejects invalid types
    expect(() => RuntimeNormalizer.normalize({ type: "invalid" })).toThrow();
    // Rejects invalid risk level
    expect(() => RuntimeNormalizer.normalize({
      type: "command_proposal",
      summary: "Bad risk",
      commands: [],
      risk: "very-high",
    })).toThrow();
  });

  it("AgentRuntime executes a Gateway-driven Core Tool loop", async () => {
    const registry = new ToolRegistry();
    registry.register(readPresentationSnapshotTool);
    registry.register(submitCommandsTool);
    const runtime = new AgentRuntime(registry, createSequenceGateway([
      { type: "tool_call", toolName: "ReadPresentationSnapshot", args: {} },
      {
        type: "tool_call",
        toolName: "SubmitCommands",
        args: {
          summary: "Update title",
          commands: [{ id: "cmd-runtime", type: "set-presentation-title", title: "Runtime title" }],
          risk: "low",
          assumptions: ["Only the title changes"],
        },
      },
    ]));
    const presentation = createStarterPresentation();

    const result = await runtime.run({
      threadId: "test-thread",
      request: "Create title",
      presentationSnapshot: presentation,
      selectedElementIds: [],
    });

    expect(result.type).toBe("command_proposal");
    if (result.type === "command_proposal") {
      expect(result.commands.length).toBeGreaterThan(0);
      expect(result.commands[0].type).toBe("set-presentation-title");
      expect(result.assumptions).toEqual(["Only the title changes"]);
    }
  });

  it("requires Deferred Tools to be discovered in the same session before execution", async () => {
    const registry = new ToolRegistry();
    registry.register(searchExtraToolsTool);
    registry.register(executeExtraToolTool);
    registry.register(detectRepeatedTitlesTool);
    const context = {
      presentation: createStarterPresentation(),
      selectedElementIds: [],
      discoverySession: { discoveredToolNames: new Set<string>() },
      registry,
      messageHistory: [],
    };

    await expect(executeExtraToolTool.execute({
      toolName: "DetectRepeatedTitles",
      toolArgs: {},
    }, context)).rejects.toThrow("has not been discovered");

    const search = await searchExtraToolsTool.execute({ query: "DetectRepeatedTitles" }, context);
    expect(search.tools.map((tool) => tool.name)).toContain("DetectRepeatedTitles");
    const execution = await executeExtraToolTool.execute({
      toolName: "DetectRepeatedTitles",
      toolArgs: {},
    }, context);
    expect(execution.toolName).toBe("DetectRepeatedTitles");
  });

  it("CommitGate and RiskPolicy correctly filter and validate commands", async () => {
    const riskPolicy = new RiskPolicy();
    const gate = new CommitGate(riskPolicy);
    const presentation = createStarterPresentation();

    // Valid commands
    const result1 = await gate.evaluate(
      presentation,
      [{ id: "cmd-1", type: "set-presentation-title", title: "Title A" }],
      "low"
    );

    expect(result1.success).toBe(true);
    expect(result1.diff).toBeDefined();
    expect(result1.diff?.titleChanged).toBe(true);
    expect(result1.risk).toBe("low");
    expect(result1.decision).toBe("AUTO");

    // Destructive commands should elevate risk to high & require approval
    const result2 = await gate.evaluate(
      presentation,
      [{ id: "cmd-2", type: "remove-slide", slideId: presentation.slides[0].id }],
      "low"
    );

    expect(result2.success).toBe(true);
    expect(result2.risk).toBe("high");
    expect(result2.decision).toBe("REQUIRES_APPROVAL");

    // Invalid commands structure should fail validation
    const result3 = await gate.evaluate(
      presentation,
      [{ id: "cmd-3", type: "invalid-type" } as any],
      "low"
    );

    expect(result3.success).toBe(false);
    expect(result3.errors.length).toBeGreaterThan(0);
  });

  it("DesignPolicy checks semantic conservation rules", () => {
    const policy = new DesignPolicy();
    const before = createStarterPresentation();
    const after = createStarterPresentation();
    
    // Valid case: no text removal
    const check1 = policy.validate(before, after);
    expect(check1.valid).toBe(true);

    // Invalid case: removing too much text (violates semantic conservation rule)
    after.slides[0].elements = []; // clear elements
    const check2 = policy.validate(before, after);
    expect(check2.valid).toBe(false);
    expect(check2.errors[0]).toContain("语义保持校验");
  });

  it("LayoutPolicy checks overlap and safety zones", () => {
    const elementA = { id: "a", type: "text" as const, x: 50, y: 50, width: 100, height: 100 };
    const elementB = { id: "b", type: "text" as const, x: 80, y: 80, width: 100, height: 100 };
    const elementC = { id: "c", type: "text" as const, x: 200, y: 200, width: 50, height: 50 };

    expect(LayoutPolicy.isOverlapping(elementA, elementB)).toBe(true);
    expect(LayoutPolicy.isOverlapping(elementA, elementC)).toBe(false);

    // safe margins check: size 1280x720, margin 40
    expect(LayoutPolicy.isWithinSafeZone({ x: 10, y: 10, width: 100, height: 100 })).toBe(false);
    expect(LayoutPolicy.isWithinSafeZone({ x: 50, y: 50, width: 100, height: 100 })).toBe(true);
  });

  it("REQUEST_APPROVAL pauses and applies commands only after resume", async () => {
    const registry = new ToolRegistry();
    registry.register(askUserTool);
    registry.register(submitCommandsTool);

    const runtime = new AgentRuntime(registry, createSequenceGateway([{
      type: "tool_call",
      toolName: "SubmitCommands",
      args: {
        summary: "Update title",
        commands: [{ id: "cmd-service", type: "set-presentation-title", title: "Approved title" }],
        risk: "low",
      },
    }]));
    const riskPolicy = new RiskPolicy();
    const commitGate = new CommitGate(riskPolicy);
    const presentation = createStarterPresentation();
    const bus = new CommandBus(presentation);

    const service = new RefactoredAgentService(bus, runtime, commitGate);
    const result = await service.start("Make a title presentation", undefined, "REQUEST_APPROVAL");

    expect(result.status).toBe("approval-required");
    expect(bus.getSnapshot().title).toBe(presentation.title);
    if (result.status !== "approval-required") throw new Error("Expected approval");
    const completed = await service.resume(result.approval.threadId, true);
    expect(completed.status).toBe("completed");
    expect(bus.getSnapshot().title).toBe("Approved title");
  });

  it("AUTO applies only low-risk proposals", async () => {
    const registry = new ToolRegistry();
    registry.register(submitCommandsTool);
    const runtime = new AgentRuntime(registry, createSequenceGateway([{
      type: "tool_call",
      toolName: "SubmitCommands",
      args: {
        summary: "Update title",
        commands: [{ id: "cmd-auto", type: "set-presentation-title", title: "Auto title" }],
        risk: "low",
      },
    }]));
    const bus = new CommandBus(createStarterPresentation());
    const service = new RefactoredAgentService(bus, runtime, new CommitGate(new RiskPolicy()));
    const result = await service.start("Update title", undefined, "AUTO");
    expect(result.status).toBe("completed");
    expect(bus.getSnapshot().title).toBe("Auto title");
  });

  it("rejects an approved proposal when the presentation changed after preview", async () => {
    const registry = new ToolRegistry();
    registry.register(submitCommandsTool);
    const runtime = new AgentRuntime(registry, createSequenceGateway([{
      type: "tool_call",
      toolName: "SubmitCommands",
      args: {
        summary: "Update title",
        commands: [{ id: "cmd-stale", type: "set-presentation-title", title: "Stale title" }],
        risk: "low",
      },
    }]));
    const bus = new CommandBus(createStarterPresentation());
    const service = new RefactoredAgentService(bus, runtime, new CommitGate(new RiskPolicy()));
    const result = await service.start("Update title", undefined, "REQUEST_APPROVAL");
    if (result.status !== "approval-required") throw new Error("Expected approval");
    bus.execute({ id: "external-change", type: "set-presentation-title", title: "Newer title" });

    await expect(service.resume(result.approval.threadId, true)).rejects.toThrow(
      "changed after preview",
    );
    expect(bus.getSnapshot().title).toBe("Newer title");
  });
});
