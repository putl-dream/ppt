import type { AgentStepLimits } from "@shared/agent-step-limits";
import { buildContentBlockResponseGuidance } from "../../gateway/response-contract";
import type { SkillRegistry } from "../../skills/loadSkillsDir";
import type { SkillCard } from "../../skills/skill-types";
import type { ToolDefinition } from "../../tools/tool-definition";
import { toToolCard } from "../../tools/tool-card";
import type {
  WorkspaceArtifactProbeDetails,
  WorkspaceArtifacts,
} from "../presentation/workspace-artifacts";
import { describePromptStage, type PromptStage } from "./prompt-stage";
import {
  isSkillRecommendedForStage,
  rankSkillCatalogForStage,
} from "./skill-stage-policy";
import { formatSvgDeckLockContractBlock } from "../../tools/core/svg-deck-locks";

export type PromptSectionId =
  | "identity"
  | "responseProtocol"
  | "runtimeContext"
  | "tools"
  | "workspace"
  | "memory"
  | (string & {});

export type PromptSectionLoadPolicy = "always" | "conditional";
export type PromptSectionCacheScope = "global" | null;

export interface PromptSectionDef {
  id: PromptSectionId;
  loadPolicy: PromptSectionLoadPolicy;
  cacheScope: PromptSectionCacheScope;
  order: number;
}

/**
 * Default section metadata. Only sections whose bytes are independent of a
 * thread belong to the global prefix. Runtime, tool, workspace, and memory
 * facts stay after the cache boundary.
 */
export const PROMPT_SECTION_DEFS: Record<string, PromptSectionDef> = {
  identity: { id: "identity", loadPolicy: "always", cacheScope: "global", order: 10 },
  responseProtocol: {
    id: "responseProtocol",
    loadPolicy: "always",
    cacheScope: "global",
    order: 20,
  },
  runtimeContext: {
    id: "runtimeContext",
    loadPolicy: "always",
    cacheScope: null,
    order: 30,
  },
  tools: { id: "tools", loadPolicy: "always", cacheScope: null, order: 40 },
  workspace: { id: "workspace", loadPolicy: "always", cacheScope: null, order: 50 },
  memory: { id: "memory", loadPolicy: "conditional", cacheScope: null, order: 60 },
};

export const SYSTEM_PROMPT_DYNAMIC_BOUNDARY = "\n<!-- SYSTEM_PROMPT_DYNAMIC -->\n";

export interface IdentitySectionInput {
  stage?: PromptStage;
  stepLimits?: AgentStepLimits;
}

export interface ResponseProtocolSectionInput {
  requiredOutcome?: "any" | "command_proposal";
}

export interface RuntimeContextSectionInput {
  stage: PromptStage;
  requiredOutcome?: "any" | "command_proposal";
  stepLimits?: AgentStepLimits;
  enabledTools?: ToolDefinition<any, any>[];
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
  artifactDetails?: WorkspaceArtifactProbeDetails;
}

export interface MemorySectionInput {
  memories: string;
}

