import type { ToolDefinition } from "../tools/tool-definition";
import { toToolCard } from "../tools/tool-card";
import type { SkillCard } from "../skills/skill-types";
import type { AgentStepLimits } from "@shared/agent-step-limits";
import type { PromptStage } from "./prompt-stage";
import { describePromptStage } from "./prompt-stage";
import { filterSkillCatalogForStage } from "./skill-stage-policy";
import type { SkillRegistry } from "../skills/loadSkillsDir";

export type PromptSectionId = "identity" | "tools" | "workspace" | "memory";

export type PromptSectionLoadPolicy = "always" | "conditional";
export type PromptSectionCacheScope = "global" | null;

export interface PromptSectionDef {
  id: PromptSectionId;
  loadPolicy: PromptSectionLoadPolicy;
  cacheScope: PromptSectionCacheScope;
}

export const PROMPT_SECTION_DEFS: Record<PromptSectionId, PromptSectionDef> = {
  identity: { id: "identity", loadPolicy: "always", cacheScope: "global" },
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
  "design/theme.json — 设计系统与版式（可选）",
];

export interface IdentitySectionInput {
  stage: PromptStage;
  stepLimits?: AgentStepLimits;
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
  if (stage === "routing") return "";
  return [
    "",
    "## 全流程概览（当前仅执行本阶段）",
    "",
    "`routing` → `planning` → `content` → `layout-choice` → `layout-design` → `layout-exec` → `review` → `export`",
    "",
    "轻量单页修改可跳过 planning / layout-design。两阶段建稿：内容草稿 → 视觉排版。",
  ].join("\n");
}

function buildCorePrinciples(stage: PromptStage, stepLimits?: AgentStepLimits): string {
  const shared = [
    "你是一个专业的 PPT 智能助手 (PPT Agent)。帮助用户创作**可用**的演示文稿。",
    "",
    "## 阶段原则",
    "",
    `- **当前阶段**：${describePromptStage(stage)}（\`${stage}\`）`,
    buildWorkflowOverview(stage),
    "- **两阶段建稿**：先内容草稿，再视觉排版。内容阶段不写主题/版式命令；排版阶段再精简与定稿视觉。",
    "- **幻灯片写入**：改动经 `SubmitCommands`；读现状用 `ReadPresentationSnapshot` / `ReadCurrentSlide` / `ListSlides`。",
    "- **子任务委派**：workspace 中间产物用 `Task`；子 Agent 只回传简短结论。",
    "- **任务图**：多阶段用 `TaskGraph*`；简单单页可跳过。",
    "- **技能**：仅加载当前阶段目录中的技能；`LoadSkill` 在错误阶段会被拒绝。",
    buildStepBudgetLine(stepLimits),
  ];

  const stageRules: Record<PromptStage, string[]> = {
    routing: [
      "",
      "### 本阶段",
      "- 判断轻量 / 两阶段 / 完整路径；不要默认走全流程。",
      "- 轻量：ReadPresentationSnapshot → SubmitCommands。",
      "- 新建 deck：进入内容阶段；大型模糊需求可先 planning。",
    ],
    planning: [
      "",
      "### 本阶段（规划）",
      "- 聚焦目的、受众、页数、叙事结构；**不讨论主题色、版式节奏、set-theme**。",
      "- Task 产出 brief.md → outline.md → storyboard.json。",
      "- 文案可完整表达观点，**不要在规划阶段压缩字数**；精简留到排版阶段。",
    ],
    content: [
      "",
      "### 本阶段（内容撰写）",
      "- **充分写内容**：要点可完整表达，不必强行压到 15 字；信息准确优先。",
      "- **按 layout 容量组织**：case=叙述+1 数字、process/architecture=2–4 项、quote=1–2、toc=3–8、concept=3–4、comparison=偶数条。超出不再丢弃（引擎会折叠+缩字），但观感下降——超容量应拆页而非硬塞。",
      "- 只 `add-slide` + text elements + layout 字段；**禁止** `set-theme`、`update-slide-layout`。",
      "- 标题放 `slide.title`；画布不放 fontSize≥36 的标题文本。",
      "- 完成后 message 含「内容草稿已就绪，请选择排版方式」。",
      "- **不要** LoadSkill 排版/主题/美化类技能。",
    ],
    "layout-choice": [
      "",
      "### 本阶段（等待排版选择）",
      "- 内容已冻结；用简短 message 引导用户选择排版方式，不要提交 theme/layout 命令。",
    ],
    "layout-design": [
      "",
      "### 本阶段（排版设计）",
      "- **页数与文案已冻结**：以 ReadPresentationSnapshot 为准；不改写、不增删页。",
      "- LoadSkill `ppt-design-layout` → Task 产出 `slides/layout-plan.json`。",
      "- 只决策 layout / variant / enhancements；**此处开始**应用版式节奏 Rubric。",
    ],
    "layout-exec": [
      "",
      "### 本阶段（视觉排版执行）",
      "- 按 layout-plan（或用户已选主题）执行：`set-theme` → `update-slide-layout` → variant。",
      "- **文案精简**：溢出或过长要点用 `ppt-beautify` / `compress-text` 等 Deferred 工具处理，不大幅改写结构。",
      "- plan.enhancements 经 ExecuteExtraTool；完成后可 `deck-review`。",
      "- **首次排版 SubmitCommands 后**，系统会自动渲染缩略图回喂一轮视觉质检；请对照后修正或确认再提交。",
      "- **Core 工具**：`PreviewSlide`（单页缩略图）、`ValidateDeckLayout`（版式节奏校验）可直接调用，无需 SearchExtraTools。",
    ],
    review: [
      "",
      "### 本阶段（质检）",
      "- LoadSkill `deck-review`；对照 Rubric 与 `ValidateDeckLayout`。",
      "- 可用 `PreviewSlide` 查看单页缩略图；大改需用户确认。",
    ],
    "light-edit": [
      "",
      "### 本阶段（轻量修改）",
      "- ReadPresentationSnapshot → 直接 SubmitCommands 改目标页。",
      "- 无需 TaskGraph、两阶段或 workspace 全链路。",
    ],
    export: [
      "",
      "### 本阶段（导出）",
      "- 可选 `deck-review` 后 LoadSkill `ppt-export`。",
    ],
  };

  return [...shared, ...stageRules[stage]].join("\n");
}

