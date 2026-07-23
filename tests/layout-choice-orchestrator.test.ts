import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { prepareLayoutChoiceTask } from "../src/main/agent/runtime/presentation/layout-choice-orchestrator";
import { TaskStore } from "../src/main/agent/task/task-store";
import { createDefaultToolRegistry } from "../src/main/agent/tools/tool-registry";
import { createStarterPresentation } from "../src/shared/presentation";
import { AgentRuntime } from "../src/main/agent/runtime/agent-runtime";
import { TEST_DESIGN_SYSTEM } from "./design-engine-test-utils";
import { clearHooks, registerHook } from "../src/main/agent/runtime/hooks/hook-registry";
import type { StopBlock } from "../src/main/agent/runtime/hooks/hook-blocks";
import { DurableRunStore } from "../src/main/agent/persistence/durable-run-store";

const tempDirs: string[] = [];

afterEach(async () => {
  clearHooks();
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
    const runtimeRoot = join(workspaceRoot, "runtime");
    const stops: StopBlock[] = [];
    registerHook("Stop", (block) => { stops.push(block as StopBlock); return null; });

    const result = await runtime.run({
      threadId: "layout-choice-thread",
      request: "排版方式已确认：标准模式；主题 ocean；调色板 cyan。",
      presentationSnapshot: createStarterPresentation(),
      selectedElementIds: [],
      workspaceRoot,
      runtimeRoot,
      teammateManager: manager,
      layoutChoice: { mode: "template", designSystem: TEST_DESIGN_SYSTEM },
    });

    expect(result).toMatchObject({ type: "message" });
    expect(result.type === "message" && result.content).toContain("自主领取");
    expect(generateText).not.toHaveBeenCalled();
    expect((await new TaskStore(runtimeRoot).listTasks())).toHaveLength(1);
    expect(await new DurableRunStore(workspaceRoot).load("layout-choice-thread"))
      .toMatchObject({ status: "completed", phase: "finished", result });
    expect(stops).toHaveLength(1);
    expect(stops[0]).toMatchObject({ reason: "completed", result });
  });

  it("reconciles verified content artifacts before activating an existing layout task", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "ppt-layout-reconcile-workspace-"));
    const runtimeRoot = await mkdtemp(join(tmpdir(), "ppt-layout-reconcile-runtime-"));
    tempDirs.push(workspaceRoot, runtimeRoot);
    await mkdir(join(workspaceRoot, "slides"), { recursive: true });
    await writeFile(
      join(workspaceRoot, "brief.md"),
      "# Brief\n\n## 目的\n制作学习 PPT\n\n## 受众\n高中生\n",
      "utf8",
    );
    await writeFile(
      join(workspaceRoot, "outline.md"),
      "# PPT 内容大纲\n\n## 1. 封面\n- 建立主题\n\n## 2. 总结\n- 提炼启示\n",
      "utf8",
    );
    await writeFile(
      join(workspaceRoot, "slides", "storyboard.json"),
      JSON.stringify([
        {
          id: "slide-1",
          title: "封面",
          narrativeRole: "cover",
          suggestedLayout: "cover",
          keyPoints: ["建立主题"],
        },
        {
          id: "slide-2",
          title: "总结",
          narrativeRole: "summary",
          suggestedLayout: "summary",
          keyPoints: ["提炼启示"],
        },
      ]),
      "utf8",
    );

    const taskStore = new TaskStore(runtimeRoot);
    const plan = await taskStore.createPlan({
      sequential: true,
      steps: [
        { subject: "起草 brief 与 outline", executionTarget: "teammate" },
        { subject: "编写幻灯片内容草稿 storyboard", executionTarget: "teammate" },
        { subject: "制定排版计划 layout-plan", executionTarget: "teammate" },
        { subject: "执行排版与交付", executionTarget: "lead" },
      ],
    });
    expect(plan.ok).toBe(true);
    const spawn = vi.fn(() => ({
      name: "task_worker",
      role: "worker",
      status: "running",
      startedAt: Date.now(),
      lastActiveAt: Date.now(),
    }));
    const presentation = createStarterPresentation();
    const toolContext = {
      presentation,
      selectedElementIds: [],
      discoverySession: { discoveredToolNames: new Set<string>() },
      registry: createDefaultToolRegistry(),
      messageHistory: [],
      workspaceRoot,
      gateway: {},
      taskStore,
      teammateManager: { list: () => [], spawn },
      notifyTaskGraphUpdated: vi.fn(),
    } as any;

    const result = await prepareLayoutChoiceTask({
      choice: { mode: "creative", designSystem: TEST_DESIGN_SYSTEM },
      presentation,
      workspaceRoot,
      taskStore,
      toolContext,
    });

    expect(result.tasks.map((task) => task.status)).toEqual([
      "completed",
      "completed",
      "pending",
      "pending",
    ]);
    expect(result.message).toContain("已就绪");
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it("does not report a blocked layout task as ready", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "ppt-layout-blocked-workspace-"));
    const runtimeRoot = await mkdtemp(join(tmpdir(), "ppt-layout-blocked-runtime-"));
    tempDirs.push(workspaceRoot, runtimeRoot);
    const taskStore = new TaskStore(runtimeRoot);
    const plan = await taskStore.createPlan({
      sequential: true,
      steps: [
        { subject: "起草 brief 与 outline", executionTarget: "teammate" },
        { subject: "编写幻灯片内容草稿 storyboard", executionTarget: "teammate" },
        { subject: "制定排版计划 layout-plan", executionTarget: "teammate" },
      ],
    });
    expect(plan.ok).toBe(true);
    const presentation = createStarterPresentation();
    const toolContext = {
      presentation,
      selectedElementIds: [],
      discoverySession: { discoveredToolNames: new Set<string>() },
      registry: createDefaultToolRegistry(),
      messageHistory: [],
      workspaceRoot,
      gateway: {},
      taskStore,
      teammateManager: {
        list: () => [],
        spawn: vi.fn(() => ({ name: "task_worker", status: "running" })),
      },
      notifyTaskGraphUpdated: vi.fn(),
    } as any;

    const result = await prepareLayoutChoiceTask({
      choice: { mode: "creative", designSystem: TEST_DESIGN_SYSTEM },
      presentation,
      workspaceRoot,
      taskStore,
      toolContext,
    });

    expect(result.message).toContain("等待前置内容任务");
    expect(result.message).not.toContain("已就绪");
  });
});
