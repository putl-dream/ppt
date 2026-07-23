import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AgentRuntime } from "../src/main/agent/runtime/agent-runtime";
import { AgentService } from "../src/main/agent/service";
import { ToolRegistry } from "../src/main/agent/tools/tool-registry";
import { askUserTool } from "../src/main/agent/tools/core/ask-user";
import { submitCommandsTool } from "../src/main/agent/tools/core/submit-commands";
import { CommitGate } from "../src/main/agent/gate/commit-gate";
import { RiskPolicy } from "../src/main/agent/gate/risk-policy";
import { CommandBus } from "../src/shared/commands";
import { createStarterPresentation } from "../src/shared/presentation";
import type {
  AgentModelContentBlock,
  AgentModelGateway,
  AgentModelRequest,
  AgentModelResponse,
} from "../src/main/agent/gateway/types";
import { DurableRunStore } from "../src/main/agent/persistence/durable-run-store";
import { MessageBus } from "../src/main/agent/teammate/message-bus";

function gatewayFor(turns: AgentModelContentBlock[][]): AgentModelGateway & {
  requests: AgentModelRequest[];
} {
  let index = 0;
  const requests: AgentModelRequest[] = [];
  return {
    requests,
    async generateText(request): Promise<AgentModelResponse> {
      requests.push(request);
      const content = turns[index++];
      if (!content) throw new Error("Unexpected gateway call");
      return { provider: "openai", model: "test", content };
    },
    async *generateTextStream(request) {
      const response = await this.generateText(request);
      yield { type: "complete" as const, content: response.content };
    },
  };
}