function buildWorkflowSnippet(stage: PromptStage): string {
  const snippets: Partial<Record<PromptStage, string>> = {
    routing: `## 本阶段工作流
1. 判断场景：改一页 → 轻量；新建 ≤10 页 → 两阶段；大型/要先规划 → planning
2. 不要为简单修改加载 ppt-workflow 全流程`,

    planning: `## 本阶段工作流
1. LoadSkill \`ppt-brief\`（若无 brief）→ Task → brief.md
2. LoadSkill \`ppt-outline\` → Task → outline.md
3. LoadSkill \`ppt-storyboard\` → Task → storyboard.json
4. 默认跳过 research；**不写主题/版式命令**`,

    content: `## 本阶段工作流
1. LoadSkill \`ppt-build\`（规范参考）
2. ReadPresentationSnapshot
3. SubmitCommands：add-slide（layout 字段 + 独立 text elements），**不含** set-theme / update-slide-layout
4. message 结尾：「内容草稿已就绪，请选择排版方式」`,

    "layout-design": `## 本阶段工作流
1. ReadPresentationSnapshot
2. LoadSkill \`ppt-design-layout\`
3. Task → slides/layout-plan.json（一页一条，不改文案）`,

    "layout-exec": `## 本阶段工作流
1. ReadPresentationSnapshot + 读取 layout-plan
2. LoadSkill \`ppt-layout\`（Executor）
3. SubmitCommands：set-theme → update-slide-layout（+ variant）
4. 过长文案：ExecuteExtraTool compress-text / beautify 等
5. LoadSkill \`deck-review\`（可选）`,

    "light-edit": `## 本阶段工作流
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
  const outcomeBlock = buildRequiredOutcomeBlock(input.requiredOutcome);

  return `${buildCorePrinciples(input.stage, input.stepLimits)}
${buildWorkflowSnippet(input.stage)}
## 响应协议

每步只返回一个 JSON 对象，不要 Markdown 包裹：

- 调用工具：{"type":"tool_call","toolName":"ToolName","args":{}}
- 普通回复：{"type":"message","content":"..."}
- 请求补充：{"type":"ask_user","message":"...","missingFields":["..."]}
- 提交幻灯片修改：必须调用 SubmitCommands
${outcomeBlock ? `\n${outcomeBlock}` : ""}`;
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

- \`Task\`：委派 workspace 子任务（brief/outline/storyboard/layout-plan）。
- \`TaskGraph*\`：持久化任务 DAG（\`.tasks/\`）。
- \`LoadSkill\`：仅加载上方目录中的技能；其他技能在本阶段不可用。
- \`PreviewSlide\` / \`ValidateDeckLayout\`：排版与质检 Core 工具，可直接调用。
- \`SearchExtraTools\` + \`ExecuteExtraTool\`：美化/压缩等增强能力（非必需）。
- \`AskUser\`：仅询问用户决策项，不问工具名或系统实现。`;
}

function workspaceFilesForStage(stage: PromptStage): string[] {
  const contentStages: PromptStage[] = ["routing", "planning", "content", "layout-choice", "light-edit"];
  if (contentStages.includes(stage)) {
    return WORKSPACE_FILES_CONTENT;
  }
  return [...WORKSPACE_FILES_CONTENT, ...WORKSPACE_FILES_LAYOUT];
}

function commandExamplesForStage(stage: PromptStage): string {
  if (stage === "content" || stage === "planning") {
    return `- 创建幻灯片：{"id":"cmd-slide-1","type":"add-slide","slide":{"id":"slide-1","title":"页面标题","layout":"concept","elements":[...]},"index":0}
- 设置页标题：在 slide.title 字段，不要用大字号 text 元素`;
  }

  if (stage === "layout-design") {
    return `- 本阶段主产出为 Task 写入的 slides/layout-plan.json，不直接 SubmitCommands 改 deck`;
  }

  if (stage === "layout-exec" || stage === "review") {
    return `- 设置主题：{"id":"cmd-theme","type":"set-theme","theme":"ocean","palette":"cyan"}
- 排版：{"id":"cmd-layout","type":"update-slide-layout","slideId":"slide-1","layout":"concept"}
- 页级节奏：update-slide-variant（light / dark / hero）
- 视觉自检：PreviewSlide(slideId) / ValidateDeckLayout()
主题值：nordic、midnight、ocean、sunset、purple。调色板：cyan、green、purple、orange。
布局值：cover、section、concept、comparison、process、architecture、case、summary、toc、quote、image-grid。`;
  }

  return `- 读现状：ReadPresentationSnapshot
- 改内容或版式：按当前阶段选择 add-slide 或 update-slide-layout`;
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

主 Agent 不直接读写这些文件；轻量路径下不需要创建它们。

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
