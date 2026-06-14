import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { FileSessionStore } from "@main/session-store";

const temporaryDirectories: string[] = [];

async function createStore() {
  const directory = await mkdtemp(join(tmpdir(), "agent-ppt-session-"));
  temporaryDirectories.push(directory);
  const filePath = join(directory, "sessions.json");
  const store = new FileSessionStore(filePath);
  await store.initialize();
  return { store, filePath };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("FileSessionStore", () => {
  it("creates and restores the initial session", async () => {
    const { store, filePath } = await createStore();
    const initial = store.getBootstrap();

    expect(initial.sessions).toHaveLength(1);
    expect(initial.activeSession.presentation.slides).toHaveLength(1);

    const restored = new FileSessionStore(filePath);
    await restored.initialize();
    expect(restored.getBootstrap()).toEqual(initial);
  });

  it("persists new sessions, presentation changes, messages, and selection", async () => {
    const { store, filePath } = await createStore();
    const originalId = store.getBootstrap().activeSession.session.id;
    const created = await store.createSession();
    const createdId = created.activeSession.session.id;
    const presentation = {
      ...created.activeSession.presentation,
      title: "持久化测试",
      revision: 3,
    };

    await store.savePresentation(createdId, presentation);
    await store.saveMessages(createdId, [
      { id: "message-1", role: "user", content: "恢复这条消息" },
    ]);
    await store.selectSession(originalId);

    const restored = new FileSessionStore(filePath);
    await restored.initialize();
    const state = restored.getBootstrap();
    const saved = restored.getSession(createdId);

    expect(state.activeSession.session.id).toBe(originalId);
    expect(saved.presentation.title).toBe("持久化测试");
    expect(saved.presentation.revision).toBe(3);
    expect(saved.messages[0].content).toBe("恢复这条消息");
    expect(JSON.parse(await readFile(filePath, "utf8")).version).toBe(1);
  });

  it("expires pending approvals after an application restart", async () => {
    const { store, filePath } = await createStore();
    const sessionId = store.getBootstrap().activeSession.session.id;
    await store.saveMessages(sessionId, [
      {
        id: "approval-1",
        role: "assistant",
        content: "请确认变更",
        approval: { threadId: "thread-1", summary: "测试", commands: [] },
      },
    ]);

    const restored = new FileSessionStore(filePath);
    await restored.initialize();
    const message = restored.getBootstrap().activeSession.messages[0];

    expect(message.approval).toBeUndefined();
    expect(message.content).toContain("审批请求已随应用重启失效");
  });

  it("deletes a session and updates state", async () => {
    const { store } = await createStore();
    const state1 = store.getBootstrap();
    const id1 = state1.activeSession.session.id;

    // Create a second session
    const state2 = await store.createSession();
    const id2 = state2.activeSession.session.id;
    expect(state2.sessions).toHaveLength(2);
    expect(state2.activeSession.session.id).toBe(id2);

    // Delete the second session (active)
    const state3 = await store.deleteSession(id2);
    expect(state3.sessions).toHaveLength(1);
    expect(state3.activeSession.session.id).toBe(id1);

    // Delete the only remaining session (recreates initial session)
    const state4 = await store.deleteSession(id1);
    expect(state4.sessions).toHaveLength(1);
    expect(state4.activeSession.session.id).not.toBe(id1);
  });
});
