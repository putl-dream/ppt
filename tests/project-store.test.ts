import { beforeAll, afterEach, describe, expect, it, vi } from "vitest";
import { useProjectStore } from "../src/renderer/src/components/project-store";

const mockDesktopApi = {
  readProjectArtifact: vi.fn(),
  writeProjectArtifact: vi.fn(),
  markProjectArtifactStatus: vi.fn(),
};

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

    mockDesktopApi.writeProjectArtifact.mockResolvedValue({
      path: "brief.md",
      changed: true,
      changedArtifactId: "brief",
      staleArtifactIds: ["outline", "research", "design", "slides", "deck"],
    });

    const store = useProjectStore.getState();
    store.initializeProject("test-session", "Test Project");

    // mark all stages ready first
    for (const stage of ["brief", "outline", "research", "design", "slides", "deck"] as const) {
      store.markStageReady(stage);
    }

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

    expect(mockDesktopApi.writeProjectArtifact).toHaveBeenCalledWith(
      "test-session",
      "brief.md",
      "# New Brief Content",
    );

    // after write resolves, check applied write result
    state = useProjectStore.getState();
    expect(state.activeProject?.artifacts.brief.status).toBe("draft");
    expect(state.activeProject?.artifacts.outline.status).toBe("stale");
  });

  it("marks stage ready and calls backend write + status updates", async () => {
    mockDesktopApi.writeProjectArtifact.mockResolvedValue({
      path: "brief.md",
      changed: false,
      staleArtifactIds: [],
    });
    mockDesktopApi.markProjectArtifactStatus.mockResolvedValue({
      id: "brief",
      title: "Brief",
      path: "brief.md",
      status: "ready",
      dependsOn: [],
    });

    const store = useProjectStore.getState();
    store.initializeProject("test-session", "Test Project");
    
    await store.markStageReady("brief");

    const state = useProjectStore.getState();
    expect(state.activeProject?.artifacts.brief.status).toBe("ready");
    expect(mockDesktopApi.writeProjectArtifact).toHaveBeenCalledWith(
      "test-session",
      "brief.md",
      expect.any(String),
    );
    expect(mockDesktopApi.markProjectArtifactStatus).toHaveBeenCalledWith(
      "test-session",
      "brief",
      "ready",
    );
  });
});
