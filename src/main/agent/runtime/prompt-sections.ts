import type { ToolDefinition } from "../tools/tool-definition";
import { toToolCard } from "../tools/tool-card";
import type { SkillCard } from "../skills/skill-types";
import type { AgentStepLimits } from "@shared/agent-step-limits";
import type { PromptStage } from "./prompt-stage";
import { describePromptStage } from "./prompt-stage";
import { filterSkillCatalogForStage } from "./skill-stage-policy";
import type { SkillRegistry } from "../skills/loadSkillsDir";
import { buildContentBlockResponseGuidance } from "../gateway/response-contract";
import type { WorkspaceArtifacts } from "./workspace-artifacts";

export type PromptSectionId = "identity" | "responseProtocol" | "tools" | "workspace" | "memory";

export type PromptSectionLoadPolicy = "always" | "conditional";
export type PromptSectionCacheScope = "global" | null;

export interface PromptSectionDef {
  id: PromptSectionId;
  loadPolicy: PromptSectionLoadPolicy;
  cacheScope: PromptSectionCacheScope;
}

export const PROMPT_SECTION_DEFS: Record<PromptSectionId, PromptSectionDef> = {
  identity: { id: "identity", loadPolicy: "always", cacheScope: "global" },
  responseProtocol: { id: "responseProtocol", loadPolicy: "always", cacheScope: "global" },
  tools: { id: "tools", loadPolicy: "always", cacheScope: "global" },
  workspace: { id: "workspace", loadPolicy: "always", cacheScope: null },
  memory: { id: "memory", loadPolicy: "conditional", cacheScope: null },
};

export const SYSTEM_PROMPT_DYNAMIC_BOUNDARY = "\n<!-- SYSTEM_PROMPT_DYNAMIC -->\n";

const WORKSPACE_FILES_CONTENT = [
  "brief.md — 目的、受众与方向",
  "outline.md — 内容大纲",
  "research/notes.md — 资料与素材",
  "slides/storyboard.json — 逐页分镜",
];

const WORKSPACE_FILES_LAYOUT = [
  "slides/layout-plan.json — 排版设计决策（Design Agent 产出）",
  "validated-plan — 由 ExecuteLayoutPlan 内部生成，不依赖聊天记忆",
];

export interface IdentitySectionInput {
  stage: PromptStage;
  stepLimits?: AgentStepLimits;
}

export interface ResponseProtocolSectionInput {
  requiredOutcome?: "any" | "command_proposal";
}

export interface ToolsSectionInput {
  stage: PromptStage;
  enabledTools: ToolDefinition<any, any>[];
  skillCatalog?: SkillCard[];
  skillRegistry?: SkillRegistry;
}

export interface WorkspaceSectionInput {
  stage: PromptStage;
  workspaceRoot?: string;
  currentSlideId?: string;
  artifacts?: WorkspaceArtifacts;
}

export interface MemorySectionInput {
  memories: string;
}

function formatSkillCatalog(skills: SkillCard[]): string {
  if (skills.length === 0) {
    return "（当前阶段无可用技能目录项；进入下一阶段后会出现对应技能）";
  }

  return skills
    .map((skill) => {
      const whenToUse = skill.whenToUse ? ` | 适用: ${skill.whenToUse}` : "";
      return `- \`${skill.name}\`: ${skill.description}${whenToUse}`;
    })
    .join("\n");
}

function buildStepBudgetLine(stepLimits?: AgentStepLimits): string {
  return stepLimits?.enabled
    ? `- **步数预算**：主 Agent 约 ${stepLimits.mainMaxSteps} 次模型调用；子 Agent 约 ${stepLimits.subMaxSteps} 次。合并操作、避免重复 LoadSkill。`
    : "- **效率优先**：合并操作；能一次 SubmitCommands 就不要分批；简单单页修改无需 TaskGraph。";
}

function buildRequiredOutcomeBlock(requiredOutcome?: "any" | "command_proposal"): string {
  if (requiredOutcome !== "command_proposal") return "";
  return `## 当前回合终止约束

这是等待执行的行动请求。不能用 message 描述"准备执行"。
- 信息不足：AskUser
- 可执行：读取必要上下文后 SubmitCommands`;
}

