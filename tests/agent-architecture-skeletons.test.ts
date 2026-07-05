import { describe, expect, it, vi } from "vitest";
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
import { previewSlideTool } from "../src/main/agent/tools/deferred/preview-slide";
import { validateDeckLayoutTool } from "../src/main/agent/tools/deferred/validate-deck-layout";
import { rewriteSlideContentTool } from "../src/main/agent/tools/deferred/rewrite-slide-content";
import { selectStyleStrategyTool } from "../src/main/agent/tools/deferred/select-style-strategy";
import { toToolCard } from "../src/main/agent/tools/tool-card";
import { ToolLoader } from "../src/main/agent/tools/tool-loader";
import { SystemPromptBuilder } from "../src/main/agent/runtime/system-prompt";
import { normalizeAgentProtocolObject } from "../src/main/agent/runtime/agent-message-normalizer";
import {
  AgentRuntime,
  parseAgentJsonResponse,
} from "../src/main/agent/runtime/agent-runtime";
import { CommitGate } from "../src/main/agent/gate/commit-gate";
import { RiskPolicy } from "../src/main/agent/gate/risk-policy";
import { DesignPolicy } from "../src/main/agent/design/design-policy";
import { LayoutPolicy } from "../src/main/agent/design/layout-policy";
import { AgentService } from "../src/main/agent/service";
import { createStarterPresentation } from "../src/shared/presentation";
import { CommandBus } from "../src/shared/commands";
import { AgentGatewayError, type AgentModelGateway } from "../src/main/agent/gateway";

function createSequenceGateway(responses: unknown[]): AgentModelGateway {
  let index = 0;
  return {
    async generateText() {
      const value = responses[index++];
      if (value === undefined) throw new Error("Unexpected gateway call");
      if (value instanceof Error) throw value;
      return {
        provider: "openai",
        model: "test-model",
        text: typeof value === "string" ? value : JSON.stringify(value),
      };
    },
    async *generateTextStream() {
      const value = responses[index++];
      if (value === undefined) throw new Error("Unexpected gateway call");
      if (value instanceof Error) throw value;
      const text = typeof value === "string" ? value : JSON.stringify(value);
      yield { type: "content" as const, text };
      yield { type: "complete" as const, text: "" };
    },
  };
}

function modelToolCall(toolName: string, args: Record<string, unknown> = {}) {
  return { type: "tool.call", data: { toolName, args } };
}

function modelMessage(content: string) {
  return {
    kind: "text",
    format: "markdown",
    type: "assistant.message",
    data: { content },
  };
}

function modelAskUser(content: string, missingFields?: string[]) {
  return {
    type: "assistant.ask_user",
    data: { content, ...(missingFields ? { missingFields } : {}) },
  };
}