describe("durable agent recovery", () => {
  it("acks a replayed Inbox claim without exposing an already committed message twice", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "agent-inbox-recovery-"));
    const bus = new MessageBus(MessageBus.defaultMailboxDir(workspaceRoot));
    await bus.send({
      id: "already-committed",
      from: "worker",
      to: "lead",
      content: "should not replay",
    });
    await bus.claimInbox("lead");
    const now = new Date().toISOString();
    await new DurableRunStore(workspaceRoot).save({
      version: 1,
      threadId: "inbox-recovery",
      status: "running",
      phase: "before_model",
      request: "old request",
      baseRevision: 0,
      modelStep: 0,
      modelMessages: [{ role: "user", content: [{ type: "text", text: "old request" }] }],
      transcript: [{ role: "user", content: "old request" }],
      queuedToolUses: [],
      pendingToolResults: [],
      pendingUserContent: [],
      discoveredToolNames: [],
      loadedSkillNames: [],
      renderFeedbackUsed: false,
      backgroundTasks: [],
      processedInboxMessageIds: ["already-committed"],
      createdAt: now,
      updatedAt: now,
    });
    const gateway = gatewayFor([[{ type: "text", text: "continued once" }]]);

    await new AgentRuntime(new ToolRegistry(), gateway).run({
      threadId: "inbox-recovery",
      request: "continue",
      presentationSnapshot: createStarterPresentation(),
      selectedElementIds: [],
      workspaceRoot,
      startMode: { type: "resume_query", reason: "interrupted" },
      messageBus: bus,
    });

    expect(JSON.stringify(gateway.requests[0].messages)).not.toContain("should not replay");
    expect(await bus.claimInbox("lead")).toBeUndefined();
  });

  it("does not replay an interrupted tool with uncertain side effects", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "agent-tool-recovery-"));
    const toolUse = {
      type: "tool_use" as const,
      id: "uncertain-tool",
      name: "ReadPresentationSnapshot",
      input: {},
    };
    const now = new Date().toISOString();
    await new DurableRunStore(workspaceRoot).save({
      version: 1,
      threadId: "interrupted-thread",
      status: "running",
      phase: "tool_running",
      request: "inspect",
      baseRevision: 0,
      modelStep: 1,
      modelMessages: [{ role: "assistant", content: [toolUse] }],
      transcript: [{ role: "user", content: "inspect" }],
      queuedToolUses: [],
      pendingToolResults: [],
      pendingUserContent: [],
      discoveredToolNames: [],
      loadedSkillNames: [],
      renderFeedbackUsed: false,
      activeToolUse: toolUse,
      createdAt: now,
      updatedAt: now,
    });

    const registry = new ToolRegistry();
    const gateway = gatewayFor([[{ type: "text", text: "已先对账持久化状态。" }]]);
    const result = await new AgentRuntime(registry, gateway).run({
      threadId: "interrupted-thread",
      request: "继续",
      presentationSnapshot: createStarterPresentation(),
      selectedElementIds: [],
      workspaceRoot,
      startMode: { type: "resume_query", reason: "crash_recovery" },
    });
    expect(result.type).toBe("message");
    const resultBlock = gateway.requests[0].messages!
      .flatMap((message) => message.content)
      .find((block) => block.type === "tool_result");
    expect(resultBlock).toMatchObject({
      type: "tool_result",
      toolUseId: "uncertain-tool",
      isError: true,
    });
  });

  it("restores canonical ContentBlock history after AskUser", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "agent-run-recovery-"));
    const registry = new ToolRegistry();
    registry.register(askUserTool);
    const firstGateway = gatewayFor([[
      {
        type: "tool_use",
        id: "ask-1",
        name: "AskUser",
        input: { message: "需要确认受众" },
      },
    ]]);
    const first = await new AgentRuntime(registry, firstGateway).run({
      threadId: "thread-recovery",
      runId: "thread-recovery",
      request: "制作演示文稿",
      presentationSnapshot: createStarterPresentation(),
      selectedElementIds: [],
      workspaceRoot,
    });
    expect(first.type).toBe("ask_user");

    const checkpoint = await new DurableRunStore(workspaceRoot).load("thread-recovery");
    expect(checkpoint).toBeDefined();
    if (!checkpoint) throw new Error("expected a durable checkpoint");
    expect(checkpoint.status).toBe("waiting_user");
    expect(checkpoint.version).toBe(2);
    if (checkpoint.version !== 2) throw new Error("expected a version 2 checkpoint");
    expect(checkpoint).not.toHaveProperty("modelMessages");
    expect(checkpoint).not.toHaveProperty("pendingToolResults");
    expect(checkpoint).not.toHaveProperty("renderFeedbackUsed");
    expect(checkpoint.inflight?.phase).toBe("waiting_user");
    expect(checkpoint.inflight?.workspace.toolResults[0])
      .toMatchObject({ toolUseId: "ask-1" });

    const secondGateway = gatewayFor([[
      { type: "text", text: "已按管理层受众继续。" },
    ]]);
    const second = await new AgentRuntime(registry, secondGateway).run({
      threadId: "thread-recovery",
      runId: "run-2",
      request: "受众是管理层",
      presentationSnapshot: createStarterPresentation(),
      selectedElementIds: [],
      workspaceRoot,
      startMode: { type: "resume_query", reason: "waiting_user" },
    });
    expect(second).toEqual({ type: "message", content: "已按管理层受众继续。" });
    const blocks = secondGateway.requests[0].messages!.flatMap((message) => message.content);
    expect(blocks).toContainEqual(expect.objectContaining({ type: "tool_use", id: "ask-1" }));
    expect(blocks).toContainEqual(expect.objectContaining({ type: "tool_result", toolUseId: "ask-1" }));
  });

  it("restores and applies a command approval after service reconstruction", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "agent-approval-recovery-"));
    const presentation = createStarterPresentation();
    const registry = new ToolRegistry();
    registry.register(submitCommandsTool);
    const gateway = gatewayFor([[
      {
        type: "tool_use",
        id: "submit-1",
        name: "SubmitCommands",
        input: {
          summary: "更新标题",
          risk: "low",
          commands: [{ id: "cmd-1", type: "set-presentation-title", title: "持久化标题" }],
        },
      },
    ]]);
    const firstService = new AgentService(
      new CommandBus(presentation),
      new AgentRuntime(registry, gateway),
      new CommitGate(new RiskPolicy()),
      workspaceRoot,
    );
    const proposed = await firstService.start(
      "更新标题",
      undefined,
      "REQUEST_APPROVAL",
      undefined,
      undefined,
      undefined,
      undefined,
      "approval-thread",
    );
    expect(proposed.status).toBe("approval-required");

    const restoredBus = new CommandBus(presentation);
    const restoredService = new AgentService(
      restoredBus,
      new AgentRuntime(registry, gatewayFor([])),
      new CommitGate(new RiskPolicy()),
      workspaceRoot,
    );
    const applied = await restoredService.resume("approval-thread", true);
    expect(applied.status).toBe("completed");
    expect(restoredBus.getSnapshot().title).toBe("持久化标题");
  });
});
