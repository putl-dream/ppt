import { mkdtemp, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import type { AgentModelGateway } from "../src/main/agent/gateway";
import { AgentRuntime } from "../src/main/agent/runtime/agent-runtime";
import { MessageBus } from "../src/main/agent/teammate/message-bus";
import { TeammateManager } from "../src/main/agent/teammate/spawn-teammate";
import { createDefaultToolRegistry } from "../src/main/agent/tools/tool-registry";
import type { ToolContext } from "../src/main/agent/tools/tool-definition";
import { createStarterPresentation } from "../src/shared/presentation";

function createSequenceGateway(responses: unknown[]): AgentModelGateway {
  let index = 0;
  return {
    async generateText() {
      const value = responses[index++];
      if (value === undefined) throw new Error("Unexpected gateway call");
      return {
        provider: "anthropic",
        model: "test-model",
        text: typeof value === "string" ? value : JSON.stringify(value),
      };
    },
    async *generateTextStream() {
      const value = responses[index++];
      if (value === undefined) throw new Error("Unexpected gateway call");
      const text = typeof value === "string" ? value : JSON.stringify(value);
      yield { type: "content" as const, text };
      yield { type: "complete" as const, text: "" };
    },
  };
}

function createFailingGateway(error: Error): AgentModelGateway {
  return {
    async generateText() {
      throw error;
    },
    async *generateTextStream() {
      throw error;
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

async function waitFor<T>(read: () => Promise<T | undefined>): Promise<T> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const value = await read();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for condition.");
}

function createToolContext(input: {
  bus: MessageBus;
  manager: TeammateManager;
  gateway?: AgentModelGateway;
  workspaceRoot?: string;
}): ToolContext {
  return {
    presentation: createStarterPresentation(),
    selectedElementIds: [],
    discoverySession: { discoveredToolNames: new Set<string>() },
    registry: createDefaultToolRegistry(),
    messageHistory: [],
    workspaceRoot: input.workspaceRoot,
    gateway: input.gateway,
    messageBus: input.bus,
    teammateManager: input.manager,
  };
}

describe("MessageBus", () => {
  it("appends, peeks, and consumes mailbox messages", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "ppt-bus-"));
    const bus = new MessageBus(MessageBus.defaultMailboxDir(workspaceRoot));

    await bus.send({
      from: "lead",
      to: "researcher",
      content: "Please inspect the outline.",
    });

    expect((await bus.peekInbox("researcher")).map((message) => message.content))
      .toEqual(["Please inspect the outline."]);
    expect((await bus.readInbox("researcher")).map((message) => message.from))
      .toEqual(["lead"]);
    expect(await bus.readInbox("researcher")).toEqual([]);
    await expect(stat(bus.getInboxPath("researcher"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("keeps concurrent appends as complete jsonl records", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "ppt-bus-"));
    const bus = new MessageBus(MessageBus.defaultMailboxDir(workspaceRoot));

    await Promise.all(Array.from({ length: 12 }, (_, index) =>
      bus.send({
        from: `agent-${index}`,
        to: "lead",
        content: `message-${index}`,
      }),
    ));

    const messages = await bus.readInbox("lead");
    expect(messages).toHaveLength(12);
    expect(new Set(messages.map((message) => message.content)).size).toBe(12);
  });

  it("normalizes Windows-unsafe agent names in mailbox filenames", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "ppt-bus-"));
    const bus = new MessageBus(MessageBus.defaultMailboxDir(workspaceRoot));

    const inboxName = basename(bus.getInboxPath("design:agent/one"));

    expect(inboxName).not.toMatch(/[:/\\]/);
    expect(inboxName).toBe("design_agent_one.jsonl");
  });
});

