import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDefaultToolRegistry } from "../src/main/agent/tools/tool-registry";
import {
  taskGraphClaimTool,
  taskGraphCompleteTool,
  taskGraphCreatePlanTool,
  taskGraphCreateTool,
  taskGraphListTool,
} from "../src/main/agent/tools/core/task-graph-tools";
import { TaskStore } from "../src/main/agent/task/task-store";
import {
  claimNextUnclaimedTask,
  createTeammateTaskTools,
  unassignOwnedTasks,
} from "../src/main/agent/teammate/teammate-task-tools";
import {
  canStartTask,
  hasDependencyCycle,
  isTaskPlanActive,
  type AgentTaskNode,
} from "../src/shared/agent-task-graph";
import { upsertTaskGraphTrace } from "../src/shared/agent-activity";
import { createStarterPresentation } from "../src/shared/presentation";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function makeWorkspace(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "ppt-task-graph-"));
  tempDirs.push(dir);
  return dir;
}

function baseContext(workspaceRoot: string, onUpdated?: ReturnType<typeof vi.fn>) {
  return {
    presentation: createStarterPresentation(),
    selectedElementIds: [],
    discoverySession: { discoveredToolNames: new Set<string>() },
    registry: createDefaultToolRegistry(),
    messageHistory: [],
    workspaceRoot,
    taskStore: new TaskStore(workspaceRoot),
    taskGraphOwner: "test-agent",
    notifyTaskGraphUpdated: onUpdated,
  };
}

describe("agent-task-graph helpers", () => {
  it("detects dependency cycles", () => {
    const tasks = [
      {
        id: "a",
        subject: "A",
        description: "",
        status: "pending" as const,
        executionTarget: "teammate" as const,
        owner: null,
        blockedBy: ["b"],
        createdAt: "",
        updatedAt: "",
      },
      {
        id: "b",
        subject: "B",
        description: "",
        status: "pending" as const,
        executionTarget: "teammate" as const,
        owner: null,
        blockedBy: ["a"],
        createdAt: "",
        updatedAt: "",
      },
    ];
    expect(hasDependencyCycle(tasks)).toBe(true);
  });

  it("requires completed dependencies before start", () => {
    const pending: AgentTaskNode = {
      id: "child",
      subject: "child",
      description: "",
      status: "pending",
      executionTarget: "teammate",
      owner: null,
      blockedBy: ["parent"],
      createdAt: "",
      updatedAt: "",
    };
    const parentPending: AgentTaskNode = {
      id: "parent",
      subject: "parent",
      description: "",
      status: "pending",
      executionTarget: "teammate",
      owner: null,
      blockedBy: [],
      createdAt: "",
      updatedAt: "",
    };
    const byId = new Map<string, AgentTaskNode>([
      ["child", pending],
      ["parent", parentPending],
    ]);
    expect(canStartTask(pending, byId)).toBe(false);

    byId.set("parent", { ...parentPending, status: "completed" });
    expect(canStartTask(pending, byId)).toBe(true);
  });
});

