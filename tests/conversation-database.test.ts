import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { ConversationDatabase } from "@main/conversation-database";
import {
  createSessionPresentation,
  type SessionSnapshot,
} from "@shared/session";

const temporaryDirectories: string[] = [];

function createDatabase() {
  const directoryPromise = mkdtemp(join(tmpdir(), "agent-ppt-sqlite-"));
  return directoryPromise.then((directory) => {
    temporaryDirectories.push(directory);
    return new ConversationDatabase(join(directory, "conversations.sqlite"));
  });
}

function snapshot(id: string): SessionSnapshot {
  const now = new Date().toISOString();
  const presentation = createSessionPresentation("SQLite session");
  return {
    session: {
      id,
      title: presentation.title,
      createdAt: now,
      updatedAt: now,
      slideCount: 0,
      revision: 0,
    },
    presentation,
    messages: [
      { id: "u1", role: "user", content: "build a deck" },
      { id: "a1", role: "assistant", content: "working", threadId: "run-1" },
    ],
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("ConversationDatabase", () => {
  it("stores sessions and messages without workspace transcripts", async () => {
    const database = await createDatabase();
    database.replaceState({ activeSessionId: "s1", sessions: [snapshot("s1")] });

    const restored = database.loadState();
    expect(restored.activeSessionId).toBe("s1");
    expect(restored.sessions[0].messages.map((message) => message.content)).toEqual([
      "build a deck",
      "working",
    ]);
    database.close();
  });

  it("records the complete ordered run event chain", async () => {
    const database = await createDatabase();
    database.replaceState({ activeSessionId: "s1", sessions: [snapshot("s1")] });
    database.beginRun({
      runId: "run-1",
      sessionId: "s1",
      provider: "anthropic",
      model: "test-model",
      request: "build a deck",
    });
    database.appendRuntimeEvent("run-1", "reasoning_chunk", { chunk: "inspect" });
    database.appendRuntimeEvent("run-1", "tool_call", {
      toolUseId: "tool-1",
      toolName: "ReadPresentationSnapshot",
      input: {},
    });
    database.appendRuntimeEvent("run-1", "tool_result", {
      toolUseId: "tool-1",
      content: [{ type: "text", text: "empty deck" }],
    });
    database.finishRun({ runId: "run-1", status: "completed", result: { status: "chat" } });

    const events = database.listRunEvents("run-1");
    expect(events.map((event) => event.kind)).toEqual([
      "run_started",
      "user_message",
      "assistant_started",
      "reasoning_chunk",
      "tool_call",
      "tool_result",
      "run_completed",
    ]);
    expect(events.map((event) => event.sequence)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    database.close();
  });

  it("stores checkpoints and compacted model context separately", async () => {
    const database = await createDatabase();
    database.replaceState({ activeSessionId: "s1", sessions: [snapshot("s1")] });
    database.beginRun({ runId: "run-1", sessionId: "s1", request: "continue" });
    database.saveRunCheckpoint("thread-1", { phase: "tool_running" }, "run-1");
    database.saveServiceThread("thread-1", { status: "active" });
    const compacted = database.saveContextSnapshotForRun(
      "run-1",
      { messages: [{ role: "user", content: "summary" }] },
      ["L4 compact_history"],
    );

    expect(database.loadRunCheckpoint("thread-1")).toEqual({ phase: "tool_running" });
    expect(database.loadServiceThread("thread-1")).toEqual({ status: "active" });
    expect(compacted?.summary).toContain("compact_history");
    expect(database.latestContextSnapshot("s1")?.modelContext).toEqual({
      messages: [{ role: "user", content: "summary" }],
    });
    database.close();
  });
});