describe("TeammateManager", () => {
  it("runs a teammate asynchronously and delivers result messages to lead", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "ppt-teammate-"));
    const bus = new MessageBus(MessageBus.defaultMailboxDir(workspaceRoot));
    const manager = new TeammateManager(bus);
    const gateway = createSequenceGateway([
      modelToolCall("send_message", {
        to_agent: "lead",
        content: "Found three outline risks.",
      }),
      modelMessage("Finished outline review."),
    ]);

    const handle = manager.spawn({
      name: "reviewer",
      role: "outline reviewer",
      prompt: "Review the outline.",
      workspaceRoot,
      gateway,
      maxSteps: 2,
      idlePollMs: 10,
    });

    expect(handle.status).toBe("running");
    const messages = await waitFor(async () => {
      const inbox = await bus.peekInbox("lead");
      return inbox.some((message) => message.type === "idle_notification")
        ? inbox
        : undefined;
    });

    expect(messages.map((message) => message.type)).toEqual([
      "message",
      "result",
      "idle_notification",
    ]);
    expect(messages.map((message) => message.from)).toEqual(["reviewer", "reviewer", "reviewer"]);

    await manager.requestShutdown("reviewer");
    await manager.waitFor("reviewer");
    expect(manager.list().find((item) => item.name === "reviewer")?.status).toBe("stopped");
  });

  it("lets lead send a second assignment to an idle teammate", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "ppt-teammate-"));
    const bus = new MessageBus(MessageBus.defaultMailboxDir(workspaceRoot));
    const manager = new TeammateManager(bus);
    const gateway = createSequenceGateway([
      modelMessage("First review done."),
      modelMessage("Second review done."),
    ]);
    const registry = createDefaultToolRegistry();

    manager.spawn({
      name: "reviewer",
      role: "outline reviewer",
      prompt: "Review the outline.",
      workspaceRoot,
      gateway,
      maxSteps: 2,
      idlePollMs: 10,
    });

    await waitFor(async () =>
      manager.list().find((item) => item.name === "reviewer" && item.status === "idle"),
    );

    const listTool = registry.get("list_teammates");
    expect(listTool).toBeDefined();
    const listResult = await listTool!.execute({}, createToolContext({
      bus,
      manager,
      gateway,
      workspaceRoot,
    }));
    expect(listResult.teammates).toEqual([
      expect.objectContaining({ name: "reviewer", status: "idle" }),
    ]);

    const sendTool = registry.get("send_teammate_message");
    expect(sendTool).toBeDefined();
    await sendTool!.execute({
      name: "reviewer",
      content: "Now review the citations.",
    }, createToolContext({ bus, manager, gateway, workspaceRoot }));

    const messages = await waitFor(async () => {
      const inbox = await bus.peekInbox("lead");
      return inbox.some((message) => message.content === "Second review done.")
        ? inbox
        : undefined;
    });

    expect(messages.filter((message) => message.type === "result").map((message) => message.content))
      .toEqual(["First review done.", "Second review done."]);

    const shutdownTool = registry.get("shutdown_teammate");
    expect(shutdownTool).toBeDefined();
    await shutdownTool!.execute({ name: "reviewer" }, createToolContext({
      bus,
      manager,
      gateway,
      workspaceRoot,
    }));
    await manager.waitFor("reviewer");
    expect(manager.get("reviewer")?.status).toBe("stopped");
  });

  it("keeps an idle teammate alive after an assignment uses the max step budget", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "ppt-teammate-"));
    const bus = new MessageBus(MessageBus.defaultMailboxDir(workspaceRoot));
    const manager = new TeammateManager(bus);
    const gateway = createSequenceGateway([modelMessage("Finished in one step.")]);

    manager.spawn({
      name: "reviewer",
      role: "outline reviewer",
      prompt: "Review the outline.",
      workspaceRoot,
      gateway,
      maxSteps: 1,
      idlePollMs: 10,
    });

    await waitFor(async () =>
      manager.list().find((item) => item.name === "reviewer" && item.status === "idle"),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(manager.get("reviewer")?.status).toBe("idle");
    await manager.requestShutdown("reviewer");
    await manager.waitFor("reviewer");
    expect(manager.get("reviewer")?.status).toBe("stopped");
  });

  it("captures background teammate failures without rejecting waiters", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "ppt-teammate-"));
    const bus = new MessageBus(MessageBus.defaultMailboxDir(workspaceRoot));
    const manager = new TeammateManager(bus);
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);

    try {
      manager.spawn({
        name: "reviewer",
        role: "outline reviewer",
        prompt: "Review the outline.",
        workspaceRoot,
        gateway: createFailingGateway(new Error("gateway exploded")),
        maxSteps: 1,
        idlePollMs: 10,
      });

      await waitFor(async () =>
        manager.list().find((item) => item.name === "reviewer" && item.status === "failed"),
      );
      await expect(manager.waitFor("reviewer")).resolves.toBeUndefined();

      expect(unhandled).toEqual([]);
      expect(manager.get("reviewer")?.lastError).toBe("gateway exploded");
      expect(await bus.readInbox("lead")).toEqual([
        expect.objectContaining({
          from: "reviewer",
          type: "error",
          content: "gateway exploded",
        }),
      ]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});

describe("Lead teammate tools", () => {
  it("rejects messages to unknown teammates without creating orphan mailboxes", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "ppt-teammate-tools-"));
    const bus = new MessageBus(MessageBus.defaultMailboxDir(workspaceRoot));
    const manager = new TeammateManager(bus);
    const tool = createDefaultToolRegistry().get("send_teammate_message");

    expect(tool).toBeDefined();
    await expect(tool!.execute({
      name: "missing",
      content: "hello?",
    }, createToolContext({ bus, manager, workspaceRoot }))).rejects.toThrow("Unknown teammate: missing");
    await expect(stat(bus.getInboxPath("missing"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("Lead inbox injection", () => {
  it("routes teammate permission requests through lead approval and responds by inbox", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "ppt-lead-inbox-"));
    const bus = new MessageBus(MessageBus.defaultMailboxDir(workspaceRoot));
    await bus.send({
      from: "worker",
      to: "lead",
      type: "permission_request",
      content: "Tool bash needs approval: 删除命令：rm notes.md",
      payload: {
        requestId: "perm-1",
        toolName: "bash",
        args: { command: "rm notes.md" },
        reason: "删除命令：rm notes.md",
      },
    });

    const approvalRequests: unknown[] = [];
    const runtime = new AgentRuntime(
      createDefaultToolRegistry(),
      createSequenceGateway([modelMessage("Handled teammate permission request.")]),
    );

    const result = await runtime.run({
      threadId: "lead-thread",
      request: "Process teammate inbox.",
      presentationSnapshot: createStarterPresentation(),
      selectedElementIds: [],
      workspaceRoot,
      messageBus: bus,
      requestToolApproval: async (request) => {
        approvalRequests.push(request);
        return true;
      },
    });

    expect(result.type).toBe("assistant.message");
    expect(approvalRequests).toEqual([
      {
        toolName: "bash",
        args: { command: "rm notes.md" },
        reason: "删除命令：rm notes.md",
      },
    ]);
    expect(await bus.readInbox("lead")).toEqual([]);
    expect(await bus.readInbox("worker")).toEqual([
      expect.objectContaining({
        from: "lead",
        to: "worker",
        type: "permission_response",
        payload: expect.objectContaining({
          requestId: "perm-1",
          approved: true,
          toolName: "bash",
        }),
      }),
    ]);
  });
});