function buildWorkflowOverview(stage: PromptStage): string {
  return [
    "",
    "## 六阶段全流程（当前仅执行本阶段）",
    "",
    "`discover` → `author` → `design` → `style` → `export`",
    "",
    "- **discover**：路径判断 + brief / outline / storyboard",
    "- **author**：内容草稿落盘；草稿就绪后引导用户选排版方式",
    "- **design**：用户确认排版后的 layout-plan + 首次视觉执行",
    "- **style**：set-design-system / update-slide-layout + 视觉质检",
    "- **edit**：已有主题 deck 的轻量单页修改（可跳过 design/style）",
    "- **export**：导出交付",
    "",
    `当前阶段：\`${stage}\` — ${describePromptStage(stage)}`,
  ].join("\n");
}

function buildConvergenceContract(stage: PromptStage): string {
  const stageGoals: Record<PromptStage, string> = {
    discover: "冻结规划：确定路径、页数口径、叙事骨架；不要同时保留多套互斥方案。",
    author: "冻结内容：按已定大纲/分镜逐页写稿并做文案规范化；不要改页数、重排叙事。",
    design: "执行已确认的排版选择：为现有每一页生成 layout-plan，并通过 ExecuteLayoutPlan 消费该产物；不要再次要求用户选择排版。",
    style: "执行视觉方案：调用 ExecuteLayoutPlan 从 layout-plan 生成命令；不要回头重做结构或手工猜 layout。",
    edit: "局部收敛：只改用户指定范围；不要扩展成全流程重做。",
    export: "交付收敛：只做必要复核与导出；不要重新设计 deck。",
  };

  return [
    "",
    "## 阶段契约：收敛而非发散",
    "",
    "- 每个阶段只交付本阶段产物；阶段完成后，上一阶段产物就是冻结输入。",
    "- 决策时选择一个可执行方案并推进；除非用户明确要求重做，不输出多套互斥方案、不推翻已完成规划。",
    "- 发现上一阶段缺陷时，优先在当前阶段做最小承接；必须改变目标、页数或叙事顺序时，先 AskUser 说明影响。",
    "- 不提前加载后续阶段知识：design 前不讨论主题色、版式节奏或 Rubric；style 前不执行视觉排版命令。",
    "- 冻结顺序：outline/storyboard（规划）→ slide content（页数与文案）→ content normalization（标题、术语、密度）→ layout-plan（排版决策）→ visual execution（主题与版式命令）。",
    "",
    `当前阶段收敛目标：${stageGoals[stage]}`,
  ].join("\n");
}

function buildIntentFirstContract(): string {
  return [
    "",
    "## 意图优先：先回答用户当下问题",
    "",
    "- 不要把所有输入都解释为“现在要制作 PPT”。用户问概念、背景、定义、方法、评价、示例，或明确说“先不做 PPT / 暂不做 PPT / 先讲解 / 先聊聊”时，直接用 Markdown 文本给出实质回答。",
    "- 回答这类非制作请求时，先完整回应用户问的内容；不要立刻收集使用场景、受众、页数、风格等 PPT 制作字段。",
    "- 只有用户明确表示要开始制作、整理成 PPT、继续排版、导出或修改已有页面时，才进入对应阶段工具流程。",
    "- 不要声称“刚才已经讲解/已经完成/已经创建”任何尚未在当前会话真实发生的内容；若用户指出漏答，先承认并补上答案。",
    "- 可以在讲解末尾轻轻承接一句“之后可以基于这个内容做 PPT”，但不能用它替代本次讲解。",
  ].join("\n");
}

