import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { FileSessionStore } from "@main/session-store";

const temporaryDirectories: string[] = [];
const stores: FileSessionStore[] = [];

async function createStore(rootPath?: string) {
  const directory = await mkdtemp(join(tmpdir(), "agent-ppt-sqlite-session-"));
  temporaryDirectories.push(directory);
  const databasePath = join(directory, "conversations.sqlite");
  const store = new FileSessionStore(databasePath, join(directory, "projects"));
  stores.push(store);
  await store.initialize();
  if (rootPath) await store.createSession({ rootPath, title: "Workspace session" });
  return { store, databasePath, directory };
}

afterEach(async () => {
  for (const store of stores.splice(0)) store.close();
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("SQLite session store", () => {
  it("starts empty and restores sessions and messages from SQLite", async () => {
    const { store, databasePath, directory } = await createStore();
    expect(store.getBootstrap().sessions).toEqual([]);

    const created = await store.createSession({ title: "SQLite project" });
    const sessionId = created.activeSession!.session.id;
    await store.saveMessages(sessionId, [
      { id: "u1", role: "user", content: "创建演示文稿" },
      { id: "a1", role: "assistant", content: "正在处理" },
    ]);
    store.close();
    stores.splice(stores.indexOf(store), 1);

    const restored = new FileSessionStore(databasePath, join(directory, "projects"));
    stores.push(restored);
    await restored.initialize();
    expect(restored.getSession(sessionId).messages.map((message) => message.content)).toEqual([
      "创建演示文稿",
      "正在处理",
    ]);
  });

  it("persists presentation state while keeping the deck snapshot in the sandbox", async () => {
    const { store } = await createStore();
    const created = await store.createSession({ title: "Deck" });
    const snapshot = created.activeSession!;
    const presentation = {
      ...snapshot.presentation,
      title: "Stable deck",
      revision: 2,
    };
    await store.savePresentation(snapshot.session.id, presentation);

    const deck = JSON.parse(await readFile(
      join(store.getSession(snapshot.session.id).project!.rootPath, "deck", "snapshot.json"),
      "utf8",
    ));
    expect(deck.title).toBe("Stable deck");
    expect(store.getSession(snapshot.session.id).presentation.revision).toBe(2);
  });

  it("keeps only stable artifacts and a project identity file in a user workspace", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "agent-ppt-workspace-"));
    temporaryDirectories.push(workspace);
    const { store } = await createStore(workspace);
    const active = store.getBootstrap().activeSession!;

    expect(active.project?.rootPath.toLowerCase()).toBe(
      join(workspace, "sandboxes", active.session.id).replace(/\\/g, "/").toLowerCase(),
    );
    const manifest = JSON.parse(await readFile(join(workspace, ".agent-ppt-project.json"), "utf8"));
    expect(manifest.projectId).toEqual(expect.any(String));
    await expect(access(join(workspace, ".agent-ppt", "sessions.index.json"))).rejects.toThrow();
    await expect(access(join(active.project!.rootPath, "transcripts"))).rejects.toThrow();
    await expect(access(join(active.project!.rootPath, ".agent"))).rejects.toThrow();
  });

  it("lists and reopens sessions from the central database instead of a workspace index", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "agent-ppt-workspace-list-"));
    temporaryDirectories.push(workspace);
    const { store } = await createStore();
    const first = await store.createSession({ rootPath: workspace, title: "First" });
    const second = await store.createSession({ rootPath: workspace, title: "Second" });

    const listed = await store.listWorkspaceSessions(workspace);
    expect(listed.map((item) => item.id).sort()).toEqual([
      first.activeSession!.session.id,
      second.activeSession!.session.id,
    ].sort());
    const opened = await store.openWorkspace(workspace);
    expect(opened.activeSession?.session.id).toBe(second.activeSession!.session.id);
  });

  it("reads, writes and protects stable workspace artifacts", async () => {
    const { store } = await createStore();
    const created = await store.createSession({ title: "Artifacts" });
    const sessionId = created.activeSession!.session.id;
    const result = await store.writeProjectArtifact(sessionId, "research/notes.md", "facts");
    expect(result.changed).toBe(true);
    expect((await store.readProjectArtifact(sessionId, "research/notes.md")).content).toBe("facts");
    await expect(store.writeProjectArtifact(sessionId, "../escape.md", "no")).rejects.toThrow(
      "outside the sandbox",
    );
  });

  it("durably finalizes the assistant message from main-process run events", async () => {
    const { store } = await createStore();
    const created = await store.createSession({ title: "Run" });
    const sessionId = created.activeSession!.session.id;
    await store.saveMessages(sessionId, [
      { id: "u1", role: "user", content: "inspect" },
      { id: "placeholder", role: "assistant", content: "", threadId: "run-1" },
    ]);
    store.conversationDatabase.beginRun({ runId: "run-1", sessionId, request: "inspect" });
    store.conversationDatabase.appendRuntimeEvent("run-1", "reasoning_chunk", {
      chunk: "I should inspect the deck",
      modelStep: 0,
    });
    store.conversationDatabase.appendRuntimeEvent("run-1", "tool_started", {
      toolName: "ReadPresentationSnapshot",
      message: "reading",
    });
    store.conversationDatabase.appendRuntimeEvent("run-1", "tool_finished", {
      toolName: "ReadPresentationSnapshot",
      message: "read",
    });
    store.conversationDatabase.appendRuntimeEvent("run-1", "workflow_progress", {
      message: "L2 micro_compact: older tool results replaced with placeholders.",
    }, "internal");
    await store.finalizeAgentRunMessage(sessionId, "run-1", {
      status: "chat",
      message: "Deck inspected.",
    });

    const assistant = store.getSession(sessionId).messages.at(-1)!;
    expect(assistant.content).toBe("Deck inspected.");
    expect(assistant.activityTrace?.map((item) => item.kind)).toContain("reasoning");
    expect(assistant.activityTrace?.map((item) => item.kind)).toContain("tool");
    expect(assistant.activityTrace?.map((item) => item.kind)).not.toContain("step");
  });

  it("replays the latest task graph snapshot into one durable trace item", async () => {
    const { store } = await createStore();
    const created = await store.createSession({ title: "Task graph run" });
    const sessionId = created.activeSession!.session.id;
    const baseTask = {
      id: "task_1",
      subject: "Build slides",
      description: "",
      executionTarget: "lead" as const,
      owner: "agent",
      blockedBy: [],
      planId: "plan_1",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    await store.saveMessages(sessionId, [
      { id: "placeholder", role: "assistant", content: "", threadId: "run-task-graph" },
    ]);
    store.conversationDatabase.beginRun({
      runId: "run-task-graph",
      sessionId,
      request: "build",
    });
    store.conversationDatabase.appendRuntimeEvent("run-task-graph", "task_graph_updated", {
      tasks: [{ ...baseTask, status: "in_progress" }],
      goal: "Build deck",
    });
    store.conversationDatabase.appendRuntimeEvent("run-task-graph", "task_graph_updated", {
      tasks: [{
        ...baseTask,
        status: "completed",
        owner: null,
        updatedAt: "2026-01-01T00:01:00.000Z",
      }],
      goal: "Build deck",
    });

    await store.finalizeAgentRunMessage(sessionId, "run-task-graph", {
      status: "chat",
      message: "Done.",
    });

    const assistant = store.getSession(sessionId).messages.at(-1)!;
    const taskGraphs = assistant.activityTrace?.filter((item) => item.kind === "taskgraph") ?? [];
    expect(taskGraphs).toHaveLength(1);
    expect(taskGraphs[0]).toMatchObject({
      goal: "Build deck",
      tasks: [{ id: "task_1", status: "completed", owner: null }],
    });
  });

  it("marks an unfinished operation as failed instead of completed", async () => {
    const { store } = await createStore();
    const created = await store.createSession({ title: "Failed run" });
    const sessionId = created.activeSession!.session.id;
    await store.saveMessages(sessionId, [
      { id: "u1", role: "user", content: "inspect" },
      { id: "placeholder", role: "assistant", content: "", threadId: "run-failed" },
    ]);
    store.conversationDatabase.beginRun({
      runId: "run-failed",
      sessionId,
      request: "inspect",
    });
    store.conversationDatabase.appendRuntimeEvent("run-failed", "tool_started", {
      toolName: "ReadPresentationSnapshot",
      message: "正在调用工具 ReadPresentationSnapshot...",
    });

    await store.failAgentRunMessage(sessionId, "run-failed", "unexpected tool error");

    const assistant = store.getSession(sessionId).messages.at(-1)!;
    const tool = assistant.activityTrace?.find((item) => item.kind === "tool");
    expect(tool).toMatchObject({
      kind: "tool",
      status: "done",
      finishedLabel: "读取演示文稿未完成",
    });
    expect(assistant.content).not.toContain("unexpected tool error");
  });
});
