import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { FileSessionStore } from "@main/session-store";
import { getSessionSandboxPath } from "@shared/workspace-meta";

const temporaryDirectories: string[] = [];

async function createStore() {
  const directory = await mkdtemp(join(tmpdir(), "agent-ppt-session-"));
  temporaryDirectories.push(directory);
  const filePath = join(directory, "sessions.json");
  const store = new FileSessionStore(filePath);
  await store.initialize();
  return { store, filePath };
}

async function createStoreWithSession() {
  const result = await createStore();
  await result.store.createSession();
  return result;
}

function must<T>(value: T | null | undefined): T {
  expect(value).toBeDefined();
  return value!;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("FileSessionStore", () => {
  it("starts with an empty bootstrap on first launch", async () => {
    const { store } = await createStore();
    const initial = store.getBootstrap();

    expect(initial.sessions).toHaveLength(0);
    expect(initial.activeSession).toBeUndefined();
  });

  it("creates and restores a new session", async () => {
    const { store, filePath } = await createStoreWithSession();
    const initial = store.getBootstrap();
    const activeSession = must(initial.activeSession);

    expect(initial.sessions).toHaveLength(1);
    // 新会话从空 deck 起步，不再预置占位页
    expect(activeSession.presentation.slides).toHaveLength(0);
    expect(activeSession.project?.artifacts.map((artifact) => artifact.id)).toEqual([
      "brief",
      "outline",
      "research",
      "slides",
      "design",
      "deck",
      "history",
    ]);

    const projectRoot = activeSession.project?.rootPath;
    expect(projectRoot).toBeTruthy();
    expect(activeSession.transcript?.path).toBe(
      join(projectRoot!, "transcripts", `${activeSession.session.id}.jsonl`),
    );
    expect(await readFile(join(projectRoot!, "brief.md"), "utf8")).toContain("**项目名称**");
    expect(await readFile(join(projectRoot!, "outline.md"), "utf8")).toContain("## 1.");
    expect(await readFile(join(projectRoot!, "slides", "001-title.md"), "utf8")).toContain(
      "## 页面目标",
    );

    const restored = new FileSessionStore(filePath);
    await restored.initialize();
    expect(restored.getBootstrap()).toEqual(initial);
  });

  it("persists new sessions, presentation changes, messages, and selection", async () => {
    const { store, filePath } = await createStoreWithSession();
    const originalId = must(store.getBootstrap().activeSession).session.id;
    const created = await store.createSession();
    const createdSession = must(created.activeSession);
    const createdId = createdSession.session.id;
    const presentation = {
      ...createdSession.presentation,
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

    expect(must(state.activeSession).session.id).toBe(originalId);
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

  it("repairs persisted non-positive dimensions without discarding the session", async () => {
    const { store, filePath } = await createStoreWithSession();
    const active = must(store.getBootstrap().activeSession);
    const corrupted = structuredClone(active);
    corrupted.presentation.slides = [
      {
        id: "slide-corrupt",
        title: "高密度列表",
        elements: [
          {
            id: "text-corrupt",
            type: "text",
            x: 120,
            y: 200,
            width: 1000,
            height: -4.57,
            text: "仍需保留的内容",
            fontSize: 20,
          },
        ],
      },
    ];
    await writeFile(
      filePath,
      `${JSON.stringify({
        version: 1,
        activeSessionId: active.session.id,
        sessions: [corrupted],
      })}\n`,
      "utf8",
    );

    const restored = new FileSessionStore(filePath);
    await restored.initialize();
    const repaired = must(restored.getBootstrap().activeSession);

    expect(repaired.session.id).toBe(active.session.id);
    expect(repaired.presentation.slides[0]?.elements[0]?.height).toBe(16);
    expect(repaired.presentation.slides[0]?.elements[0]).toMatchObject({
      id: "text-corrupt",
      text: "仍需保留的内容",
    });
  });

  it("rejects invalid presentation geometry before mutating session state", async () => {
    const { store } = await createStoreWithSession();
    const active = must(store.getBootstrap().activeSession);
    const invalid = structuredClone(active.presentation);
    invalid.slides = [
      {
        id: "slide-invalid",
        title: "非法页面",
        elements: [
          {
            id: "text-invalid",
            type: "text",
            x: 0,
            y: 0,
            width: 100,
            height: 0,
            text: "非法尺寸",
            fontSize: 20,
          },
        ],
      },
    ];

    await expect(store.savePresentation(active.session.id, invalid)).rejects.toThrow();
    expect(store.getSession(active.session.id).presentation.slides).toHaveLength(0);
  });

  it("migrates existing sessions into project sandboxes", async () => {
    const { store, filePath } = await createStoreWithSession();
    const legacyState = store.getBootstrap();
    const activeSession = must(legacyState.activeSession);
    const legacySnapshot = {
      ...activeSession,
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
    const migrated = must(restored.getBootstrap().activeSession);

    expect(migrated.project?.rootPath).toContain(`session-${migrated.session.id}`);
    expect(migrated.transcript?.path).toBe(
      join(migrated.project!.rootPath, "transcripts", `${migrated.session.id}.jsonl`),
    );
    expect(await readFile(join(migrated.project!.rootPath, "research", "notes.md"), "utf8"))
      .toContain("**行业数据**");
  });

  it("records saved chat messages into an append-only transcript chain", async () => {
    const { store, filePath } = await createStoreWithSession();
    const sessionId = must(store.getBootstrap().activeSession).session.id;

    await store.saveMessages(sessionId, [
      { id: "u1", role: "user", content: "创建一份产品发布 PPT" },
    ]);
    await store.saveMessages(sessionId, [
      { id: "u1", role: "user", content: "创建一份产品发布 PPT" },
      {
        id: "a1",
        role: "assistant",
        content: "请确认大纲",
        threadId: "thread-1",
      },
    ]);
    await store.saveMessages(sessionId, [
      { id: "u1", role: "user", content: "创建一份产品发布 PPT" },
      {
        id: "a1",
        role: "assistant",
        content: "请确认大纲",
        threadId: "thread-1",
      },
    ]);

    const snapshot = store.getSession(sessionId);
    const transcriptPath = snapshot.transcript?.path;
    expect(transcriptPath).toBeTruthy();
    expect(snapshot.transcript?.leafMessageUuid).toBe("a1");

    const lines = (await readFile(transcriptPath!, "utf8")).trim().split(/\r?\n/);
    expect(lines).toHaveLength(2);
    const transcriptMessages = lines.map((line) => JSON.parse(line));
    expect(transcriptMessages[0]).not.toHaveProperty("parentUuid");
    expect(transcriptMessages).toMatchObject([
      {
        uuid: "u1",
        sessionId,
        role: "user",
        kind: "message",
        content: "创建一份产品发布 PPT",
      },
      {
        uuid: "a1",
        parentUuid: "u1",
        sessionId,
        role: "assistant",
        kind: "message",
        content: "请确认大纲",
        threadId: "thread-1",
      },
    ]);

    const restored = new FileSessionStore(filePath);
    await restored.initialize();
    expect(restored.getSession(sessionId).transcript?.leafMessageUuid).toBe("a1");
  });

  it("restores messages from the transcript instead of the session snapshot cache", async () => {
    const { store, filePath } = await createStoreWithSession();
    const sessionId = must(store.getBootstrap().activeSession).session.id;
    await store.saveMessages(sessionId, [
      { id: "u1", role: "user", content: "真实用户消息" },
      { id: "a1", role: "assistant", content: "真实助手回复" },
    ]);

    const persisted = JSON.parse(await readFile(filePath, "utf8"));
    persisted.sessions[0].messages = [
      { id: "stale", role: "assistant", content: "过期快照缓存" },
    ];
    await writeFile(filePath, `${JSON.stringify(persisted, null, 2)}\n`, "utf8");

    const restored = new FileSessionStore(filePath);
    await restored.initialize();
    const restoredSession = restored.getSession(sessionId);

    expect(restoredSession.messages.map((message) => message.content)).toEqual([
      "真实用户消息",
      "真实助手回复",
    ]);
    expect(restored.getAgentMessageHistory(sessionId)).toEqual([
      { role: "user", content: "真实用户消息" },
      { role: "assistant", content: "真实助手回复" },
    ]);
  });

  it("reads and writes project artifacts inside the sandbox", async () => {
    const { store } = await createStoreWithSession();
    const sessionId = must(store.getBootstrap().activeSession).session.id;

    const outline = await store.readProjectArtifact(sessionId, "outline");
    expect(outline).toMatchObject({
      path: "outline.md",
      type: "file",
    });
    expect(outline.content).toContain("## 1.");

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
    const { store } = await createStoreWithSession();
    const sessionId = must(store.getBootstrap().activeSession).session.id;
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
    const { store } = await createStoreWithSession();
    const sessionId = must(store.getBootstrap().activeSession).session.id;

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
    const { store } = await createStoreWithSession();
    const sessionId = must(store.getBootstrap().activeSession).session.id;

    const diff = await store.getProjectArtifactDiff(
      sessionId,
      "outline.md",
      "# Outline\n\n## 新结构\n",
    );

    expect(diff.changed).toBe(true);
    expect(diff.before).toContain("## 1.");
    expect(diff.after).toContain("## 新结构");
    expect(diff.unifiedDiff).toContain("--- a/outline.md");
    expect(diff.unifiedDiff).toContain("+++ b/outline.md");
  });

  it("expires pending approvals after an application restart", async () => {
    const { store, filePath } = await createStoreWithSession();
    const sessionId = must(store.getBootstrap().activeSession).session.id;
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
    const message = must(restored.getBootstrap().activeSession).messages[0];

    expect(message.approval).toBeUndefined();
    expect(message.content).toContain("审批请求已随应用重启失效");
  });

  it("preserves pending threadId metadata after an application restart", async () => {
    const { store, filePath } = await createStoreWithSession();
    const sessionId = must(store.getBootstrap().activeSession).session.id;
    await store.saveMessages(sessionId, [
      {
        id: "outline-1",
        role: "assistant",
        content: "请确认大纲",
        threadId: "thread-1",
      },
    ]);

    const restored = new FileSessionStore(filePath);
    await restored.initialize();
    const threadId = must(restored.getBootstrap().activeSession).messages[0].threadId;

    expect(threadId).toBe("thread-1");
  });

  it("preserves structured question metadata after an application restart", async () => {
    const { store, filePath } = await createStoreWithSession();
    const sessionId = must(store.getBootstrap().activeSession).session.id;
    await store.saveMessages(sessionId, [
      {
        id: "question-1",
        role: "assistant",
        content: "请选择排版方式",
        threadId: "thread-1",
        question: {
          variant: "cards",
          selectionMode: "single",
          options: [
            {
              id: "template",
              title: "标准排版",
              description: "主题加模板，稳定快速",
              value: "选择标准排版",
            },
          ],
        },
      },
    ]);

    const restored = new FileSessionStore(filePath);
    await restored.initialize();
    const question = must(restored.getBootstrap().activeSession).messages[0].question;

    expect(question?.variant).toBe("cards");
    expect(question?.options?.[0]?.value).toBe("选择标准排版");
  });

  it("preserves explicit inline card metadata after an application restart", async () => {
    const { store, filePath } = await createStoreWithSession();
    const sessionId = must(store.getBootstrap().activeSession).session.id;
    await store.saveMessages(sessionId, [
      {
        id: "inline-card-1",
        role: "assistant",
        content: "请确认当前产物。",
        inlineCards: [{ type: "outline" }],
      },
    ]);

    const restored = new FileSessionStore(filePath);
    await restored.initialize();
    const inlineCards = must(restored.getBootstrap().activeSession).messages[0].inlineCards;

    expect(inlineCards).toEqual([{ type: "outline" }]);
  });

  it("recovers pending thread conversations from the transcript when the snapshot cache is stale", async () => {
    const { store, filePath } = await createStoreWithSession();
    const sessionId = must(store.getBootstrap().activeSession).session.id;
    await store.saveMessages(sessionId, [
      { id: "u1", role: "user", content: "创建一份 Agent 架构 PPT" },
      {
        id: "outline-1",
        role: "assistant",
        content: "请确认大纲",
        threadId: "thread-1",
      },
    ]);

    const persisted = JSON.parse(await readFile(filePath, "utf8"));
    persisted.sessions[0].messages = [
      { id: "stale", role: "assistant", content: "过期的终局回复" },
    ];
    await writeFile(filePath, `${JSON.stringify(persisted, null, 2)}\n`, "utf8");

    const restored = new FileSessionStore(filePath);
    await restored.initialize();
    const restoredSession = restored.getSession(sessionId);

    expect(restoredSession.messages[0]).toMatchObject({
      id: "u1",
      role: "user",
      content: "创建一份 Agent 架构 PPT",
    });
    expect(restoredSession.messages[1]).toMatchObject({
      id: "outline-1",
      role: "assistant",
      content: "请确认大纲",
      threadId: "thread-1",
    });
  });

  it("records edited messages as a new transcript branch and can switch leaves", async () => {
    const { store, filePath } = await createStoreWithSession();
    const sessionId = must(store.getBootstrap().activeSession).session.id;

    await store.saveMessages(sessionId, [
      { id: "u1", role: "user", content: "创建 PPT" },
      { id: "a1", role: "assistant", content: "初版大纲" },
      { id: "u2", role: "user", content: "走企业风" },
      { id: "a2", role: "assistant", content: "企业风方案" },
    ]);
    await store.saveMessages(sessionId, [
      { id: "u1", role: "user", content: "创建 PPT" },
      { id: "a1", role: "assistant", content: "初版大纲" },
      { id: "u3", role: "user", content: "改成发布会风格" },
    ]);

    const snapshot = store.getSession(sessionId);
    expect(snapshot.transcript?.leafMessageUuid).toBe("u3");
    expect(snapshot.messages.map((message) => [message.id, message.content])).toEqual([
      ["u1", "创建 PPT"],
      ["a1", "初版大纲"],
      ["u3", "改成发布会风格"],
    ]);

    const lines = (await readFile(snapshot.transcript!.path, "utf8")).trim().split(/\r?\n/);
    const transcriptMessages = lines.map((line) => JSON.parse(line));
    expect(transcriptMessages.map((message) => message.uuid)).toEqual([
      "u1",
      "a1",
      "u2",
      "a2",
      "u3",
    ]);
    expect(transcriptMessages.find((message) => message.uuid === "u3")).toMatchObject({
      parentUuid: "a1",
      content: "改成发布会风格",
    });

    await store.switchLeaf(sessionId, "a2");
    expect(store.getSession(sessionId).messages.map((message) => message.id)).toEqual([
      "u1",
      "a1",
      "u2",
      "a2",
    ]);

    const restored = new FileSessionStore(filePath);
    await restored.initialize();
    expect(restored.getSession(sessionId).transcript?.leafMessageUuid).toBe("a2");
  });

  it("deletes a session and updates state", async () => {
    const { store } = await createStoreWithSession();
    const state1 = store.getBootstrap();
    const id1 = must(state1.activeSession).session.id;

    // Create a second session
    const state2 = await store.createSession();
    const id2 = must(state2.activeSession).session.id;
    expect(state2.sessions).toHaveLength(2);
    expect(must(state2.activeSession).session.id).toBe(id2);

    // Delete the second session (active)
    const state3 = await store.deleteSession(id2);
    expect(state3.sessions).toHaveLength(1);
    expect(must(state3.activeSession).session.id).toBe(id1);

    // Delete the only remaining session
    const state4 = await store.deleteSession(id1);
    expect(state4.sessions).toHaveLength(0);
    expect(state4.activeSession).toBeUndefined();
  });

  it("maintains presentation and deck/snapshot.json consistency", async () => {
    const { store, filePath } = await createStoreWithSession();
    const sessionId = must(store.getBootstrap().activeSession).session.id;

    const newPresentation = {
      id: "pres-id",
      title: "New Title Value",
      revision: 42,
      slides: [
        {
          id: "slide-1",
          title: "Slide One Title",
          elements: [],
        },
      ],
    };

    // Save presentation
    await store.savePresentation(sessionId, newPresentation);

    // Retrieve active session state
    const session = store.getSession(sessionId);
    expect(session.presentation).toEqual(newPresentation);

    // Check deck snapshot file on disk
    const deckSnapshot = JSON.parse(
      await readFile(join(session.project!.rootPath, "deck", "snapshot.json"), "utf8"),
    );
    expect(deckSnapshot).toEqual(newPresentation);
  });

  it("creates sessions in a user-selected workspace directory", async () => {
    const { store } = await createStore();
    const workspaceDir = join(tmpdir(), "agent-ppt-workspace-shared");
    temporaryDirectories.push(workspaceDir);

    const created = await store.createSession({ rootPath: workspaceDir, title: "共享目录项目" });
    const createdSession = must(created.activeSession);
    const sessionId = createdSession.session.id;
    const sandboxDir = getSessionSandboxPath(workspaceDir, sessionId);
    const normalize = (value: string) => value.replace(/\\/g, "/").toLowerCase();
    expect(normalize(createdSession.project?.rootPath ?? "")).toBe(normalize(sandboxDir));
    expect(normalize(created.sessions[0].workspacePath ?? "")).toBe(normalize(workspaceDir));
    expect(await readFile(join(sandboxDir, "brief.md"), "utf8")).toContain("**项目名称**");
  });

  it("keeps independent sandboxes for multiple sessions in one workspace", async () => {
    const { store } = await createStore();
    const workspaceDir = join(tmpdir(), "agent-ppt-workspace-isolated");
    temporaryDirectories.push(workspaceDir);

    const first = await store.createSession({ rootPath: workspaceDir, title: "对话一" });
    await store.writeProjectArtifact(
      must(first.activeSession).session.id,
      "brief.md",
      "# 对话一专属 Brief\n",
    );

    const second = await store.createSession({ rootPath: workspaceDir, title: "对话二" });
    const firstSandbox = getSessionSandboxPath(workspaceDir, must(first.activeSession).session.id);
    const secondSandbox = getSessionSandboxPath(workspaceDir, must(second.activeSession).session.id);

    expect(firstSandbox).not.toBe(secondSandbox);
    expect(await readFile(join(firstSandbox, "brief.md"), "utf8")).toContain("对话一专属 Brief");
    expect(await readFile(join(secondSandbox, "brief.md"), "utf8")).toContain("对话二");
  });

  it("opens an existing workspace and reuses its latest session", async () => {
    const { store } = await createStore();
    const workspaceDir = join(tmpdir(), "agent-ppt-workspace-open");
    temporaryDirectories.push(workspaceDir);

    const first = await store.createSession({ rootPath: workspaceDir, title: "对话一" });
    const second = await store.createSession({ rootPath: workspaceDir, title: "对话二" });

    const opened = await store.openWorkspace(workspaceDir);
    expect(must(opened.activeSession).session.id).toBe(must(second.activeSession).session.id);
    const normalize = (value: string) => value.replace(/\\/g, "/").toLowerCase();
    expect(
      opened.sessions.filter(
        (session) => normalize(session.workspacePath ?? "") === normalize(workspaceDir),
      ),
    ).toHaveLength(2);
    expect(must(first.activeSession).session.id).not.toBe(must(opened.activeSession).session.id);
  });

  it("persists workspace session index and snapshot files under .agent-ppt", async () => {
    const { store } = await createStore();
    const workspaceDir = join(tmpdir(), "agent-ppt-workspace-index");
    temporaryDirectories.push(workspaceDir);

    const created = await store.createSession({ rootPath: workspaceDir, title: "索引测试" });
    const sessionId = must(created.activeSession).session.id;

    const index = JSON.parse(
      await readFile(join(workspaceDir, ".agent-ppt", "sessions.index.json"), "utf8"),
    );
    expect(index.activeSessionId).toBe(sessionId);
    expect(index.sessions).toHaveLength(1);
    expect(index.sessions[0].title).toBe("索引测试");

    const projectMeta = JSON.parse(
      await readFile(join(workspaceDir, ".agent-ppt", "project.json"), "utf8"),
    );
    expect(projectMeta.version).toBe(1);

    const snapshot = JSON.parse(
      await readFile(join(workspaceDir, ".agent-ppt", "sessions", `${sessionId}.json`), "utf8"),
    );
    expect(snapshot.session.id).toBe(sessionId);
    expect(snapshot.presentation.title).toBe("索引测试");
  });

  it("lists workspace sessions from the local index", async () => {
    const { store } = await createStore();
    const workspaceDir = join(tmpdir(), "agent-ppt-workspace-list");
    temporaryDirectories.push(workspaceDir);

    await store.createSession({ rootPath: workspaceDir, title: "对话一" });
    await store.createSession({ rootPath: workspaceDir, title: "对话二" });

    const listed = await store.listWorkspaceSessions(workspaceDir);
    expect(listed).toHaveLength(2);
    expect(listed.map((session) => session.title).sort()).toEqual(["对话一", "对话二"]);
  });

  it("hydrates workspace sessions from index when global store is empty", async () => {
    const { store, filePath } = await createStore();
    const workspaceDir = join(tmpdir(), "agent-ppt-workspace-hydrate");
    temporaryDirectories.push(workspaceDir);

    const created = await store.createSession({ rootPath: workspaceDir, title: "离线恢复" });
    const sessionId = must(created.activeSession).session.id;

    const fresh = new FileSessionStore(filePath);
    await fresh.initialize();
    const opened = await fresh.openWorkspace(workspaceDir);

    expect(must(opened.activeSession).session.id).toBe(sessionId);
    expect(must(opened.activeSession).session.title).toBe("离线恢复");
  });

  it("migrates legacy projects/session-{id} sandboxes into a workspace directory", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agent-ppt-legacy-migrate-"));
    temporaryDirectories.push(directory);
    const targetWorkspace = await mkdtemp(join(tmpdir(), "agent-ppt-target-workspace-"));
    temporaryDirectories.push(targetWorkspace);
    const filePath = join(directory, "sessions.json");
    const projectsRoot = join(directory, "projects");
    const store = new FileSessionStore(filePath, projectsRoot);
    await store.initialize();
    const created = await store.createSession();
    const legacySessionId = created.activeSession!.session.id;

    await store.migrateLegacySessionToWorkspace(legacySessionId, targetWorkspace);

    const migrated = store.getSession(legacySessionId);
    const normalize = (value: string) => value.replace(/\\/g, "/").toLowerCase();
    const sessionSandbox = getSessionSandboxPath(targetWorkspace, legacySessionId);
    expect(normalize(migrated.project?.rootPath ?? "")).toBe(normalize(sessionSandbox));
    expect(await readFile(join(sessionSandbox, "brief.md"), "utf8")).toContain("**项目名称**");
    expect(
      JSON.parse(await readFile(join(targetWorkspace, ".agent-ppt", "sessions.index.json"), "utf8"))
        .sessions,
    ).toHaveLength(1);
  });

  it("preserves root-level outline when migrating a flat workspace sandbox", async () => {
    const { store, filePath } = await createStoreWithSession();
    const workspaceDir = await mkdtemp(join(tmpdir(), "agent-ppt-flat-outline-"));
    temporaryDirectories.push(workspaceDir);
    const snapshot = store.getBootstrap().activeSession;
    if (!snapshot?.project) throw new Error("Expected initialized session project.");
    const sessionId = snapshot.session.id;

    await writeFile(
      join(workspaceDir, "outline.md"),
      "# 演示大纲\n\n## 1. 根目录旧大纲 [预计 1 页]\n- 应迁移到独立沙箱\n",
      "utf8",
    );
    snapshot.session.workspacePath = workspaceDir;
    snapshot.project.rootPath = workspaceDir;
    await writeFile(
      filePath,
      `${JSON.stringify({
        version: 1,
        activeSessionId: sessionId,
        sessions: [snapshot],
      })}\n`,
      "utf8",
    );

    const restored = new FileSessionStore(filePath);
    await restored.initialize();
    const migrated = restored.getSession(sessionId);
    const sessionSandbox = getSessionSandboxPath(workspaceDir, sessionId);
    const normalize = (value: string) => value.replace(/\\/g, "/").toLowerCase();

    expect(normalize(migrated.project?.rootPath ?? "")).toBe(normalize(sessionSandbox));
    expect(await readFile(join(sessionSandbox, "outline.md"), "utf8")).toContain("根目录旧大纲");
  });
});