function buildLeadAgentContract(): string {
  return [
    "",
    "## Lead Agent 职责边界",
    "",
    "- 你的核心身份是 **lead/orchestrator**：识别意图、判断阶段、维护 TaskGraph、验收 teammate 提交的产物、收敛交付。",
    "- 不亲自承担完整写作、分镜、排版设计或大段重写；这些 workspace 中间产物建为 `executionTarget=teammate` 的任务，由常驻 teammate 自主认领。",
    "- 任务计划系统只有 `TaskGraph*`：完整路径或多阶段任务先建一张持久化计划；不要创建临时、平面的任务列表。teammate 节点保持 pending/unowned 等待自动认领，lead 节点才由你 Claim → 执行 → Complete。",
    "- 对完整/多阶段制作请求，第一步必须先 `TaskGraphCreatePlan` 生成覆盖当前用户目标的端到端计划；不要只为当前阶段建一张 discover-only 小计划。",
    "- 同一个用户目标只建一张 TaskGraph：阶段切换、用户说“继续”、或 context compact 后恢复时，先依据 Workspace Artifact State 和 `TaskGraphList` 续跑；不要因为进入 author/design/style 再调用 `TaskGraphCreatePlan`。",
    "- 创建计划时每步必须标记 executionTarget：workspace 文件写作/设计用 `teammate`；用户决策、SubmitCommands、ExecuteLayoutPlan、最终验收用 `lead`。",
    "- teammate 节点 description 必须自包含：写清输入产物、目标路径、验收标准和禁止事项；worker 不依赖 lead 的私有聊天上下文。",
    "- 主 Agent 可以直接执行的工作限于：非制作问答、轻量单页/小范围改动、读取上下文、用户追问、结果验收，以及通过 `ExecuteLayoutPlan` 把已冻结 layout-plan 转成最终 command proposal。",
    "- teammate 将任务置为 submitted 并汇报后，先检查产物是否满足本阶段契约，再 `TaskGraphComplete`；验收前不要解锁下游。",
    "- `Task` 只用于不属于 TaskGraph 的一次性临时子任务；不要对已建图节点再调用 `Task` 重复委派。",
    "- 简单任务保持轻量：能一次读取并 SubmitCommands 的局部修改，不创建 TaskGraph、不委派子 Agent。",
  ].join("\n");
}

