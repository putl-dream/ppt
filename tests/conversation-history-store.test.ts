import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ConversationDatabase } from "../src/main/conversation-database";
import { DurableConversationHistoryStore } from "../src/main/agent/persistence/conversation-history-store";
import { AgentRuntime } from "../src/main/agent/runtime/agent-runtime";
import { ToolRegistry } from "../src/main/agent/tools/tool-registry";
import { readPresentationSnapshotTool } from "../src/main/agent/tools/core/read-presentation-snapshot";
import type {
  AgentModelContentBlock,
  AgentModelGateway,
  AgentModelRequest,
} from "../src/main/agent/gateway/types";
import { createStarterPresentation } from "../src/shared/presentation";
import { DurableRunStore } from "../src/main/agent/persistence/durable-run-store";

const history = [
  { role: "user" as const, content: [{ type: "text" as const, text: "inspect" }] },
  {
    role: "assistant" as const,
    content: [{ type: "tool_use" as const, id: "read-1", name: "Read", input: {} }],
  },
  {
    role: "user" as const,
    content: [{
      type: "tool_result" as const,
      toolUseId: "read-1",
      content: [{ type: "text" as const, text: "result" }],
    }],
  },
];

describe("canonical conversation history store", () => {
  it("round-trips complete ContentBlock history through the file fallback", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-history-"));
    const store = new DurableConversationHistoryStore(root);
    await store.save("thread", history);
    expect(await store.load("thread")).toEqual(history);
  });

  it("round-trips complete ContentBlock history through SQLite", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-history-db-"));
    const database = new ConversationDatabase(join(root, "conversation.sqlite"));
    try {
      const store = new DurableConversationHistoryStore(database);
      await store.save("thread", history);
      expect(await store.load("thread")).toEqual(history);
    } finally {
      database.close();
    }
  });

  it("starts a fresh query from canonical tool history without restoring completed state", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-history-runtime-"));
    const requests: AgentModelRequest[] = [];
    const responses: AgentModelContentBlock[][] = [
      [{ type: "tool_use", id: "read-1", name: "ReadPresentationSnapshot", input: {} }],
      [{ type: "text", text: "first completed" }],
      [{ type: "text", text: "second completed" }],
    ];
    const gateway: AgentModelGateway = {
      async generateText(request) {
        requests.push(request);
        const content = responses.shift();
        if (!content) throw new Error("Unexpected gateway call");
        return { provider: "openai", model: "test", content };
      },
      async *generateTextStream(request) {
        const response = await this.generateText(request);
        yield { type: "complete" as const, content: response.content };
      },
    };
    const registry = new ToolRegistry();
    registry.register(readPresentationSnapshotTool);
    const runtime = new AgentRuntime(registry, gateway);
    const presentationSnapshot = createStarterPresentation();

    await runtime.run({
      threadId: "history-thread",
      runId: "first-run",
      request: "inspect",
      presentationSnapshot,
      selectedElementIds: [],
      workspaceRoot: root,
    });
    await runtime.run({
      threadId: "history-thread",
      runId: "second-run",
      request: "follow up",
      startMode: { type: "new_query" },
      presentationSnapshot,
      selectedElementIds: [],
      workspaceRoot: root,
    });

    const secondMessages = requests[2]!.messages!;
    expect(secondMessages.flatMap((message) => message.content)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "tool_use", id: "read-1" }),
        expect.objectContaining({ type: "tool_result", toolUseId: "read-1" }),
        expect.objectContaining({ type: "text", text: "follow up" }),
      ]),
    );
    const checkpoint = await new DurableRunStore(root).load("history-thread");
    expect(checkpoint?.runId).toBe("second-run");
    expect(checkpoint?.modelStep).toBe(1);
  });
});
