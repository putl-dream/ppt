import { beforeAll, afterEach, describe, expect, it, vi } from "vitest";
import { useProjectStore } from "../src/renderer/src/components/project-store";

const mockDesktopApi = {
  readProjectArtifact: vi.fn(),
  openProjectFile: vi.fn(),
  saveProjectFile: vi.fn(),
  markProjectArtifactStatus: vi.fn(),
};

const FILE_VERSION = `sha256:${"a".repeat(64)}`;

function openedProjectFile(
  path: string,
  content: string,
  version = FILE_VERSION,
  editToken = "11111111-1111-4111-8111-111111111111",
) {
  return {
    path,
    content,
    version,
    mtimeMs: 1,
    size: content.length,
    encoding: "utf8" as const,
    newline: content.includes("\n") ? "lf" as const : "none" as const,
    editToken,
    editable: true,
  };
}

beforeAll(() => {
  global.window = {
    desktopApi: mockDesktopApi,
    clearTimeout: (timer: any) => clearTimeout(timer),
    setTimeout: (cb: any, ms: any) => setTimeout(cb, ms),
  } as any;
});

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  useProjectStore.getState().resetProject();
});

describe("project-store zustand store", () => {
  it("initializes project correctly", () => {
    const store = useProjectStore.getState();
    store.initializeProject("test-session", "Test Project");

    const state = useProjectStore.getState();
    expect(state.activeProject).not.toBeNull();
    expect(state.activeProject?.id).toBe("test-session");
    expect(state.activeProject?.name).toBe("Test Project");

    const briefArtifact = state.activeProject?.artifacts.brief;
    expect(briefArtifact?.id).toBe("brief");
    expect(briefArtifact?.isHydrated).toBe(false);
    expect(briefArtifact?.content).toContain("演示文稿 Brief");
  });

  it("initializes all artifact shells with default template content", () => {
    const store = useProjectStore.getState();
    store.initializeProject("test-session", "Test Project");

    const state = useProjectStore.getState();
    expect(state.activeProject?.artifacts.outline.content).toContain("演示大纲");
    expect(state.activeProject?.artifacts.deck.content).toContain("新演示文稿");
  });

  it("hydrates project artifacts correctly from backend", async () => {
    mockDesktopApi.readProjectArtifact.mockImplementation(async (sessionId, path) => {
      if (path === "brief.md") {
        return { type: "file", content: "# Custom Brief Content" };
      }
      if (path === "outline.md") {
        return { type: "file", content: "# Custom Outline Content" };
      }
      return { type: "file", content: "" };
    });

    const store = useProjectStore.getState();
    store.initializeProject("test-session", "Test Project");
    await store.hydrateProjectArtifacts("test-session");

    const state = useProjectStore.getState();
    const brief = state.activeProject?.artifacts.brief;
    const outline = state.activeProject?.artifacts.outline;

    expect(brief?.content).toBe("# Custom Brief Content");
    expect(brief?.isHydrated).toBe(true);
    expect(outline?.content).toBe("# Custom Outline Content");
    expect(outline?.isHydrated).toBe(true);
    expect(mockDesktopApi.readProjectArtifact).toHaveBeenCalledTimes(6); // brief, outline, research, slides, design, deck
  });

  it("updates artifact content and propagates stale status to downstream artifacts", async () => {
    vi.useFakeTimers();

    mockDesktopApi.openProjectFile.mockImplementation(async (_sessionId, path) =>
      openedProjectFile(path, ""));
    mockDesktopApi.saveProjectFile.mockImplementation(async (_sessionId, path) => ({
      path,
      changed: false,
      staleArtifactIds: [],
      version: FILE_VERSION,
      mtimeMs: 2,
      size: 0,
      encoding: "utf8",
      newline: "none",
      characterCount: 0,
      editToken: "11111111-1111-4111-8111-111111111111",
    }));
    mockDesktopApi.markProjectArtifactStatus.mockImplementation(async (_sessionId, id) => ({
      id,
      title: id,
      path: `${id}.md`,
      status: "ready",
      dependsOn: [],
    }));

    const store = useProjectStore.getState();
    store.initializeProject("test-session", "Test Project");

    // mark all stages ready first
    for (const stage of ["brief", "outline", "research", "design", "slides", "deck"] as const) {
      await store.markStageReady(stage);
    }

    mockDesktopApi.openProjectFile.mockClear();
    mockDesktopApi.saveProjectFile.mockClear();
    mockDesktopApi.openProjectFile.mockResolvedValue(
      openedProjectFile("brief.md", "# Previous Brief"),
    );
    mockDesktopApi.saveProjectFile.mockResolvedValue({
      path: "brief.md",
      changed: true,
      changedArtifactId: "brief",
      staleArtifactIds: ["outline", "research", "design", "slides", "deck"],
      version: `sha256:${"b".repeat(64)}`,
      mtimeMs: 2,
      size: 19,
      encoding: "utf8",
      newline: "none",
      characterCount: 19,
      editToken: "11111111-1111-4111-8111-111111111111",
    });

    let state = useProjectStore.getState();
    expect(state.activeProject?.artifacts.brief.status).toBe("ready");
    expect(state.activeProject?.artifacts.outline.status).toBe("ready");

    // update brief content
    store.updateArtifactContent("brief", "# New Brief Content", "user");

    state = useProjectStore.getState();
    expect(state.activeProject?.artifacts.brief.content).toBe("# New Brief Content");
    // status propagates to stale immediately for downstream due to local propagateStale
    expect(state.activeProject?.artifacts.brief.status).toBe("ready"); // upstream edited locally
    expect(state.activeProject?.artifacts.outline.status).toBe("stale");
    expect(state.activeProject?.artifacts.deck.status).toBe("stale");

    // Fast-forward write debouncer
    vi.advanceTimersByTime(400);

    // wait for promises to resolve
    await vi.runAllTimersAsync();

    expect(mockDesktopApi.openProjectFile).toHaveBeenCalledWith(
      "test-session",
      "brief.md",
    );
    expect(mockDesktopApi.saveProjectFile).toHaveBeenCalledWith(
      "test-session",
      "brief.md",
      "# New Brief Content",
      "11111111-1111-4111-8111-111111111111",
      FILE_VERSION,
    );

    // after write resolves, check applied write result
    state = useProjectStore.getState();
    expect(state.activeProject?.artifacts.brief.status).toBe("draft");
    expect(state.activeProject?.artifacts.outline.status).toBe("stale");
  });

  it("marks stage ready and calls backend write + status updates", async () => {
    mockDesktopApi.markProjectArtifactStatus.mockResolvedValue({
      id: "brief",
      title: "Brief",
      path: "brief.md",
      status: "ready",
      dependsOn: [],
    });

    const store = useProjectStore.getState();
    store.initializeProject("test-session", "Test Project");
    const briefContent = useProjectStore.getState().activeProject!.artifacts.brief.content;
    mockDesktopApi.openProjectFile.mockResolvedValue(
      openedProjectFile("brief.md", briefContent),
    );
    
    await store.markStageReady("brief");

    const state = useProjectStore.getState();
    expect(state.activeProject?.artifacts.brief.status).toBe("ready");
    expect(mockDesktopApi.openProjectFile).toHaveBeenCalledWith(
      "test-session",
      "brief.md",
    );
    expect(mockDesktopApi.saveProjectFile).not.toHaveBeenCalled();
    expect(mockDesktopApi.markProjectArtifactStatus).toHaveBeenCalledWith(
      "test-session",
      "brief",
      "ready",
    );
  });

  it("does not report a stage as ready when persistence fails", async () => {
    mockDesktopApi.openProjectFile.mockResolvedValue(
      openedProjectFile("brief.md", "persisted"),
    );
    mockDesktopApi.saveProjectFile.mockRejectedValue(new Error("disk full"));

    const store = useProjectStore.getState();
    store.initializeProject("test-session", "Test Project");

    await expect(store.markStageReady("brief")).rejects.toThrow("disk full");

    const brief = useProjectStore.getState().activeProject?.artifacts.brief;
    expect(brief?.status).toBe("draft");
    expect(brief?.lastWriteError).toBe("disk full");
    expect(mockDesktopApi.markProjectArtifactStatus).not.toHaveBeenCalled();
  });

  it("opens each autosave baseline and uses the next receipt for continued edits", async () => {
    vi.useFakeTimers();
    const nextVersion = `sha256:${"b".repeat(64)}`;
    const firstToken = "11111111-1111-4111-8111-111111111111";
    const secondToken = "22222222-2222-4222-8222-222222222222";
    mockDesktopApi.openProjectFile
      .mockResolvedValueOnce(openedProjectFile("brief.md", "# Disk\n", FILE_VERSION, firstToken))
      .mockResolvedValueOnce(openedProjectFile("brief.md", "# First\n", nextVersion, secondToken));
    mockDesktopApi.saveProjectFile
      .mockResolvedValueOnce({
        path: "brief.md",
        changed: true,
        changedArtifactId: "brief",
        staleArtifactIds: [],
        version: nextVersion,
        mtimeMs: 2,
        size: 8,
        encoding: "utf8",
        newline: "lf",
        characterCount: 8,
        editToken: firstToken,
      })
      .mockResolvedValueOnce({
        path: "brief.md",
        changed: true,
        changedArtifactId: "brief",
        staleArtifactIds: [],
        version: `sha256:${"c".repeat(64)}`,
        mtimeMs: 3,
        size: 9,
        encoding: "utf8",
        newline: "lf",
        characterCount: 9,
        editToken: secondToken,
      });

    const store = useProjectStore.getState();
    store.initializeProject("test-session", "Test Project");
    store.updateArtifactContent("brief", "# First\n", "user");
    vi.advanceTimersByTime(400);
    await vi.runAllTimersAsync();

    useProjectStore.getState().updateArtifactContent("brief", "# Second\n", "user");
    vi.advanceTimersByTime(400);
    await vi.runAllTimersAsync();

    expect(mockDesktopApi.saveProjectFile).toHaveBeenNthCalledWith(
      1,
      "test-session",
      "brief.md",
      "# First\n",
      firstToken,
      FILE_VERSION,
    );
    expect(mockDesktopApi.saveProjectFile).toHaveBeenNthCalledWith(
      2,
      "test-session",
      "brief.md",
      "# Second\n",
      secondToken,
      nextVersion,
    );
  });

  it("keeps the current autosave draft and requires a reread after a conflict", async () => {
    vi.useFakeTimers();
    mockDesktopApi.openProjectFile.mockResolvedValue(
      openedProjectFile("brief.md", "# Disk baseline\n"),
    );
    mockDesktopApi.saveProjectFile.mockRejectedValue(
      Object.assign(new Error("stale editor version"), { code: "STALE_FILE" }),
    );
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      const store = useProjectStore.getState();
      store.initializeProject("test-session", "Test Project");
      store.updateArtifactContent("brief", "# Unsaved current draft\n", "user");
      vi.advanceTimersByTime(400);
      await vi.runAllTimersAsync();

      const brief = useProjectStore.getState().activeProject?.artifacts.brief;
      expect(brief?.content).toBe("# Unsaved current draft\n");
      expect(brief?.lastWriteError).toBe(
        "文件已在磁盘上变化，当前草稿已保留；请重新读取后再保存。",
      );
      expect(mockDesktopApi.saveProjectFile).toHaveBeenCalledTimes(1);
    } finally {
      consoleError.mockRestore();
    }
  });
});