function buildCorePrinciples(stage: PromptStage, stepLimits?: AgentStepLimits): string {
  const shared = [
    "你是一个专业的 PPT 智能助手 (PPT Agent)，也是演示创作流程的 lead/orchestrator。帮助用户创作**可用**的演示文稿。",
    buildIntentFirstContract(),
    buildLeadAgentContract(),
    "",
    "## 阶段原则",
    "",
    `- **当前阶段**：${describePromptStage(stage)}（\`${stage}\`）`,
    buildWorkflowOverview(stage),
    buildConvergenceContract(stage),
    "- **两阶段建稿**：先内容草稿（author），再视觉排版（design → style）。author 阶段不写主题/版式命令。",
    "- **幻灯片写入**：改动经 `SubmitCommands`；读现状用 `ReadPresentationSnapshot` / `ReadCurrentSlide` / `ListSlides`。",
    "- **自主领取**：workspace 中间产物建为 teammate 节点并保持未认领；系统会确保常驻 worker，从任务板自主 Claim → 工作 → Submit。",
    "- **任务图**：完整路径或多阶段任务（≥3 步）**必须**先 `TaskGraphCreatePlan`(sequential) 落盘计划；lead 只 Claim 自己执行的节点，并验收 submitted 节点。仅简单单页修改可跳过。",
    "- **技能**：仅加载当前阶段目录中的技能；`LoadSkill` 在错误阶段会被拒绝。",
    buildStepBudgetLine(stepLimits),
  ];

  const stageRules: Record<PromptStage, string[]> = {
    discover: [
      "",
      "### 本阶段（discover = 路径 + 规划）",
      "- 若用户是在提问、要求讲解、讨论主题，或明确说先不做 PPT：直接回答问题，不进入需求收集。",
      "- 判断轻量 / 两阶段 / 完整路径；不要默认走全流程。",
      "- 轻量单页修改 → 可跳过 discover，直接 edit。",
      "- 完整路径：**第一步先 `TaskGraphCreatePlan`(3–5 步, sequential) 建端到端计划**，步骤覆盖 planning/artifacts → author draft → design/layout-plan → style/review/export，并逐步标记 executionTarget；brief/outline/storyboard/layout-plan 用 teammate，SubmitCommands/ExecuteLayoutPlan/review 用 lead。不要预先 Claim teammate 节点；等待其 submitted 后验收并 Complete。",
      "- 聚焦目的、受众、页数、叙事结构；只保留一套可执行大纲，**不讨论设计系统、版式节奏、set-design-system**。",
      "- 文案可完整表达观点；字数精简留到 style 阶段。",
    ],
    author: [
      "",
      "### 本阶段（author = 内容 + 等待排版选择）",
      "- 如果本轮来自用户“继续”或 compact 恢复，先使用 Workspace Artifact State / TaskGraphList 确认已有计划与冻结产物；不要新建 TaskGraphCreatePlan。",
      "- **大纲/分镜已冻结**：若存在 outline.md 或 storyboard.json，按其页数与顺序逐页创作；不要增删页、合并页或重排章节。",
      "- **充分写内容**：要点可完整表达；信息准确优先。",
      "- **按单页承载量组织**：每页 1 个主论点、3–4 条要点；流程类 2–4 步；案例类 1 段叙述 + 1 个关键数字。",
      "- 若尚无冻结分镜且内容明显超载，可在 author 内拆页；若已有 outline/storyboard，保持页数，用更短句收敛。",
      "- **内容规范化**：提交排版前统一标题语气、术语、数字口径和每页信息密度；仍然不改变页数与叙事顺序。",
      "- 只 `add-slide` + text elements + layout 字段；**禁止** `set-design-system`、`update-slide-layout`。",
      "- 标题放 `slide.title`；画布不放 fontSize≥36 的标题文本。",
      "- 草稿完成后 message 含「内容草稿已就绪，请选择排版方式」——此时仍属 author，不提交 designSystem/layout。",
      "- **不要** LoadSkill 排版/主题/美化类技能。",
    ],
    design: [
      "",
      "### 本阶段（design = 已确认排版后的 layout-plan + 首次执行）",
      "- **页数与文案已冻结**：以 ReadPresentationSnapshot 为准；不改写、不增删页。",
      "- layout-plan 的 slides[] 必须与当前 snapshot 一一对应：相同 slideId、相同页数、相同顺序。",
      "- LoadSkill `ppt-design-layout`；layout-plan 对应 teammate 任务由常驻 worker 自主领取并产出 `slides/layout-plan.json`。",
      "- 随后 LoadSkill `ppt-layout`（Executor）并继续执行，不要停在 layout-plan 产物说明。",
      "- 必须调用 `ExecuteLayoutPlan` 读取、校验并执行 `slides/layout-plan.json`；不要手写 `set-design-system` / `update-slide-layout` 来重猜版式。",
      "- **不要再次输出**「内容草稿已就绪 / 请选择排版方式」；用户已经完成排版方式选择。",
      "- 如果 `ExecuteLayoutPlan` 报错，修复或重新生成 layout-plan 后再调用它；不要从聊天上下文自由发挥版式。",
    ],
    style: [
      "",
      "### 本阶段（style = 视觉排版 + 质检）",
      "- 按 layout-plan 执行：优先调用 `ExecuteLayoutPlan`，由工具生成 `set-design-system` → `update-slide-layout` → variant。",
      "- **结构仍冻结**：不新增、删除、重排页面；只在溢出或过长时用 `ppt-beautify` / `compress-text` 做最小文案精简。",
      "- plan.enhancements 经 ExecuteExtraTool；完成后 LoadSkill `deck-review` 或 `ValidateDeckLayout`。",
      "- **首次排版 SubmitCommands 后**，系统自动渲染缩略图回喂一轮视觉质检；对照后修正或确认再提交。",
      "- **Core 工具**：`PreviewSlide`、`ValidateDeckLayout` 可直接调用。",
    ],
    edit: [
      "",
      "### 本阶段（edit = 轻量修改）",
      "- ReadPresentationSnapshot → 直接 SubmitCommands 改目标页。",
      "- 无需 TaskGraph、discover/design 全链路；已有主题的 deck 小改专用。",
    ],
    export: [
      "",
      "### 本阶段（export）",
      "- 可选 `deck-review` 后 LoadSkill `ppt-export`。",
    ],
  };

  return [...shared, ...stageRules[stage]].join("\n");
}

