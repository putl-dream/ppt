import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
    expect(initial.activeSession.project?.artifacts.map((artifact) => artifact.id)).toEqual([
      "brief",
      "outline",
      "research",
      "slides",
      "design",
      "deck",
      "history",
    ]);

    const projectRoot = initial.activeSession.project?.rootPath;
    expect(projectRoot).toBeTruthy();
    expect(await readFile(join(projectRoot!, "brief.md"), "utf8")).toContain("## 目的");
    expect(await readFile(join(projectRoot!, "outline.md"), "utf8")).toContain("## 章节结构");
    expect(await readFile(join(projectRoot!, "slides", "001-title.md"), "utf8")).toContain(
      "## 页面目标",
    );

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
    expect(saved.project).toBeDefined();
    const deckSnapshot = JSON.parse(
      await readFile(join(saved.project!.rootPath, "deck", "snapshot.json"), "utf8"),
    );
    expect(deckSnapshot.title).toBe("持久化测试");
    expect(deckSnapshot.revision).toBe(3);
    expect(JSON.parse(await readFile(filePath, "utf8")).version).toBe(1);
  });

  it("migrates existing sessions into project sandboxes", async () => {
    const { store, filePath } = await createStore();
    const legacyState = store.getBootstrap();
    const legacySnapshot = {
      ...legacyState.activeSession,
      project: undefined,
    };
    await writeFile(
      filePath,
      `${JSON.stringify({
        version: 1,
        activeSessionId: legacySnapshot.session.id,
        sessions: [legacySnapshot],
      })}\n`,
      "utf8",
    );

    const restored = new FileSessionStore(filePath);
    await restored.initialize();
    const migrated = restored.getBootstrap().activeSession;

    expect(migrated.project?.rootPath).toContain(`session-${migrated.session.id}`);
    expect(await readFile(join(migrated.project!.rootPath, "research", "notes.md"), "utf8"))
      .toContain("## 事实");
  });

  it("reads and writes project artifacts inside the sandbox", async () => {
    const { store } = await createStore();
    const sessionId = store.getBootstrap().activeSession.session.id;

    const outline = await store.readProjectArtifact(sessionId, "outline");
    expect(outline).toMatchObject({
      path: "outline.md",
      type: "file",
    });
    expect(outline.content).toContain("## 章节结构");

    const slides = await store.readProjectArtifact(sessionId, "slides");
    expect(slides).toMatchObject({
      path: "slides/",
      type: "directory",
    });
    expect(slides.entries).toContain("slides/001-title.md");

    const writeResult = await store.writeProjectArtifact(
      sessionId,
      "research/notes.md",
      "# Research Notes\n\n- 新增事实\n",
    );
    expect(writeResult).toMatchObject({
      changed: true,
      changedArtifactId: "research",
    });
    expect(writeResult.staleArtifactIds).toEqual(["slides", "deck", "history"]);

    const updated = await store.readProjectArtifact(sessionId, "research/notes.md");
    expect(updated.content).toContain("新增事实");
  });

  it("marks downstream artifacts as stale when an upstream artifact changes", async () => {
    const { store } = await createStore();
    const sessionId = store.getBootstrap().activeSession.session.id;
    for (const artifactId of [
      "brief",
      "outline",
      "research",
      "design",
      "slides",
      "deck",
      "history",
    ]) {
      await store.markProjectArtifactStatus(sessionId, artifactId, "ready");
    }

    const result = await store.writeProjectArtifact(
      sessionId,
      "brief.md",
      "# Brief\n\n## 目的\n- 更新项目目标\n",
    );

    expect(result.staleArtifactIds).toEqual([
      "outline",
      "research",
      "slides",
      "design",
      "deck",
      "history",
    ]);
    const statusById = new Map(
      store.listProjectArtifacts(sessionId).map((artifact) => [artifact.id, artifact.status]),
    );
    expect(statusById.get("brief")).toBe("draft");
    expect(statusById.get("outline")).toBe("stale");
    expect(statusById.get("research")).toBe("stale");
    expect(statusById.get("design")).toBe("stale");
    expect(statusById.get("slides")).toBe("stale");
    expect(statusById.get("deck")).toBe("stale");
    expect(statusById.get("history")).toBe("stale");
  });

  it("rejects project artifact paths outside the sandbox", async () => {
    const { store } = await createStore();
    const sessionId = store.getBootstrap().activeSession.session.id;

    await expect(store.readProjectArtifact(sessionId, "../sessions.json")).rejects.toThrow(
      "outside the sandbox",
    );
    await expect(store.writeProjectArtifact(sessionId, "../escape.md", "nope")).rejects.toThrow(
      "outside the sandbox",
    );
    await expect(
      store.getProjectArtifactDiff(sessionId, "../escape.md", "nope"),
    ).rejects.toThrow("outside the sandbox");
  });

  it("returns a diff preview before writing project artifact content", async () => {
    const { store } = await createStore();
    const sessionId = store.getBootstrap().activeSession.session.id;

    const diff = await store.getProjectArtifactDiff(
      sessionId,
      "outline.md",
      "# Outline\n\n## 新结构\n",
    );

    expect(diff.changed).toBe(true);
    expect(diff.before).toContain("## 章节结构");
    expect(diff.after).toContain("## 新结构");
    expect(diff.unifiedDiff).toContain("--- a/outline.md");
    expect(diff.unifiedDiff).toContain("+++ b/outline.md");
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

  it("preserves pending outline recovery metadata after an application restart", async () => {
    const { store, filePath } = await createStore();
    const sessionId = store.getBootstrap().activeSession.session.id;
    await store.saveMessages(sessionId, [
      {
        id: "outline-1",
        role: "assistant",
        content: "请确认大纲",
        outlineRequest: {
          threadId: "thread-1",
          message: "请确认大纲",
          outline: {
            title: "测试大纲",
            slides: [{ title: "第一页", keyPoints: ["要点"] }],
          },
          missingInformation: [],
          model: { provider: "anthropic", model: "test-model" },
          executionStrategy: "AUTO",
        },
      },
    ]);

    const restored = new FileSessionStore(filePath);
    await restored.initialize();
    const outlineRequest = restored.getBootstrap().activeSession.messages[0].outlineRequest;

    expect(outlineRequest).toMatchObject({
      threadId: "thread-1",
      model: { provider: "anthropic", model: "test-model" },
      executionStrategy: "AUTO",
    });
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
