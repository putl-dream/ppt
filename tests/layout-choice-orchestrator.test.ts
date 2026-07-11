import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { prepareLayoutChoiceTask } from "../src/main/agent/runtime/layout-choice-orchestrator";
import { TaskStore } from "../src/main/agent/task/task-store";
import { createDefaultToolRegistry } from "../src/main/agent/tools/tool-registry";
import { createStarterPresentation } from "../src/shared/presentation";
import { AgentRuntime } from "../src/main/agent/runtime/agent-runtime";
import { TEST_DESIGN_SYSTEM } from "./design-engine-test-utils";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("layout choice runtime orchestration", () => {
  it("creates one autonomous layout task and persists structured inputs", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "ppt-layout-choice-"));
    tempDirs.push(workspaceRoot);
    const taskStore = new TaskStore(workspaceRoot);
    const teammates: any[] = [];
    const spawn = vi.fn((options: any) => {
      const handle = {
        name: options.name,
        role: options.role,
        status: "running",
        startedAt: Date.now(),
        lastActiveAt: Date.now(),
      };
      teammates.push(handle);
      return handle;
    });
    const presentation = createStarterPresentation();
    const notifyTaskGraphUpdated = vi.fn();
    const toolContext = {
      presentation,
      selectedElementIds: [],
      discoverySession: { discoveredToolNames: new Set<string>() },
      registry: createDefaultToolRegistry(),
      messageHistory: [],
      workspaceRoot,
      gateway: {},
      taskStore,
      teammateManager: { list: () => teammates, spawn },
      notifyTaskGraphUpdated,
    } as any;

    const first = await prepareLayoutChoiceTask({
      choice: { mode: "creative", designSystem: TEST_DESIGN_SYSTEM },
      presentation,
      workspaceRoot,
      taskStore,
      toolContext,
    });
    const second = await prepareLayoutChoiceTask({
      choice: { mode: "creative", designSystem: TEST_DESIGN_SYSTEM },
      presentation,
      workspaceRoot,
      taskStore,
      toolContext,
    });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.task.id).toBe(first.task.id);
    expect(first.task.executionTarget).toBe("teammate");
    expect(first.task.description).toContain("slides/layout-choice.json");
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(spawn).toHaveBeenCalledWith(expect.objectContaining({ startIdle: true }));
    expect(notifyTaskGraphUpdated).toHaveBeenCalled();

    const choice = JSON.parse(
      await readFile(join(workspaceRoot, "slides", "layout-choice.json"), "utf8"),
    );
    expect(choice).toMatchObject({ mode: "creative", designSystem: TEST_DESIGN_SYSTEM });
    const snapshot = JSON.parse(
      await readFile(join(workspaceRoot, "slides", "layout-input.json"), "utf8"),
    );
    expect(snapshot.id).toBe(presentation.id);
  });

  it("short-circuits the lead model and schedules directly from structured metadata", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "ppt-layout-runtime-"));
    tempDirs.push(workspaceRoot);
    const generateText = vi.fn(() => {
      throw new Error("Lead model should not be called for layout selection scheduling.");
    });
    const gateway = {
      generateText,
      async *generateTextStream() {
        throw new Error("Lead model stream should not be called for layout selection scheduling.");
      },
    } as any;
    const teammates: any[] = [];
    const manager = {
      list: () => teammates,
      spawn: vi.fn((options: any) => {
        const handle = {
          name: options.name,
          role: options.role,
          status: "running",
          startedAt: Date.now(),
          lastActiveAt: Date.now(),
        };
        teammates.push(handle);
        return handle;
      }),
    } as any;
    const runtime = new AgentRuntime(createDefaultToolRegistry(), gateway);

    const result = await runtime.run({
      threadId: "layout-choice-thread",
      request: "排版方式已确认：标准模式；主题 ocean；调色板 cyan。",
      presentationSnapshot: createStarterPresentation(),
      selectedElementIds: [],
      workspaceRoot,
      teammateManager: manager,
      layoutChoice: { mode: "template", designSystem: TEST_DESIGN_SYSTEM },
    });

    expect(result).toMatchObject({ type: "message" });
    expect(result.type === "message" && result.content).toContain("自主领取");
    expect(generateText).not.toHaveBeenCalled();
    expect((await new TaskStore(workspaceRoot).listTasks())).toHaveLength(1);
  });
});