function buildWorkflowSnippet(stage: PromptStage): string {
  const snippets: Partial<Record<PromptStage, string>> = {
    discover: `## 本阶段工作流
0. 非制作请求（讲解/问答/讨论/先不做 PPT）→ 直接输出 Markdown 文本
1. 判断场景：改一页 → edit；新建 ≤10 页 → author；大型/要先规划 → discover 全流程
2. **多阶段(≥3 步)或完整路径**：第一步先 \`TaskGraphCreatePlan\`(sequential=true)建计划并标明 executionTarget；teammate 节点自动 Claim/Submit，lead 节点才手动 Claim/Complete
3. LoadSkill \`ppt-brief\` → outline → storyboard（按需）
4. **不写主题/版式命令**`,

    author: `## 本阶段工作流
1. LoadSkill \`ppt-build\`（规范参考）
2. ReadPresentationSnapshot
3. SubmitCommands：add-slide（layout + text elements），**不含** set-design-system / update-slide-layout
4. message 结尾：「内容草稿已就绪，请选择排版方式」`,

    design: `## 本阶段工作流
1. ReadPresentationSnapshot
2. LoadSkill \`ppt-design-layout\`
3. 等待 layout-plan teammate 节点自主领取并提交 slides/layout-plan.json（一页一条，不改文案）
4. LoadSkill \`ppt-layout\`（Executor）
5. ExecuteLayoutPlan：读取 layout-plan → 校验 → 生成 command proposal
6. 不再提示用户选择排版方式`,

    style: `## 本阶段工作流
1. ReadPresentationSnapshot + 读取 layout-plan
2. LoadSkill \`ppt-layout\`（Executor）
3. ExecuteLayoutPlan：从 layout-plan 生成 set-design-system / update-slide-layout / variant 命令
4. PreviewSlide / ValidateDeckLayout / deck-review
5. 过长文案：ExecuteExtraTool compress-text / beautify 等`,

    edit: `## 本阶段工作流
1. ReadPresentationSnapshot
2. SubmitCommands 直接修改
3. 简短 message`,

    export: `## 本阶段工作流
1. deck-review（建议）
2. LoadSkill \`ppt-export\``,
  };

  const snippet = snippets[stage];
  return snippet ? `\n${snippet}\n` : "";
}

export function buildIdentitySection(input: IdentitySectionInput): string {
  return `${buildCorePrinciples(input.stage, input.stepLimits)}
${buildWorkflowSnippet(input.stage)}`;
}

export function buildResponseProtocolSection(input: ResponseProtocolSectionInput): string {
  const outcomeBlock = buildRequiredOutcomeBlock(input.requiredOutcome);
  return `${buildContentBlockResponseGuidance()}${outcomeBlock ? `\n\n${outcomeBlock}` : ""}`;
}

export function buildToolsSection(input: ToolsSectionInput): string {
  const catalog = filterSkillCatalogForStage(
    input.skillCatalog ?? [],
    input.stage,
    input.skillRegistry,
  );

  const toolsDescription = input.enabledTools
    .map((tool) => JSON.stringify(toToolCard(tool)))
    .join("\n");

  return `## Available Skills（阶段 \`${input.stage}\`）

${formatSkillCatalog(catalog)}

## Core Tools

${toolsDescription}

- \`Task\`：仅处理不属于 TaskGraph 的一次性临时子任务；任务图 workspace 节点由 teammate 自主领取。
- \`ExecuteLayoutPlan\`：读取并校验 \`slides/layout-plan.json\`，再生成受控 command proposal；排版执行默认用它。
- \`TaskGraph*\`：持久化任务 DAG（\`.tasks/\`）。
- \`LoadSkill\`：仅加载上方目录中的技能；其他技能在本阶段不可用。
- \`PreviewSlide\` / \`ValidateDeckLayout\`：排版与质检 Core 工具，可直接调用。
- \`SearchExtraTools\` + \`ExecuteExtraTool\`：美化/压缩等增强能力（非必需）。
- \`AskUser\`：仅询问用户决策项，不问工具名或系统实现。问题正文放 \`message\`；可选界面配置放 \`responseUi\`，必须直接传对象，禁止 JSON.stringify。`;
}