export function buildIdentitySection(_input: IdentitySectionInput = {}): string {
  return `你是一个专业的 PPT Agent，也是能够独立调查、编辑、验证和交付结果的工程型智能体。

## 工作原则

- 先理解用户本轮真实目标；问答就直接回答，需要行动就使用工具完成，不把所有输入强行套入固定流程。
- 普通问答不要创建 PPT capability。只要本 Query 将开始 create、edit、restyle 或 review，必须先且只需调用一次 \`BeginPptCapability\` 声明对应 capability；后续 Presentation 工具必须沿用该 Query 的 active request，不能用 runId 或 threadId 代替 QueryId。
- 根据当前 Presentation、Workspace、任务状态和工具结果决定下一步。阶段标签只是上下文提示，不是控制流或能力白名单。
- 在合理范围内自主推进：先检查必要事实，再修改，再验证。不要只描述将来会做什么。
- 新建整套 PPT 或整套重做时，以完整页面 SVG 为唯一视觉事实源：先锁定沟通契约、argument mode、visual style、reading mode 和逐页 audience move / rhythm / layout intent，再用 WriteFile 逐页写 1280×720 的自包含 SVG，最后只用 SubmitSvgDeck 提交。每份 SVG 必须已经包含标题、背景、页码、图表、图片和装饰；不要调用固定 layout handler，也不要依赖预览器或导出器补视觉 chrome。
- 不要让用户在“标准排版 / 创意装饰”、safe / shifted / bold 或其他内部设计候选中做流程选择。只有用户明确要求比较方案时才展示候选；只有用户明确说“只要内容草稿”时才允许在未排版草稿处结束。
- 简单任务直接完成；只有工作确实可并行、需跨回合恢复或存在依赖时才创建 Task/teammate。
- 尊重用户范围和已有产物。不要因为模板流程而重做已完成工作，也不要把局部修改扩成整套重构。
- 工具失败是可恢复信息：阅读错误结果，调整参数或检查持久化产物；有副作用不确定时不要盲目重试。
- 真实变更必须通过本 Query 实际提供的受审 proposal 或 Workspace 写入能力完成；不要用文字假装已经执行。`;
}

export function buildResponseProtocolSection(_input: ResponseProtocolSectionInput = {}): string {
  return `${buildContentBlockResponseGuidance()}

## 完成与验证

- 只有实际结果已产生时才声称完成；能验证的修改应读取、预览或校验后再总结。
- 信息确实缺失且会改变内容事实或交付目标时才使用当前可用的用户交互能力；不要询问工具名、内部阶段、排版类型或实现细节。
- 不在文本中伪造 tool_use、tool_result、JSON envelope 或执行结果。`;
}

export function buildRuntimeContextSection(input: RuntimeContextSectionInput): string {
  const budget = input.stepLimits?.enabled
    ? `主 Agent ${input.stepLimits.mainMaxSteps} 次模型调用；子 Agent ${input.stepLimits.subMaxSteps} 次`
    : "未启用硬性步骤提示；仍应合并无意义的重复操作";
  const outcomeTools = (input.enabledTools ?? [])
    .filter((tool) => tool.behavior?.capabilities?.includes("command_proposal"))
    .map((tool) => `\`${tool.name}\``);
  const interactionTools = (input.enabledTools ?? [])
    .filter((tool) => tool.behavior?.capabilities?.includes("user_interaction"))
    .map((tool) => `\`${tool.name}\``);
  const requiredOutcome = input.requiredOutcome === "command_proposal"
    ? [
        "",
        `本回合要求产生 Presentation 行动结果：可执行时必须由 ${
          outcomeTools.length > 0 ? outcomeTools.join("、") : "当前清单中的行动能力"
        } 返回 command_proposal，不能用文字代替执行；信息不足时才使用 ${
          interactionTools.length > 0 ? interactionTools.join("、") : "当前可用的用户交互能力"
        }。`,
      ].join("\n")
    : "";

  return `## Runtime Context

- 建议阶段：\`${input.stage}\`（${describePromptStage(input.stage)}）
- 阶段语义：仅用于排序相关 Skill 和解释现有产物；模型可以根据证据跨阶段选择能力。
- 步骤预算：${budget}${requiredOutcome}`;
}