describe("Agent Architecture Skeletons & Types", () => {
  it("extracts the first complete JSON object from model output", () => {
    expect(parseAgentJsonResponse(
      '```json\n{"kind":"text","format":"markdown","type":"assistant.message","data":{"content":"包含 { 大括号 } 的文本"}}\n```',
    )).toEqual({
      kind: "text",
      format: "markdown",
      type: "assistant.message",
      data: { content: "包含 { 大括号 } 的文本" },
    });

    expect(parseAgentJsonResponse(
      '{"kind":"text","format":"markdown","type":"assistant.message","data":{"content":"first"}}\n{"kind":"text","format":"markdown","type":"assistant.message","data":{"content":"second"}}',
    )).toEqual({
      kind: "text",
      format: "markdown",
      type: "assistant.message",
      data: { content: "first" },
    });

    expect(parseAgentJsonResponse(
      '模型输出如下： {"kind":"text","format":"markdown","type":"assistant.message","data":{"content":"ok"}} 后续解释包含 {braces}',
    )).toEqual({
      kind: "text",
      format: "markdown",
      type: "assistant.message",
      data: { content: "ok" },
    });

    expect(parseAgentJsonResponse(
      '例如：{"foo":"bar"} 请返回 {"kind":"text","format":"markdown","type":"assistant.message","data":{"content":"done"}}',
    )).toEqual({
      kind: "text",
      format: "markdown",
      type: "assistant.message",
      data: { content: "done" },
    });
  });

  it("rejects output with no agent protocol object", () => {
    expect(() => parseAgentJsonResponse('{"foo":"bar"}')).toThrow(/type/i);
  });

  it("creates the production registry with Core and Deferred Tools", () => {
    const registry = createDefaultToolRegistry();
    expect(registry.get("ReadPresentationSnapshot")?.loadPolicy).toBe("core");
    expect(registry.get("Task")?.loadPolicy).toBe("core");
    expect(registry.get("AutoLayoutSlide")?.loadPolicy).toBe("deferred");
    expect(registry.get("PreviewSlide")?.loadPolicy).toBe("core");
    expect(registry.get("ValidateDeckLayout")?.loadPolicy).toBe("core");
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
    registry.register(previewSlideTool);
    registry.register(validateDeckLayoutTool);

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
    expect(registry.getCoreTools()).toContain(previewSlideTool);
    expect(registry.getCoreTools()).toContain(validateDeckLayoutTool);
    expect(registry.getCoreTools()).not.toContain(autoLayoutSlideTool);
    expect(registry.getDeferredTools()).toContain(autoLayoutSlideTool);
    expect(registry.getDeferredTools()).not.toContain(previewSlideTool);
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
      request: "你好",
      presentation: createStarterPresentation(),
      coreTools: [askUserTool],
      currentSlideId: "slide-123",
    });
    
    expect(prompt).toContain("AskUser");
    expect(prompt).toContain("不问工具名");
  });

  it("normalizes model protocol objects into typed envelopes", () => {
    const res1 = normalizeAgentProtocolObject({
      kind: "text",
      format: "markdown",
      type: "assistant.message",
      data: { content: "Hello!" },
    });
    expect(res1).toEqual({
      kind: "text",
      format: "markdown",
      type: "assistant.message",
      data: { content: "Hello!" },
    });
    expect(() => normalizeAgentProtocolObject({
      type: "assistant.message",
      data: { content: "Legacy shorthand" },
    })).toThrow(/AgentTextEnvelope/);

    const res2 = normalizeAgentProtocolObject({
      type: "assistant.ask_user",
      data: { content: "Need input", missingFields: ["theme"] },
    });
    expect(res2).toEqual({
      kind: "structured",
      format: "json",
      type: "assistant.ask_user",
      data: { content: "Need input", missingFields: ["theme"] },
    });

    const res3 = normalizeAgentProtocolObject({
      type: "deck.command_proposal",
      data: {
        summary: "Update title",
        commands: [{ id: "1", type: "set-presentation-title", title: "New" }],
        risk: "low",
      },
    });
    expect(res3).toEqual({
      kind: "structured",
      format: "json",
      type: "deck.command_proposal",
      data: {
        summary: "Update title",
        commands: [{ id: "1", type: "set-presentation-title", title: "New" }],
        risk: "low",
      },
    });

    expect(() => normalizeAgentProtocolObject({ type: "invalid" })).toThrow();
    expect(() => normalizeAgentProtocolObject({
      type: "deck.command_proposal",
      data: {
        summary: "Bad risk",
        commands: [],
        risk: "very-high",
      },
    })).toThrow();
  });

  it("AgentRuntime executes a Gateway-driven Core Tool loop", async () => {
    const registry = new ToolRegistry();
    registry.register(readPresentationSnapshotTool);
    registry.register(submitCommandsTool);
    const runtime = new AgentRuntime(registry, createSequenceGateway([
      modelToolCall("ReadPresentationSnapshot"),
      modelToolCall("SubmitCommands", {
          summary: "Update title",
          commands: [{ id: "cmd-runtime", type: "set-presentation-title", title: "Runtime title" }],
          risk: "low",
          assumptions: ["Only the title changes"],
      }),
    ]));
    const presentation = createStarterPresentation();

    const result = await runtime.run({
      threadId: "test-thread",
      request: "Create title",
      presentationSnapshot: presentation,
      selectedElementIds: [],
    });

    expect(result.type).toBe("deck.command_proposal");
    if (result.type === "deck.command_proposal") {
      expect(result.data.commands.length).toBeGreaterThan(0);
      expect(result.data.commands[0].type).toBe("set-presentation-title");
      expect(result.data.assumptions).toEqual(["Only the title changes"]);
    }
  });

  it("retries malformed JSON instead of failing the session", async () => {
    const registry = new ToolRegistry();
    registry.register(submitCommandsTool);
    const runtime = new AgentRuntime(registry, createSequenceGateway([
      "这不是 JSON",
      modelToolCall("SubmitCommands", {
          summary: "Update title",
          commands: [{ id: "cmd-json-retry", type: "set-presentation-title", title: "Retry title" }],
          risk: "low",
      }),
    ]));

    const result = await runtime.run({
      threadId: "test-json-retry",
      request: "Create title",
      presentationSnapshot: createStarterPresentation(),
      selectedElementIds: [],
    });

    expect(result.type).toBe("deck.command_proposal");
  });

  it("retries plain text for direct-answer requests before accepting a text envelope", async () => {
    let calls = 0;
    const runtime = new AgentRuntime(new ToolRegistry(), {
      async generateText() {
        calls += 1;
        return {
          provider: "openai",
          model: "test-model",
          text: calls === 1
            ? "《第五项修炼》是彼得·圣吉关于学习型组织的经典著作。"
            : JSON.stringify(modelMessage("《第五项修炼》是彼得·圣吉关于学习型组织的经典著作。")),
        };
      },
      async *generateTextStream() {
        calls += 1;
        yield { type: "content" as const, text: "《第五项修炼》是彼得·圣吉关于学习型组织的经典著作。" };
        yield { type: "complete" as const, text: "" };
      },
    });

    const result = await runtime.run({
      threadId: "test-direct-answer-fallback",
      request: "第五项修炼",
      presentationSnapshot: createStarterPresentation(),
      selectedElementIds: [],
    });

    expect(result).toEqual(modelMessage("《第五项修炼》是彼得·圣吉关于学习型组织的经典著作。"));
    expect(calls).toBe(2);
  });

  it("keeps strict JSON retry for plain text on PPT action requests", async () => {
    const registry = new ToolRegistry();
    registry.register(submitCommandsTool);
    let streamed = "";
    const runtime = new AgentRuntime(registry, createSequenceGateway([
      "我马上开始制作。",
      modelToolCall("SubmitCommands", {
        summary: "Create the Fifth Discipline presentation",
        commands: [{ id: "cmd-ppt-action-retry", type: "set-presentation-title", title: "第五项修炼" }],
        risk: "low",
      }),
    ]));

    const result = await runtime.run({
      threadId: "test-ppt-action-stays-json",
      request: "帮我做一份关于第五项修炼的 PPT",
      presentationSnapshot: createStarterPresentation(),
      selectedElementIds: [],
      onStreamChunk: (chunk) => {
        streamed += chunk;
      },
    });

    expect(result.type).toBe("deck.command_proposal");
    expect(streamed).not.toContain("我马上开始制作");
  });

  it("does not let an action continuation end with a narrative message", async () => {
    const registry = new ToolRegistry();
    registry.register(searchExtraToolsTool);
    registry.register(submitCommandsTool);
    const runtime = new AgentRuntime(registry, createSequenceGateway([
      modelToolCall("SearchExtraTools", { query: "theme layout" }),
      modelMessage("我先搜索一下高级工具，然后再开始生成。"),
      modelToolCall("SubmitCommands", {
          summary: "Create the presentation",
          commands: [{ id: "cmd-action-continuation", type: "set-presentation-title", title: "Vibe Coding" }],
          risk: "low",
      }),
    ]));

    const result = await runtime.run({
      threadId: "test-action-continuation",
      request: "按默认方案",
      presentationSnapshot: createStarterPresentation(),
      selectedElementIds: [],
      messageHistory: [
        { role: "user", content: "生成 30 页 Vibe Coding 分享 PPT" },
        { role: "assistant", content: "请确认语言、时长和代码示例。" },
      ],
      requiredOutcome: "command_proposal",
    });

    expect(result.type).toBe("deck.command_proposal");
  });

  it("keeps AskUser context until the continued action reaches a proposal", async () => {
    const registry = new ToolRegistry();
    registry.register(askUserTool);
    registry.register(searchExtraToolsTool);
    registry.register(submitCommandsTool);
    const runtime = new AgentRuntime(registry, createSequenceGateway([
      modelToolCall("AskUser", {
          message: "请确认语言、时长和代码示例。",
          missingFields: ["language", "duration", "codeExamples"],
      }),
      modelToolCall("SearchExtraTools", { query: "theme layout" }),
      modelToolCall("SubmitCommands", {
          summary: "Create the Vibe Coding presentation",
          commands: [{ id: "cmd-service-context", type: "set-presentation-title", title: "Vibe Coding" }],
          risk: "low",
          assumptions: ["中文为主，关键术语保留英文"],
      }),
    ]));
    const service = new AgentService(
      new CommandBus(createStarterPresentation()),
      runtime,
      new CommitGate(new RiskPolicy()),
    );

    const clarification = await service.start("生成 30 页 Vibe Coding 技术分享 PPT");
    expect(clarification.status).toBe("chat");
    if (clarification.status !== "chat") throw new Error("Expected clarification");

    const proposal = await service.continueAgentRun(
      clarification.threadId!,
      "按默认方案",
    );

    expect(proposal.status).toBe("approval-required");
    if (proposal.status === "approval-required") {
      expect(proposal.approval.assumptions).toEqual(["中文为主，关键术语保留英文"]);
    }
  });

  it("keeps a failed continuation request in the next runtime context", async () => {
    const prompts: Array<{
      request: string;
      conversation: Array<{ role: "user" | "assistant"; content: string }>;
    }> = [];
    const gateway: AgentModelGateway = {
      async generateText(request) {
        prompts.push(JSON.parse(request.prompt));
        if (prompts.length === 1) {
          return {
          provider: "openai",
          model: "test-model",
          text: JSON.stringify(modelAskUser("请补充具体主题。", ["topic"])),
          };
        }
        if (prompts.length === 2) {
          throw new AgentGatewayError("Provider request timed out", "timeout", "openai");
        }
        return {
          provider: "openai",
          model: "test-model",
          text: JSON.stringify(modelAskUser("上一条是 Agent 范式与架构演进。", ["confirmation"])),
        };
      },
      async *generateTextStream() {
        yield { type: "content" as const, text: "" };
        yield { type: "complete" as const, text: "" };
      },
    };
    const service = new AgentService(
      new CommandBus(createStarterPresentation()),
      new AgentRuntime(createDefaultToolRegistry(), gateway),
      new CommitGate(new RiskPolicy()),
    );

    const first = await service.start("帮我做一份 PPT");
    expect(first.status).toBe("chat");
    if (first.status !== "chat") throw new Error("Expected clarification");

    const failed = await service.continueAgentRun(
      first.threadId!,
      "Agent 范式与架构演进：从 ReAct / Plan / Workflow 看智能体设计",
    );
    expect(failed.status).toBe("chat");
    if (failed.status === "chat") {
      expect(failed.message).toContain("Provider request timed out");
      expect(failed.threadId).toBe(first.threadId);
    }

    await service.continueAgentRun(first.threadId!, "我刚才说了什么？");

    expect(prompts[2].conversation).toEqual([
      { role: "user", content: "帮我做一份 PPT" },
      { role: "assistant", content: "请补充具体主题。" },
      { role: "user", content: "Agent 范式与架构演进：从 ReAct / Plan / Workflow 看智能体设计" },
      { role: "user", content: "我刚才说了什么？" },
    ]);
  });

  it("passes restored chat history into a normal start request", async () => {
    let promptPayload: {
      request: string;
      conversation: Array<{ role: "user" | "assistant"; content: string }>;
    } | undefined;
    const service = new AgentService(
      new CommandBus(createStarterPresentation()),
      new AgentRuntime(createDefaultToolRegistry(), {
        async generateText(request) {
          promptPayload = JSON.parse(request.prompt);
          return {
          provider: "openai",
          model: "test-model",
          text: JSON.stringify(modelMessage("你刚才说的是 Agent 范式与架构演进。")),
          };
        },
        async *generateTextStream() {
          yield { type: "content" as const, text: "" };
          yield { type: "complete" as const, text: "" };
        },
      }),
      new CommitGate(new RiskPolicy()),
    );

    const result = await service.start(
      "我刚才说了什么？",
      undefined,
      "REQUEST_APPROVAL",
      undefined,
      undefined,
      [
        { role: "user", content: "Agent 范式与架构演进：从 ReAct / Plan / Workflow 看智能体设计" },
      ],
    );

    expect(result.status).toBe("chat");
    expect(promptPayload?.conversation).toEqual([
      { role: "user", content: "Agent 范式与架构演进：从 ReAct / Plan / Workflow 看智能体设计" },
    ]);
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
    const emptySearch = await searchExtraToolsTool.execute({ query: "create-new-slide-tool" }, context);
    expect(emptySearch.tools).toEqual([]);
    expect(emptySearch.baseEditingAvailable).toBe(true);
    expect(emptySearch.guidance).toContain("add-slide");
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

    const runtime = new AgentRuntime(registry, createSequenceGateway([
      modelToolCall("SubmitCommands", {
        summary: "Update title",
        commands: [{ id: "cmd-service", type: "set-presentation-title", title: "Approved title" }],
        risk: "low",
      }),
    ]));
    const riskPolicy = new RiskPolicy();
    const commitGate = new CommitGate(riskPolicy);
    const presentation = createStarterPresentation();
    const bus = new CommandBus(presentation);

    const service = new AgentService(bus, runtime, commitGate);
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
    const runtime = new AgentRuntime(registry, createSequenceGateway([
      modelToolCall("SubmitCommands", {
        summary: "Update title",
        commands: [{ id: "cmd-auto", type: "set-presentation-title", title: "Auto title" }],
        risk: "low",
      }),
    ]));
    const bus = new CommandBus(createStarterPresentation());
    const service = new AgentService(bus, runtime, new CommitGate(new RiskPolicy()));
    const result = await service.start("Update title", undefined, "AUTO");
    expect(result.status).toBe("completed");
    expect(bus.getSnapshot().title).toBe("Auto title");
  });

  it("rejects an approved proposal when the presentation changed after preview", async () => {
    const registry = new ToolRegistry();
    registry.register(submitCommandsTool);
    const runtime = new AgentRuntime(registry, createSequenceGateway([
      modelToolCall("SubmitCommands", {
        summary: "Update title",
        commands: [{ id: "cmd-stale", type: "set-presentation-title", title: "Stale title" }],
        risk: "low",
      }),
    ]));
    const bus = new CommandBus(createStarterPresentation());
    const service = new AgentService(bus, runtime, new CommitGate(new RiskPolicy()));
    const result = await service.start("Update title", undefined, "REQUEST_APPROVAL");
    if (result.status !== "approval-required") throw new Error("Expected approval");
    bus.execute({ id: "external-change", type: "set-presentation-title", title: "Newer title" });

    await expect(service.resume(result.approval.threadId, true)).rejects.toThrow(
      "changed after preview",
    );
    expect(bus.getSnapshot().title).toBe("Newer title");
  });

  it("coerces string assumptions to array for SubmitCommands", () => {
    const parsed = submitCommandsTool.inputSchema.parse({
      summary: "Apply theme and layouts",
      commands: [{ id: "cmd-1", type: "set-theme", theme: "ocean", palette: "cyan" }],
      assumptions: "仅排版，不改文案",
    });

    expect(parsed.assumptions).toEqual(["仅排版，不改文案"]);
  });

  it("aborts production AgentService execution immediately when aborted signal is passed", async () => {
    const bus = new CommandBus(createStarterPresentation());
    const mockRuntime = {
      run: vi.fn(),
      clearSession: vi.fn(),
    } as any;
    const service = new AgentService(
      bus,
      mockRuntime,
      new CommitGate(new RiskPolicy()),
    );
    const controller = new AbortController();
    controller.abort();

    await expect(
      service.start("Hello", undefined, "AUTO", undefined, undefined, [], controller.signal),
    ).resolves.toEqual({
      status: "chat",
      message: "会话已中断。",
    });
    expect(mockRuntime.run).not.toHaveBeenCalled();
  });
});