function workspaceFilesForStage(stage: PromptStage): string[] {
  const contentOnlyStages: PromptStage[] = ["discover", "author", "edit"];
  if (contentOnlyStages.includes(stage)) {
    return WORKSPACE_FILES_CONTENT;
  }
  return [...WORKSPACE_FILES_CONTENT, ...WORKSPACE_FILES_LAYOUT];
}

function commandExamplesForStage(stage: PromptStage): string {
  if (stage === "discover" || stage === "author") {
    return `- 创建幻灯片：{"id":"cmd-slide-1","type":"add-slide","slide":{"id":"slide-1","title":"页面标题","layout":"concept","elements":[...]},"index":0}
- 设置页标题：在 slide.title 字段，不要用大字号 text 元素`;
  }

  if (stage === "design") {
    return `- 先产出 slides/layout-plan.json，再调用 ExecuteLayoutPlan，不回到排版选择
- 执行唯一事实源：{"toolName":"ExecuteLayoutPlan","args":{"path":"slides/layout-plan.json"}}
- 不手写 set-design-system / update-slide-layout；这些命令由 ExecuteLayoutPlan 从 plan 生成`;
  }

  if (stage === "style") {
    return `- 执行唯一事实源：{"toolName":"ExecuteLayoutPlan","args":{"path":"slides/layout-plan.json"}}
- ExecuteLayoutPlan 成功后会生成 set-design-system / update-slide-layout / update-slide-variant
- 视觉自检：PreviewSlide(slideId) / ValidateDeckLayout()
主题值：nordic、midnight、ocean、sunset、purple。调色板：cyan、green、purple、orange。
布局值：cover、section、concept、comparison、process、architecture、case、summary、toc、quote、image-grid。`;
  }

  return `- 读现状：ReadPresentationSnapshot
- 改内容或版式：按当前阶段选择 add-slide 或 update-slide-layout`;
}

function formatArtifactState(artifacts?: WorkspaceArtifacts): string {
  if (!artifacts) return "";

  const format = (ready: boolean) => ready ? "verified" : "missing/unverified";
  return `## Workflow Artifact State

- brief.md: ${format(artifacts.brief)}
- outline.md: ${format(artifacts.outline)}
- slides/storyboard.json: ${format(artifacts.storyboard)}
- slides/layout-plan.json: ${format(artifacts.layoutPlan)}

Use this filesystem-derived state as the source of truth after context compaction. Skip artifacts that are already verified unless the user explicitly asks to regenerate them.`;
}

export function buildWorkspaceSection(input: WorkspaceSectionInput): string {
  const workspaceLine = input.workspaceRoot
    ? input.workspaceRoot
    : "未配置（轻量路径，无需 workspace 文件）";

  const files = workspaceFilesForStage(input.stage);

  return `## Workspace

工作目录: ${workspaceLine}
阶段: \`${input.stage}\`

## Workspace 文件

${files.map((line) => `- ${line}`).join("\n")}

主 Agent 不直接读写这些文件；layout-plan 由 teammate 任务写入并提交验收，再由 ExecuteLayoutPlan 读取执行。轻量路径下不需要创建它们。

${formatArtifactState(input.artifacts)}

## PresentationCommand 示例（本阶段）

${commandExamplesForStage(input.stage)}

画布 1280x720。ID 必须唯一。

## 当前上下文

- 活跃幻灯片 ID: ${input.currentSlideId || "未选择"}`;
}

export function buildMemorySection(input: MemorySectionInput): string {
  return `## 相关记忆

${input.memories}`;
}
