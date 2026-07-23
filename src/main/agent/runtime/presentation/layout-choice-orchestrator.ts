import type { LayoutChoice } from "@shared/layout-preference";
import type { Presentation } from "@shared/presentation";
import type { AgentTaskNode } from "@shared/agent-task-graph";
import type { TaskStore } from "../../task/task-store";
import type { ToolContext } from "../../tools/tool-definition";
import { ensureAutonomousTaskWorker } from "../../tools/core/task-graph-tools";
import { writeJsonFileAtomic } from "../../persistence/atomic-json-file";
import { resolveAgentPath } from "../../subagent/workspace-path";
import { probeWorkspaceArtifactDetails } from "./workspace-artifacts";

const LAYOUT_TASK_PATTERN = /layout-plan|排版计划|版式计划|ppt-design-layout/i;
const BRIEF_OUTLINE_TASK_PATTERN = /(?:brief.*outline|outline.*brief|简要.*大纲|大纲.*简要)/i;
const STORYBOARD_TASK_PATTERN = /storyboard|幻灯片内容草稿|逐页内容|内容草稿/i;
const ARTIFACT_RECONCILER = "artifact_reconciler";

export interface LayoutChoicePreparationResult {
  task: AgentTaskNode;
  tasks: AgentTaskNode[];
  created: boolean;
  worker?: string;
  message: string;
}

async function completeTaskFromVerifiedArtifact(
  taskStore: TaskStore,
  task: AgentTaskNode | undefined,
): Promise<void> {
  if (!task || task.status === "completed") return;
  if (task.status === "pending") {
    const claimed = await taskStore.claimTask(task.id, ARTIFACT_RECONCILER);
    if (!claimed.ok) return;
    const completed = await taskStore.completeTask(task.id, ARTIFACT_RECONCILER);
    if (!completed.ok) throw new Error(completed.error);
    return;
  }

  const completed = await taskStore.completeTask(task.id);
  if (!completed.ok) throw new Error(completed.error);
}

export async function reconcileVerifiedContentTasks(input: {
  workspaceRoot: string;
  taskStore: TaskStore;
}): Promise<void> {
  const artifacts = await probeWorkspaceArtifactDetails(input.workspaceRoot);
  let tasks = await input.taskStore.listTasks();
  if (artifacts.brief.verified && artifacts.outline.verified) {
    await completeTaskFromVerifiedArtifact(
      input.taskStore,
      tasks.find((task) => BRIEF_OUTLINE_TASK_PATTERN.test(`${task.subject}\n${task.description}`)),
    );
    tasks = await input.taskStore.listTasks();
  }
  if (artifacts.storyboard.verified) {
    await completeTaskFromVerifiedArtifact(
      input.taskStore,
      tasks.find((task) => STORYBOARD_TASK_PATTERN.test(`${task.subject}\n${task.description}`)),
    );
  }
}

export async function prepareLayoutChoiceTask(input: {
  choice: LayoutChoice;
  presentation: Presentation;
  workspaceRoot: string;
  taskStore: TaskStore;
  toolContext: ToolContext;
}): Promise<LayoutChoicePreparationResult> {
  const choicePath = resolveAgentPath(input.workspaceRoot, "slides/layout-choice.json");
  const snapshotPath = resolveAgentPath(input.workspaceRoot, "slides/layout-input.json");
  await writeJsonFileAtomic(choicePath, {
    version: 1,
    ...input.choice,
    confirmedAt: new Date().toISOString(),
  });
  await writeJsonFileAtomic(snapshotPath, input.presentation);

  await reconcileVerifiedContentTasks({
    workspaceRoot: input.workspaceRoot,
    taskStore: input.taskStore,
  });

  const existingTasks = await input.taskStore.listTasks();
  const planMeta = await input.taskStore.getPlanMeta();
  let task = existingTasks.find((candidate) =>
    candidate.executionTarget === "teammate"
      && candidate.status !== "completed"
      && LAYOUT_TASK_PATTERN.test(`${candidate.subject}\n${candidate.description}`),
  );
  let created = false;

  if (!task) {
    const result = await input.taskStore.createTask({
      subject: "生成排版计划 layout-plan",
      executionTarget: "teammate",
      planId: planMeta?.planId,
      description: [
        "<layout_plan_task>",
        "读取 slides/layout-choice.json 与 slides/layout-input.json。",
        "页数与文案已冻结：不得增删页、改写标题或正文。",
        "按 ppt-design-layout Rubric 为每一现有 slide 选择 layout、grammarVariant、slideVariant、designOverride 和 enhancements。",
        "图片规则：选择 image-grid 或 case/evidence 时必须调用 web_search(include_images=true) 并写入 insert-image enhancement；editorial-hero/editorial-split 应优先配主视觉。",
        "具体真实世界主题且 deck≥5 页时，首轮最多搜索 3 个关键页面，每次 basic 搜索 3–5 个候选；规划 2–4 张互不重复、逐页相关的图片。纯数据/抽象主题可用 chart 并在 rationale 说明不搜图。",
        "只写 slides/layout-plan.json，禁止修改 presentation JSON 或尝试 SubmitCommands。",
        "完成后 submit_task，并摘要输出路径、layout 种类数和自检结果。",
        "</layout_plan_task>",
      ].join("\n"),
    });
    if (!result.ok) throw new Error(result.error);
    task = result.task;
    created = true;
  }

  const published = await publishCurrentTaskGraph(
    input.taskStore,
    input.toolContext.notifyTaskGraphUpdated,
  );
  const publishedTask = published.snapshot.tasks.find((candidate) => candidate.id === task.id) ?? task;
  const worker = publishedTask.status === "submitted"
    ? undefined
    : ensureAutonomousTaskWorker(input.toolContext, published.snapshot.tasks);
  const canStart = publishedTask.status === "pending"
    ? await input.taskStore.canStart(publishedTask.id)
    : true;

  const message = publishedTask.status === "submitted"
    ? "排版计划已经提交，正在等待 lead 验收。"
    : publishedTask.status === "in_progress"
      ? `排版设计节点 ${publishedTask.id} 正在执行；提交后会自动进入验收与执行。`
      : canStart
        ? `排版设计节点 ${publishedTask.id} 已就绪，常驻 worker 将自主领取；提交后会自动进入验收与执行。`
        : `排版设计节点 ${publishedTask.id} 仍在等待前置内容任务完成，任务计划会持续保留并自动推进。`;

  return { task: publishedTask, tasks: published.snapshot.tasks, created, worker, message };
}
import { publishCurrentTaskGraph } from "../../task/task-graph-publisher";