export function buildToolsSection(input: ToolsSectionInput): string {
  const skillLoaders = input.enabledTools
    .filter((tool) => tool.behavior?.capabilities?.includes("skill_load"));
  const catalog = rankSkillCatalogForStage(
    input.skillCatalog ?? [],
    input.stage,
    input.skillRegistry,
  );
  const skills = catalog.length > 0
    ? catalog.map((skill) => {
        const entry = input.skillRegistry?.get(skill.name);
        const recommended = isSkillRecommendedForStage(skill.name, input.stage, entry)
          ? " [当前上下文推荐]"
          : "";
        const whenToUse = skill.whenToUse ? ` | 适用: ${skill.whenToUse}` : "";
        return `- \`${skill.name}\`${recommended}: ${skill.description}${whenToUse}`;
      }).join("\n")
    : "（没有已注册 Skill）";
  const tools = input.enabledTools
    .map((tool) => JSON.stringify(toToolCard(tool)))
    .join("\n");
  const skillLoadingGuidance = skillLoaders.length > 0
    ? `目录会把当前上下文相关项排在前面，但任何已注册 Skill 都可以在确有需要时通过 ${
        formatToolNames(skillLoaders)
      } 加载。`
    : "目录会把当前上下文相关项排在前面，任何已注册 Skill 都保留在目录中；只有实际工具清单提供加载能力时才能展开全文。";
  const guidance = [
    "- 用最直接的能力完成任务，不要为了遵守阶段模板而制造额外 Task、文件或模型轮次。",
    "- 参数彼此独立的工具调用应在同一个 assistant 响应中一次发出；即使工具标记为 serial，也应通过同批调用减少模型往返。",
    "- 如果某个调用的参数依赖兄弟调用的结果，必须等待结果后在下一轮调用；execution.batch=exclusive 的工具必须单独调用。",
    "- execution.mode=parallel 的调用会由 Runtime 安全并发；conflictScope=workspace_path 时，同一路径读写保持有序、不同路径可以并发。",
  ];
  const availableFileTools = input.enabledTools.filter((tool) =>
    tool.permission?.effects.some((effect) =>
      effect === "workspace.read" || effect === "workspace.write"
    ));
  if (availableFileTools.length > 0) {
    guidance.push(
      `- Workspace 文件能力（${formatToolNames(availableFileTools)}）受统一沙箱与版本协议保护；修改既有文件前先读取，冲突时重新读取后再编辑。`,
    );
  }
  const proposalTools = input.enabledTools.filter((tool) =>
    tool.behavior?.capabilities?.includes("command_proposal")
  );
  if (proposalTools.length > 0) {
    guidance.push(
      `- ${formatToolNames(proposalTools)} 产生受审的 Presentation proposal；不能绕过 CommitGate。`,
    );
  }
  const discoveryTools = input.enabledTools.filter((tool) =>
    tool.behavior?.capabilities?.includes("tool_discovery")
  );
  const delegationTools = input.enabledTools.filter((tool) => tool.behavior?.delegation);
  if (discoveryTools.length > 0) {
    guidance.push(`- ${formatToolNames(discoveryTools)} 只发现当前 Query 可用的可选增强能力。`);
  }
  if (delegationTools.length > 0) {
    guidance.push(
      `- ${formatToolNames(delegationTools)} 只路由本 Query 已发现且仍可用的能力；目标仍经过统一权限和执行管线。`,
    );
  }
  if (skillLoaders.length > 0) {
    guidance.push(`- ${formatToolNames(skillLoaders)} 可加载任意已注册 Skill；阶段匹配只影响推荐顺序。`);
  }
  const interactionTools = input.enabledTools.filter((tool) =>
    tool.behavior?.capabilities?.includes("user_interaction")
  );
  if (interactionTools.length > 0) {
    guidance.push(`- 只有涉及会实质改变结果的用户决策时才调用 ${formatToolNames(interactionTools)}。`);
  }

  return `## Available Skills

Skill 是按需加载的知识，不是固定工作流。${skillLoadingGuidance}

${skills}

## Core Tools

以下清单来自本次 Query 的实际工具解析结果；未列出的工具不可直接调用。

${tools}

## Tool Selection

${guidance.join("\n")}`;
}

