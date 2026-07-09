import { mkdtemp, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import type { AgentModelGateway } from "../src/main/agent/gateway";
import { AgentRuntime } from "../src/main/agent/runtime/agent-runtime";
import { MessageBus } from "../src/main/agent/teammate/message-bus";
import { TeammateManager } from "../src/main/agent/teammate/spawn-teammate";
import { createDefaultToolRegistry } from "../src/main/agent/tools/tool-registry";
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
