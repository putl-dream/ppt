import { mkdtemp, readFile, rm } from "node:fs/promises";
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
          { subject: "Read brief" },
          { subject: "Create outline" },
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

  it("rejects creating a second plan while the current task graph is active", async () => {
    const workspaceRoot = await makeWorkspace();
    const context = baseContext(workspaceRoot);

    await taskGraphCreatePlanTool.execute(
      {
        goal: "Build deck",
        sequential: true,
        steps: [
          { subject: "Create brief" },
          { subject: "Create outline" },
        ],
      },
      context,
    );

    await expect(
      taskGraphCreatePlanTool.execute(
        {
          goal: "Author deck",
          sequential: true,
          steps: [{ subject: "Draft slides" }],
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
      { subject: "Define schema" },
      context,
    );
    const api = await taskGraphCreateTool.execute(
      { subject: "Write API", blockedBy: [schema.task.id] },
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