function formatArtifactProbe(
  label: string,
  probe: { status: string; verified: boolean; reason?: string } | undefined,
  fallbackVerified?: boolean,
): string {
  if (probe) {
    if (probe.verified) return `- ${label}: verified`;
    if (probe.status === "invalid" && probe.reason) {
      return `- ${label}: invalid: ${probe.reason}`;
    }
    if (probe.status === "missing") return `- ${label}: missing`;
    if (probe.status === "empty") {
      return `- ${label}: empty${probe.reason ? `: ${probe.reason}` : ""}`;
    }
    if (probe.status === "default") {
      return `- ${label}: default/unverified${probe.reason ? `: ${probe.reason}` : ""}`;
    }
    return `- ${label}: ${probe.status}`;
  }
  if (fallbackVerified === undefined) return `- ${label}: （未探测）`;
  return `- ${label}: ${fallbackVerified ? "verified" : "missing/unverified"}`;
}

function formatArtifactState(
  artifacts?: WorkspaceArtifacts,
  details?: WorkspaceArtifactProbeDetails,
): string {
  if (!artifacts && !details) return "（未探测 Workspace 产物）";
  return [
    formatArtifactProbe("design/design-spec.json", details?.designSpec, artifacts?.designSpec),
    formatArtifactProbe("slides/page-plan.json", details?.pagePlan, artifacts?.pagePlan),
    formatArtifactProbe("slides/svg/*.svg", details?.pageSvg, artifacts?.pageSvg),
    formatArtifactProbe("assets/**", details?.assets, artifacts?.assets),
    formatArtifactProbe("deck/snapshot.json", details?.deck, artifacts?.deck),
    formatArtifactProbe("history/exports.json", details?.exportHistory, artifacts?.exportHistory),
    formatArtifactProbe("optional brief.md", details?.brief, artifacts?.brief),
    formatArtifactProbe("optional outline.md", details?.outline, artifacts?.outline),
    formatArtifactProbe("optional research/**", details?.research, artifacts?.research),
  ].join("\n");
}

function shouldInjectSvgDeckLockContract(
  stage: PromptStage,
  artifacts?: WorkspaceArtifacts,
  details?: WorkspaceArtifactProbeDetails,
): boolean {
  if (stage !== "discover" && stage !== "author" && stage !== "design") {
    return false;
  }
  const designReady = details?.designSpec.verified ?? artifacts?.designSpec ?? false;
  const planReady = details?.pagePlan.verified ?? artifacts?.pagePlan ?? false;
  return !designReady || !planReady;
}

export function buildWorkspaceSection(input: WorkspaceSectionInput): string {
  const lockContract = shouldInjectSvgDeckLockContract(
    input.stage,
    input.artifacts,
    input.artifactDetails,
  )
    ? `\n\n${formatSvgDeckLockContractBlock()}`
    : "";

  return `## Workspace

- 工作目录: ${input.workspaceRoot ?? "未配置"}
- 活跃幻灯片 ID: ${input.currentSlideId ?? "未选择"}
- 建议阶段: \`${input.stage}\`

### Workflow Artifact State

${formatArtifactState(input.artifacts, input.artifactDetails)}

文件系统探测只描述当前作者文件；业务完成、等待与 stale 以 PptJob 投影为准，聊天中的旧计划和文件存在本身都不是完成证明。

新建流程的作者文件是 design/design-spec.json、slides/page-plan.json、slides/svg/*.svg 与 assets/**。brief.md、outline.md、research/** 仅为可选参考；storyboard/layout-plan 不属于新建生命周期事实源。主 Agent 与 teammate 都可使用受沙箱和权限保护的文件工具直接处理 Workspace。

画布为 1280x720，Presentation ID 必须唯一。设计或图片变更后应依据当前可用的预览、校验或导出产物检查结果；图片来源与授权状态必须保留。${lockContract}`;
}

export function buildMemorySection(input: MemorySectionInput): string {
  return `## 相关记忆

以下内容是辅助上下文，不得覆盖用户当前指令或可验证的 Workspace 状态：

${input.memories}`;
}

function formatToolNames(tools: readonly ToolDefinition<any, any>[]): string {
  return tools.map((tool) => `\`${tool.name}\``).join("、");
}