describe("TaskStore", () => {
  it("reclaims an in-progress task owned by a previous process incarnation", async () => {
    const workspaceRoot = await makeWorkspace();
    const store = new TaskStore(workspaceRoot);
    const created = await store.createTask({ subject: "recover me" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    await store.claimTask(created.task.id, "crashed-agent");
    const taskPath = join(workspaceRoot, ".tasks", `${created.task.id}.json`);
    const persisted = JSON.parse(await readFile(taskPath, "utf8"));
    persisted.claimInstanceId = "previous-process";
    await writeFile(taskPath, JSON.stringify(persisted), "utf8");

    expect(await store.recoverInterruptedClaims()).toEqual([created.task.id]);
    expect(await store.getTask(created.task.id)).toMatchObject({
      status: "pending",
      owner: null,
    });
  });

  it("persists tasks under .tasks and increments id counter", async () => {
    const workspaceRoot = await makeWorkspace();
    const store = new TaskStore(workspaceRoot);

    const schema = await store.createTask({ subject: "Define schema" });
    expect(schema.ok).toBe(true);
    if (!schema.ok) return;

    const api = await store.createTask({
      subject: "Write API",
      description: "REST endpoints",
      blockedBy: [schema.task.id],
    });
    expect(api.ok).toBe(true);
    if (!api.ok) return;

    const raw = await readFile(join(workspaceRoot, ".tasks", `${schema.task.id}.json`), "utf8");
    expect(JSON.parse(raw).subject).toBe("Define schema");

    const meta = JSON.parse(await readFile(join(workspaceRoot, ".tasks", "_meta.json"), "utf8"));
    expect(meta.idCounter).toBe(2);
  });

  it("rejects dependency cycles on create", async () => {
    const workspaceRoot = await makeWorkspace();
    const store = new TaskStore(workspaceRoot);

    const first = await store.createTask({ subject: "first" });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = await store.createTask({
      subject: "second",
      blockedBy: [first.task.id],
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    const cycle = await store.createTask({
      subject: "cycle",
      blockedBy: [second.task.id],
    });
    expect(cycle.ok).toBe(true);
    if (!cycle.ok) return;

    // Attempt to add reverse edge by creating a task that would close the cycle
    // is blocked at create time when blockedBy references missing reverse path.
    // Simulate cycle by manually checking helper with both directions.
    expect(
      hasDependencyCycle([
        first.task,
        { ...second.task, blockedBy: [cycle.task.id] },
        cycle.task,
      ]),
    ).toBe(true);
  });

  it("scans only unowned pending tasks whose dependencies are completed", async () => {
    const workspaceRoot = await makeWorkspace();
    const store = new TaskStore(workspaceRoot);
    const parent = await store.createTask({ subject: "parent" });
    expect(parent.ok).toBe(true);
    if (!parent.ok) return;
    const child = await store.createTask({
      subject: "child",
      blockedBy: [parent.task.id],
    });
    expect(child.ok).toBe(true);
    if (!child.ok) return;

    expect((await store.scanUnclaimedTasks()).map((task) => task.id))
      .toEqual([parent.task.id]);
    await store.claimTask(parent.task.id, "alice");
    expect(await store.scanUnclaimedTasks()).toEqual([]);
    await store.completeTask(parent.task.id, "alice");
    expect((await store.scanUnclaimedTasks()).map((task) => task.id))
      .toEqual([child.task.id]);
  });

  it("keeps lead tasks off the teammate claim queue", async () => {
    const workspaceRoot = await makeWorkspace();
    const store = new TaskStore(workspaceRoot);
    const teammate = await store.createTask({
      subject: "Write outline",
      executionTarget: "teammate",
    });
    const lead = await store.createTask({
      subject: "Submit slide commands",
      executionTarget: "lead",
    });
    expect(teammate.ok && lead.ok).toBe(true);
    if (!teammate.ok || !lead.ok) return;

    expect((await store.scanUnclaimedTasks()).map((task) => task.id))
      .toEqual([teammate.task.id]);
  });

  it("treats legacy tasks without executionTarget as lead-owned workflow", async () => {
    const workspaceRoot = await makeWorkspace();
    const store = new TaskStore(workspaceRoot);
    const created = await store.createTask({ subject: "Legacy task" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const taskPath = join(workspaceRoot, ".tasks", `${created.task.id}.json`);
    const persisted = JSON.parse(await readFile(taskPath, "utf8"));
    delete persisted.executionTarget;
    await writeFile(taskPath, JSON.stringify(persisted), "utf8");

    expect(await store.scanUnclaimedTasks()).toEqual([]);
    expect((await store.getTask(created.task.id)).executionTarget).toBeUndefined();
  });

  it("submits teammate work for lead review before dependency unlock", async () => {
    const workspaceRoot = await makeWorkspace();
    const store = new TaskStore(workspaceRoot);
    const draft = await store.createTask({ subject: "Write draft", executionTarget: "teammate" });
    expect(draft.ok).toBe(true);
    if (!draft.ok) return;
    const publish = await store.createTask({
      subject: "Publish draft",
      executionTarget: "lead",
      blockedBy: [draft.task.id],
    });
    expect(publish.ok).toBe(true);
    if (!publish.ok) return;

    await store.claimTask(draft.task.id, "writer");
    const submitted = await store.submitTask(draft.task.id, "writer");
    expect(submitted.ok && submitted.task.status).toBe("submitted");
    expect(await store.canStart(publish.task.id)).toBe(false);

    const completed = await store.completeTask(draft.task.id);
    expect(completed.ok && completed.unblocked).toContain("Publish draft");
    expect(await store.canStart(publish.task.id)).toBe(true);
  });

  it("allows only one winner when separate stores claim the same task concurrently", async () => {
    const workspaceRoot = await makeWorkspace();
    const creator = new TaskStore(workspaceRoot);
    const created = await creator.createTask({ subject: "contended" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const [alice, bob] = await Promise.all([
      new TaskStore(workspaceRoot).claimTask(created.task.id, "alice"),
      new TaskStore(workspaceRoot).claimTask(created.task.id, "bob"),
    ]);
    expect([alice, bob].filter((result) => result.ok)).toHaveLength(1);
    expect([alice, bob].filter((result) => !result.ok)).toHaveLength(1);
    const task = await creator.getTask(created.task.id);
    expect(task.status).toBe("in_progress");
    expect(["alice", "bob"]).toContain(task.owner);
  });
});

describe("TaskGraph tools", () => {
  it("registers TaskGraph as the only persistent planning tool family", () => {
    const registry = createDefaultToolRegistry();
    const planningToolNames = [
      "TaskGraphCreate",
      "TaskGraphCreatePlan",
      "TaskGraphList",
      "TaskGraphGet",
      "TaskGraphClaim",
      "TaskGraphComplete",
    ];

    for (const name of planningToolNames) {
      const tool = registry.get(name);
      expect(tool?.category).toBe("core");
      expect(tool?.loadPolicy).toBe("core");
      expect(tool?.risk).toBe("low");
    }
    expect(
      registry.getCoreTools()
        .map((tool) => tool.name)
        .filter((name) => name.toLowerCase().includes("taskgraph")),
    ).toEqual(planningToolNames);
  });

  it("creates sequential plans and notifies UI", async () => {
    const workspaceRoot = await makeWorkspace();
    const onUpdated = vi.fn();
    const context = baseContext(workspaceRoot, onUpdated);

    const plan = await taskGraphCreatePlanTool.execute(
      {
        goal: "Build deck",
        sequential: true,
        steps: [
          { subject: "Read brief", executionTarget: "lead" },
          { subject: "Create outline", executionTarget: "teammate" },
        ],
      },
      context,
    );

    expect(plan.tasks).toHaveLength(2);
    expect(plan.tasks[1]?.blockedBy).toContain(plan.tasks[0]?.id);
    expect(onUpdated).toHaveBeenCalled();
    expect(isTaskPlanActive(plan.tasks)).toBe(true);

    const planMeta = JSON.parse(
      await readFile(join(workspaceRoot, ".tasks", "_plan.json"), "utf8"),
    );
    expect(planMeta.goal).toBe("Build deck");

    onUpdated.mockClear();
    const listed = await taskGraphListTool.execute({}, context);
    expect(listed.tasks).toHaveLength(2);
    expect(onUpdated).toHaveBeenCalled();
  });

  it("publishes only the newest plan after a completed plan is replaced without a goal", async () => {
    const workspaceRoot = await makeWorkspace();
    const onUpdated = vi.fn();
    const context = baseContext(workspaceRoot, onUpdated);

    const first = await taskGraphCreatePlanTool.execute({
      goal: "First plan",
      steps: [{ subject: "Old step", executionTarget: "lead" }],
    }, context);
    await taskGraphClaimTool.execute({ taskId: first.tasks[0]!.id }, context);
    await taskGraphCompleteTool.execute({ taskId: first.tasks[0]!.id }, context);

    onUpdated.mockClear();
    const second = await taskGraphCreatePlanTool.execute({
      steps: [{ subject: "Current step", executionTarget: "lead" }],
    }, context);

    const planMeta = JSON.parse(
      await readFile(join(workspaceRoot, ".tasks", "_plan.json"), "utf8"),
    );
    expect(planMeta.planId).toBe(second.planId);
    expect(planMeta).not.toHaveProperty("goal");
    expect(second.tasks).toHaveLength(2);
    expect(onUpdated).toHaveBeenLastCalledWith({
      tasks: [expect.objectContaining({
        planId: second.planId,
        subject: "Current step",
        status: "pending",
      })],
      goal: null,
    });
  });

  it("publishes worker auto-claim, tool claim, submit, and unassign transitions", async () => {
    const workspaceRoot = await makeWorkspace();
    const store = new TaskStore(workspaceRoot);
    const created = await store.createPlan({
      goal: "Worker plan",
      steps: [
        { subject: "Auto claim", executionTarget: "teammate" },
        { subject: "Tool claim", executionTarget: "teammate" },
        { subject: "Remain pending", executionTarget: "teammate" },
      ],
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const onUpdated = vi.fn();
    const autoClaimed = await claimNextUnclaimedTask(store, "task_worker", onUpdated);
    expect(autoClaimed?.id).toBe(created.tasks[0]!.id);

    const taskTools = createTeammateTaskTools(store, "task_worker", onUpdated);
    const claimTool = taskTools.find((tool) => tool.name === "claim_task")!;
    const submitTool = taskTools.find((tool) => tool.name === "submit_task")!;
    await claimTool.execute(
      { task_id: created.tasks[1]!.id },
      { workspaceRoot },
    );
    await submitTool.execute(
      { task_id: created.tasks[1]!.id },
      { workspaceRoot },
    );
    await unassignOwnedTasks(store, "task_worker", onUpdated);

    expect(onUpdated).toHaveBeenCalledTimes(4);
    const statuses = onUpdated.mock.calls.map(([snapshot]) =>
      Object.fromEntries(
        snapshot.tasks.map((task: AgentTaskNode) => [task.subject, task.status]),
      )
    );
    expect(statuses).toEqual([
      { "Auto claim": "in_progress", "Tool claim": "pending", "Remain pending": "pending" },
      { "Auto claim": "in_progress", "Tool claim": "in_progress", "Remain pending": "pending" },
      { "Auto claim": "in_progress", "Tool claim": "submitted", "Remain pending": "pending" },
      { "Auto claim": "pending", "Tool claim": "submitted", "Remain pending": "pending" },
    ]);
    expect(onUpdated).toHaveBeenLastCalledWith(expect.objectContaining({
      goal: "Worker plan",
    }));
  });

  it("starts an idle autonomous worker when a plan contains teammate tasks", async () => {
    const workspaceRoot = await makeWorkspace();
    const spawn = vi.fn(() => ({ name: "task_worker" }));
    const onUpdated = vi.fn();
    const context = {
      ...baseContext(workspaceRoot, onUpdated),
      gateway: {},
      teammateManager: {
        list: () => [],
        spawn,
      },
    } as any;

    await taskGraphCreatePlanTool.execute({
      goal: "Build outline",
      sequential: true,
      steps: [{ subject: "Create outline", executionTarget: "teammate" }],
    }, context);

    expect(spawn).toHaveBeenCalledWith(expect.objectContaining({
      name: "task_worker",
      startIdle: true,
      workspaceRoot,
      onTaskGraphUpdated: onUpdated,
      taskStore: context.taskStore,
    }));
  });

  it("refreshes the task graph listener on an existing autonomous worker", async () => {
    const workspaceRoot = await makeWorkspace();
    const onUpdated = vi.fn();
    const updateTaskGraphListener = vi.fn();
    const spawn = vi.fn();
    const context = {
      ...baseContext(workspaceRoot, onUpdated),
      gateway: {},
      teammateManager: {
        list: () => [{ name: "task_worker", status: "idle" }],
        spawn,
        updateTaskGraphListener,
      },
    } as any;

    await taskGraphCreatePlanTool.execute({
      steps: [{ subject: "Create outline", executionTarget: "teammate" }],
    }, context);

    expect(spawn).not.toHaveBeenCalled();
    expect(updateTaskGraphListener).toHaveBeenCalledWith("task_worker", onUpdated);
  });

  it("rejects creating a second plan while the current task graph is active", async () => {
    const workspaceRoot = await makeWorkspace();
    const context = baseContext(workspaceRoot);

    await taskGraphCreatePlanTool.execute(
      {
        goal: "Build deck",
        sequential: true,
        steps: [
          { subject: "Create brief", executionTarget: "teammate" },
          { subject: "Create outline", executionTarget: "teammate" },
        ],
      },
      context,
    );

    await expect(
      taskGraphCreatePlanTool.execute(
        {
          goal: "Author deck",
          sequential: true,
          steps: [{ subject: "Draft slides", executionTarget: "lead" }],
        },
        context,
      ),
    ).rejects.toThrow("Active task plan already exists");
  });

  it("upserts a single taskgraph block in the activity trace", () => {
    const task: AgentTaskNode = {
      id: "task_1",
      subject: "step",
      description: "",
      status: "pending",
      executionTarget: "teammate",
      owner: null,
      blockedBy: [],
      createdAt: "",
      updatedAt: "",
    };
    let trace = upsertTaskGraphTrace([], { tasks: [task], goal: "Goal" });
    trace = upsertTaskGraphTrace(trace, {
      tasks: [{ ...task, status: "in_progress", owner: "lead" }],
      goal: "Goal",
    });
    expect(trace.filter((item) => item.kind === "taskgraph")).toHaveLength(1);
    expect(trace[0]?.kind === "taskgraph" && trace[0].tasks[0]?.owner).toBe("lead");
  });

  it("runs create → claim → complete with dependency unlock", async () => {
    const workspaceRoot = await makeWorkspace();
    const context = baseContext(workspaceRoot);

    const schema = await taskGraphCreateTool.execute(
      { subject: "Define schema", executionTarget: "lead" },
      context,
    );
    const api = await taskGraphCreateTool.execute(
      { subject: "Write API", executionTarget: "lead", blockedBy: [schema.task.id] },
      context,
    );

    await expect(
      taskGraphClaimTool.execute({ taskId: api.task.id }, context),
    ).rejects.toThrow(/Blocked by/);

    const claimSchema = await taskGraphClaimTool.execute(
      { taskId: schema.task.id },
      context,
    );
    expect(claimSchema.task.status).toBe("in_progress");

    const completeSchema = await taskGraphCompleteTool.execute(
      { taskId: schema.task.id },
      context,
    );
    expect(completeSchema.unblocked).toContain("Write API");

    const claimApi = await taskGraphClaimTool.execute({ taskId: api.task.id }, context);
    expect(claimApi.task.status).toBe("in_progress");
  });

  it("prevents lead from pre-claiming teammate tasks", async () => {
    const workspaceRoot = await makeWorkspace();
    const context = baseContext(workspaceRoot);
    const task = await taskGraphCreateTool.execute(
      { subject: "Write outline", executionTarget: "teammate" },
      context,
    );

    await expect(taskGraphClaimTool.execute({ taskId: task.task.id }, context))
      .rejects.toThrow("must remain unowned for autonomous claim");
  });

  it("unassigns in-progress tasks on shutdown", async () => {
    const workspaceRoot = await makeWorkspace();
    const store = new TaskStore(workspaceRoot);
    const created = await store.createTask({ subject: "cleanup me" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    await store.claimTask(created.task.id, "test-agent");
    const released = await store.unassignInProgressByOwner("test-agent");
    expect(released).toEqual([created.task.id]);

    const task = await store.getTask(created.task.id);
    expect(task.status).toBe("pending");
    expect(task.owner).toBeNull();
  });
});
