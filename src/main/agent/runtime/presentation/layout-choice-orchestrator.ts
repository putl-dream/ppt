import type { LayoutChoice } from "@shared/layout-preference";
import type { Presentation } from "@shared/presentation";
import type { AgentTaskNode } from "@shared/agent-task-list";
import { LEAD_TASK_PERMISSIONS, type TaskStore } from "../../task/task-store";
import type { ToolContext } from "../../tools/tool-definition";
import { writeJsonFileAtomic } from "../../persistence/atomic-json-file";
import { resolveAgentPath } from "../../subagent/workspace-path";
import { publishCurrentTaskList } from "../../task/task-list-publisher";
import {
  DESIGN_CAPABILITY_VERSION,
  LAYOUT_PLANNER_CONTRACT,
} from "@shared/design-capability";

const LAYOUT_TASK_PATTERN = /layout-plan|排版计划|版式计划|ppt-design-layout/i;
const LAYOUT_WORKER_NAME = "layout_planner";
const LAYOUT_WORKER_ROLE_PATTERN = /layout|排版|版式/i;

export interface LayoutChoicePreparationResult {
  task: AgentTaskNode;
  tasks: AgentTaskNode[];
  created: boolean;
  worker?: string;
  message: string;
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
  await writeJsonFileAtomic(choicePath, input.choice);
  await writeJsonFileAtomic(snapshotPath, input.presentation);

  const existingTasks = await input.taskStore.listTasks();
  let task = existingTasks.find((candidate) =>
    candidate.routing.executionTarget === "teammate"
      && candidate.status !== "completed"
      && LAYOUT_TASK_PATTERN.test(`${candidate.subject}\n${candidate.description}`),
  );
  let created = false;

  if (!task) {
    const result = await input.taskStore.mutate({
      type: "create",
      subject: "生成排版计划 layout-plan",
      executionTarget: "teammate",
      completionPolicy: "review_required",
      description: [
        "<layout_plan_task>",
        `设计能力版本：${DESIGN_CAPABILITY_VERSION}`,
        "读取 slides/layout-choice.json 与 slides/layout-input.json。",
        LAYOUT_PLANNER_CONTRACT,
        "为每一现有 slide 写入 audienceMove、rhythm、layoutIntent、layout、grammarVariant、slideVariant、designOverride 和 enhancements。",
        "图片规则：选择 image-grid 或 case/evidence 时必须调用 web_search(include_images=true) 并写入 insert-image enhancement；editorial-hero/editorial-split 应优先配主视觉。",
        "具体真实世界主题且 deck≥5 页时，首轮最多搜索 3 个关键页面，每次 basic 搜索 3–5 个候选；规划 2–4 张互不重复、逐页相关的图片。纯数据/抽象主题可用 chart 并在 rationale 说明不搜图。",
        "只写 slides/layout-plan.json，禁止修改 presentation JSON 或尝试 SubmitCommands。",
        "完成后调用 TaskReviewRequest，并摘要输出路径、layout 种类数和自检结果。",
        "</layout_plan_task>",
      ].join("\n"),
    }, input.taskStore.principal("lead", "lead", LEAD_TASK_PERMISSIONS));
    task = result.task!;
    created = true;
  }

  const published = await publishCurrentTaskList(
    input.taskStore,
    input.toolContext.notifyTaskListUpdated,
  );
  const publishedTask = published.snapshot.tasks.find((candidate) => candidate.id === task.id) ?? task;
  const canStart = publishedTask.status === "pending"
    ? !(await input.taskStore.getDerived(publishedTask.id)).derived.isBlocked
    : true;
  let worker = input.toolContext.teammateManager?.list().find((candidate) =>
    (candidate.status === "running" || candidate.status === "idle")
      && LAYOUT_WORKER_ROLE_PATTERN.test(`${candidate.name}\n${candidate.role}`),
  );

  if (
    canStart
    && publishedTask.status === "pending"
    && !worker
    && input.toolContext.teammateManager
    && input.toolContext.gateway
  ) {
    worker = input.toolContext.teammateManager.spawn({
      name: LAYOUT_WORKER_NAME,
      role: "layout planner",
      prompt: "从共享任务板领取可执行的排版计划任务，完成后提交 TaskReviewRequest。",
      startIdle: true,
      workspaceRoot: input.workspaceRoot,
      gateway: input.toolContext.gateway,
      model: input.toolContext.model,
      agentStepLimits: input.toolContext.agentStepLimits,
      onTaskListUpdated: input.toolContext.notifyTaskListUpdated,
      onProgress: input.toolContext.onTeammateProgress,
      taskStore: input.taskStore,
    });
  }

  const message = publishedTask.review.state === "requested"
    ? "排版计划已经提交，正在等待 lead 验收。"
    : publishedTask.status === "in_progress"
      ? `排版设计节点 ${publishedTask.id} 正在执行；提交后会自动进入验收与执行。`
      : canStart
        ? worker
          ? `排版设计节点 ${publishedTask.id} 已就绪，worker ${worker.name} 将自主领取；提交后会自动进入验收与执行。`
          : `排版设计节点 ${publishedTask.id} 已就绪，但当前没有可用的排版 worker。`
        : `排版设计节点 ${publishedTask.id} 仍在等待前置内容任务完成，任务计划会持续保留并自动推进。`;

  return {
    task: publishedTask,
    tasks: published.snapshot.tasks,
    created,
    worker: worker?.name,
    message,
  };
}
