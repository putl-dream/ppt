# PPT Agent Tool Runtime 改造完整方案

## 1. 背景与核心判断

当前 PPT Agent 的问题不是模型能力不够，而是系统把模型限制进了固定 workflow。

旧模式是：

```txt
用户请求
  ↓
意图识别 / 大纲判断
  ↓
进入固定 workflow
  ↓
propose
  ↓
validate
  ↓
approval
  ↓
apply
```

这种模式的问题是：

1. 系统过早替模型决定任务类型。
2. Agent 的行为被固定节点限制。
3. 模型只能“产生命令”，不能根据上下文灵活选择工具。
4. 工具能力没有形成可发现、可扩展的运行环境。
5. 后续增加 PPT 美化、局部编辑、模板、图表、导出等能力时，workflow 会越来越重。

新的方向应该是：

```txt
用户请求
  ↓
Agent Runtime
  ↓
核心工具常驻
  ↓
模型自主判断是否需要延迟工具
  ↓
SearchExtraTools 发现工具
  ↓
ExecuteExtraTool 执行延迟工具
  ↓
SubmitCommands 提交修改方案
  ↓
Commit Gate 校验 / 预览 / 审批
  ↓
CommandBus 正式落盘
```

一句话：

> 用工具环境替代流程编排，用系统提示词替代意图分类，用延迟工具发现替代一次性塞满工具，用 Commit Gate 保证安全落盘。

---

## 2. 改造目标

### 2.1 产品目标

让 PPT Agent 从“流程型命令生成器”升级为“PPT 工作环境中的智能助手”。

用户可以自然表达：

```txt
帮我美化一下这套 PPT
第 8 页标题和副标题重复了，优化一下
整体换成科技蓝风格
这一页做成左右对比结构
帮我压缩正文，但不要改变意思
导出 PPTX
```

模型不需要经过外部意图分类器，而是根据：

1. 用户请求
2. 当前 PPT 状态
3. 核心工具列表
4. 延迟工具索引
5. 系统提示词规则
6. 工具描述

自己决定下一步怎么做。

---

## 3. 总体架构

最终架构分为五层：

```txt
┌──────────────────────────────┐
│          User Request         │
└───────────────┬──────────────┘
                ↓
┌──────────────────────────────┐
│        Agent Runtime          │
│  - LLM                        │
│  - System Prompt              │
│  - Core Tools                 │
│  - Tool Loop                  │
└───────────────┬──────────────┘
                ↓
┌──────────────────────────────┐
│      Deferred Tool Layer      │
│  - SearchExtraTools           │
│  - ExecuteExtraTool           │
│  - Tool Registry              │
│  - Permission Guard           │
└───────────────┬──────────────┘
                ↓
┌──────────────────────────────┐
│          Commit Gate          │
│  - Schema Validate            │
│  - Sandbox Preview            │
│  - Diff Summary               │
│  - Risk Policy                │
│  - Approval                   │
└───────────────┬──────────────┘
                ↓
┌──────────────────────────────┐
│          Command Bus          │
│  - executeMany                │
│  - update revision            │
│  - write history              │
└──────────────────────────────┘
```

---

## 4. 核心原则

### 4.1 不做外部意图分析

不要再提前判断：

```txt
chat / create_ppt / edit_ppt / beautify_ppt / outline_required
```

模型自己可以判断用户是在聊天、修改 PPT、追问、生成方案还是执行工具。

系统只需要识别模型最终返回的协议类型：

```ts
type AgentRuntimeResult =
  | {
      type: "message";
      content: string;
    }
  | {
      type: "ask_user";
      message: string;
    }
  | {
      type: "command_proposal";
      summary: string;
      commands: PresentationCommand[];
      risk: "low" | "medium" | "high";
    };
```

这不是意图分析，而是协议分发。

---

### 4.2 工具分层，而不是流程分支

工具分为三层：

```txt
Core Tools       首次请求直接携带
Deferred Tools   按需发现和调用
Runtime Tools    系统内部工具，不暴露给模型
```

---

### 4.3 模型可以自主工作，但不能直接落盘

模型可以：

```txt
读取 PPT
分析页面
搜索工具
执行低风险工具
生成 commands
预览 commands
提交 commands
```

模型不可以：

```txt
直接修改真实 PPT
直接保存文件
直接覆盖用户内容
直接删除大量页面
直接更新 revision
绕过审批
```

所有真实修改必须进入 Commit Gate。

---

### 4.4 Workflow 只保留生命周期能力

LangGraph 不再负责编排 Agent 的思考过程。

它只负责：

```txt
开始
运行 Agent Runtime
判断是否有 command proposal
进入 Commit Gate
需要审批则 interrupt
审批后 apply
拒绝后 reject
失败后 fail
```

---

## 5. 工具分层设计

## 5.1 Core Tools：首次请求默认携带

Core Tools 的标准：

1. 高频使用。
2. schema 小。
3. 风险低。
4. 是其他工具的前置能力。
5. 如果模型不知道它，会明显影响表现。

建议首批 Core Tools：

```txt
ReadPresentationSnapshot
ReadCurrentSlide
ListSlides
GetSelection
PreviewCommands
SubmitCommands
AskUser
SearchExtraTools
ExecuteExtraTool
```

---

### 5.1.1 ReadPresentationSnapshot

用途：读取整套 PPT 当前状态。

```ts
type ReadPresentationSnapshotInput = {};

type ReadPresentationSnapshotOutput = {
  revision: number;
  slideCount: number;
  slides: Array<{
    id: string;
    index: number;
    title?: string;
    subtitle?: string;
    textSummary: string;
    elementCount: number;
  }>;
};
```

适用场景：

```txt
用户说“美化整套 PPT”
用户没有指定页码
模型需要理解全局结构
```

---

### 5.1.2 ReadCurrentSlide

用途：读取当前正在编辑或预览的页面。

```ts
type ReadCurrentSlideInput = {};

type ReadCurrentSlideOutput = {
  slideId: string;
  index: number;
  elements: Array<{
    id: string;
    type: "text" | "shape" | "image" | "chart" | "table";
    text?: string;
    position: {
      x: number;
      y: number;
      width: number;
      height: number;
    };
    style?: Record<string, unknown>;
  }>;
};
```

适用场景：

```txt
用户说“这一页”
用户说“当前页”
用户说“标题重复”
用户说“这里优化一下”
```

---

### 5.1.3 ListSlides

用途：轻量获取所有页面列表。

```ts
type ListSlidesInput = {};

type ListSlidesOutput = {
  slides: Array<{
    id: string;
    index: number;
    title?: string;
  }>;
};
```

适用场景：

```txt
模型需要定位第几页
模型需要知道总页数
用户说“第 8 页”
```

---

### 5.1.4 GetSelection

用途：获取用户当前选中的页面或元素。

```ts
type GetSelectionInput = {};

type GetSelectionOutput = {
  selectedSlideIds: string[];
  selectedElementIds: string[];
};
```

适用场景：

```txt
用户说“这个”
用户说“选中的内容”
用户说“把它改一下”
```

---

### 5.1.5 PreviewCommands

用途：对 commands 做沙箱预览，不修改真实 PPT。

```ts
type PreviewCommandsInput = {
  commands: PresentationCommand[];
};

type PreviewCommandsOutput = {
  ok: boolean;
  errors: string[];
  previewRevision: number;
  diffSummary: string;
};
```

适用场景：

```txt
模型生成修改方案之后
模型需要检查 commands 是否有效
模型需要向用户解释会改什么
```

---

### 5.1.6 SubmitCommands

用途：提交最终修改方案给系统，不直接落盘。

```ts
type SubmitCommandsInput = {
  summary: string;
  commands: PresentationCommand[];
  risk: "low" | "medium" | "high";
};

type SubmitCommandsOutput = {
  accepted: boolean;
  message: string;
};
```

适用场景：

```txt
模型已经完成分析和预览
准备把修改方案交给 Commit Gate
```

---

### 5.1.7 AskUser

用途：当必要信息不足时追问用户。

```ts
type AskUserInput = {
  message: string;
};

type AskUserOutput = {
  waiting: true;
};
```

适用场景：

```txt
用户要求不明确
执行修改有明显风险
缺少主题、受众、页码、范围等必要信息
```

注意：

不要滥用 AskUser。

默认模型应该先读取 PPT 和上下文，能做就做。

---

### 5.1.8 SearchExtraTools

用途：搜索延迟工具。

```ts
type SearchExtraToolsInput = {
  query: string;
};

type SearchExtraToolsOutput = {
  tools: ToolCard[];
};

type ToolCard = {
  name: string;
  description: string;
  whenToUse: string;
  whenNotToUse?: string;
  risk: "low" | "medium" | "high";
  inputSchemaSummary: string;
  exampleParams?: unknown;
  requiresApproval: boolean;
};
```

示例：

```ts
SearchExtraTools({
  query: "select:DetectRepeatedTitles AutoLayoutSlide"
});
```

返回：

```json
{
  "tools": [
    {
      "name": "DetectRepeatedTitles",
      "description": "检测标题、副标题、正文之间的重复内容。",
      "whenToUse": "当用户提到标题重复、层级混乱、内容重复时使用。",
      "risk": "low",
      "inputSchemaSummary": "{ slideIds?: string[] }",
      "exampleParams": {
        "slideIds": ["current"]
      },
      "requiresApproval": false
    },
    {
      "name": "AutoLayoutSlide",
      "description": "根据页面内容生成布局优化 commands。",
      "whenToUse": "当页面排版混乱、层级不清、需要美化时使用。",
      "risk": "medium",
      "inputSchemaSummary": "{ slideId: string, style?: string, preserveText?: boolean }",
      "exampleParams": {
        "slideId": "slide-1",
        "style": "tech-clean",
        "preserveText": true
      },
      "requiresApproval": true
    }
  ]
}
```

---

### 5.1.9 ExecuteExtraTool

用途：执行已经发现的延迟工具。

```ts
type ExecuteExtraToolInput = {
  toolName: string;
  params: unknown;
};

type ExecuteExtraToolOutput = {
  ok: boolean;
  toolName: string;
  result?: unknown;
  error?: string;
  requiresApproval?: boolean;
};
```

注意：

`ExecuteExtraTool` 不能执行 Runtime Tool。

---

## 5.2 Deferred Tools：按需发现

Deferred Tools 的标准：

1. 低频。
2. 领域化。
3. schema 较大。
4. token 成本高。
5. 有一定副作用风险。
6. 不是每次请求都需要。

首批建议：

```txt
DetectRepeatedTitles
AnalyzeDeckConsistency
DetectOverflowText
SelectStyleStrategy
AutoLayoutSlide
ApplyThemeStyle
CompressText
RewriteSlideContent
BeautifyChart
BeautifyTable
GenerateSpeakerNotes
ExportPptx
ImportTemplate
```

---

### 5.2.1 DetectRepeatedTitles

用途：检测标题、副标题、正文重复。

```ts
type DetectRepeatedTitlesInput = {
  slideIds?: string[];
};

type DetectRepeatedTitlesOutput = {
  issues: Array<{
    slideId: string;
    slideIndex: number;
    duplicatedText: string;
    locations: Array<"title" | "subtitle" | "body">;
    suggestion: string;
  }>;
};
```

---

### 5.2.2 AnalyzeDeckConsistency

用途：分析整套 PPT 视觉一致性。

```ts
type AnalyzeDeckConsistencyInput = {
  slideIds?: string[];
};

type AnalyzeDeckConsistencyOutput = {
  issues: Array<{
    type:
      | "font_inconsistent"
      | "spacing_inconsistent"
      | "color_inconsistent"
      | "title_hierarchy_weak"
      | "layout_inconsistent";
    slideIds: string[];
    message: string;
    severity: "low" | "medium" | "high";
  }>;
};
```

---

### 5.2.3 DetectOverflowText

用途：检测文本溢出、过密、超出页面范围。

```ts
type DetectOverflowTextInput = {
  slideIds?: string[];
};

type DetectOverflowTextOutput = {
  issues: Array<{
    slideId: string;
    elementId: string;
    reason: "overflow" | "too_dense" | "too_small";
    suggestion: string;
  }>;
};
```

---

### 5.2.4 SelectStyleStrategy

用途：根据 PPT 内容选择设计风格。

```ts
type SelectStyleStrategyInput = {
  deckSummary: string;
  userPreference?: string;
};

type SelectStyleStrategyOutput = {
  strategy:
    | "tech-blue"
    | "business-clean"
    | "academic-white"
    | "dark-geek"
    | "training-card"
    | "data-report";
  reason: string;
  themeTokens: {
    fontFamily: string;
    primaryColor: string;
    backgroundColor: string;
    titleWeight: number;
    density: "compact" | "medium" | "comfortable";
  };
};
```

---

### 5.2.5 AutoLayoutSlide

用途：自动重排单页布局，生成 commands。

```ts
type AutoLayoutSlideInput = {
  slideId: string;
  style?: string;
  preserveText?: boolean;
  goal?: "clarity" | "beautify" | "contrast" | "timeline" | "summary";
};

type AutoLayoutSlideOutput = {
  commands: PresentationCommand[];
  summary: string;
  risk: "low" | "medium" | "high";
};
```

---

### 5.2.6 ApplyThemeStyle

用途：对整套或局部页面应用主题样式。

```ts
type ApplyThemeStyleInput = {
  slideIds?: string[];
  strategy: string;
  preserveLayout?: boolean;
};

type ApplyThemeStyleOutput = {
  commands: PresentationCommand[];
  summary: string;
  risk: "low" | "medium" | "high";
};
```

---

### 5.2.7 CompressText

用途：压缩 PPT 页面中的长文本。

```ts
type CompressTextInput = {
  slideId: string;
  elementId?: string;
  maxLength?: number;
  preserveMeaning?: boolean;
};

type CompressTextOutput = {
  commands: PresentationCommand[];
  before: string;
  after: string;
  summary: string;
};
```

---

### 5.2.8 RewriteSlideContent

用途：改写页面内容。

```ts
type RewriteSlideContentInput = {
  slideId: string;
  tone?: "professional" | "simple" | "technical" | "teaching" | "storytelling";
  preserveMeaning?: boolean;
};

type RewriteSlideContentOutput = {
  commands: PresentationCommand[];
  summary: string;
  risk: "low" | "medium" | "high";
};
```

---

### 5.2.9 BeautifyChart

用途：美化图表。

```ts
type BeautifyChartInput = {
  slideId: string;
  elementId: string;
  style?: string;
};

type BeautifyChartOutput = {
  commands: PresentationCommand[];
  summary: string;
};
```

---

### 5.2.10 BeautifyTable

用途：美化表格。

```ts
type BeautifyTableInput = {
  slideId: string;
  elementId: string;
  style?: string;
};

type BeautifyTableOutput = {
  commands: PresentationCommand[];
  summary: string;
};
```

---

### 5.2.11 ExportPptx

用途：导出 PPT 文件。

```ts
type ExportPptxInput = {
  filename?: string;
};

type ExportPptxOutput = {
  filePath: string;
  filename: string;
};
```

注意：

导出可以作为 Deferred Tool，但真实文件写入需要内部权限控制。

---

## 5.3 Runtime Tools：系统内部工具

Runtime Tools 不暴露给模型。

例如：

```txt
ApplyCommandsToRealPresentation
SavePresentation
WriteHistory
UpdateRevision
DeleteConversation
OverwriteFile
AccessLocalFileSystem
```

模型不能直接调用这些工具。

模型只能提交：

```ts
SubmitCommands({
  summary,
  commands,
  risk
});
```

然后由系统内部决定是否执行：

```ts
commandBus.executeMany(commands);
```

---

## 6. Tool Definition 设计

统一工具定义：

```ts
type ToolLoadPolicy = "core" | "deferred" | "runtime" | "disabled";

type ToolRisk = "low" | "medium" | "high";

type ToolDefinition<TInput = unknown, TOutput = unknown> = {
  name: string;
  description: string;
  whenToUse: string;
  whenNotToUse?: string;

  loadPolicy?: ToolLoadPolicy;
  risk: ToolRisk;
  tags: string[];

  alwaysLoad?: boolean;
  inputSchema: {
    safeParse: (value: unknown) => {
      success: boolean;
      data?: TInput;
      error?: unknown;
    };
  };

  prompt: () => string;

  execute: (params: TInput, ctx: ToolContext) => Promise<TOutput>;
};
```

工具上下文：

```ts
type ToolContext = {
  threadId: string;
  commandBus: CommandBus;
  getPresentationSnapshot: () => PresentationSnapshot;
  logger: AgentLogger;
  permissions: ToolPermissionContext;
};

type ToolPermissionContext = {
  allowFileWrite: boolean;
  allowExport: boolean;
  allowNetwork: boolean;
  allowDestructiveAction: boolean;
};
```

---

## 7. 工具加载规则

### 7.1 基础判断

```ts
const CORE_TOOLS = new Set([
  "ReadPresentationSnapshot",
  "ReadCurrentSlide",
  "ListSlides",
  "GetSelection",
  "PreviewCommands",
  "SubmitCommands",
  "AskUser",
  "SearchExtraTools",
  "ExecuteExtraTool",
]);

function getToolLoadPolicy(tool: ToolDefinition): ToolLoadPolicy {
  if (tool.loadPolicy) return tool.loadPolicy;
  if (tool.alwaysLoad === true) return "core";
  if (CORE_TOOLS.has(tool.name)) return "core";
  return "deferred";
}

function isDeferredTool(tool: ToolDefinition): boolean {
  return getToolLoadPolicy(tool) === "deferred";
}

function getInitialTools(allTools: ToolDefinition[]): ToolDefinition[] {
  return allTools.filter((tool) => getToolLoadPolicy(tool) === "core");
}
```

---

### 7.2 判断标准

| 类型       | 标准                      | 示例                       |
| -------- | ----------------------- | ------------------------ |
| core     | 高频、低风险、小 schema、前置能力    | ReadPresentationSnapshot |
| deferred | 低频、领域化、较大 schema、需要按需发现 | AutoLayoutSlide          |
| runtime  | 真实副作用、写文件、落盘、删除、覆盖      | SavePresentation         |
| disabled | 暂时禁用或实验能力               | ExperimentalTool         |

---

## 8. Tool Registry 设计

```ts
class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();

  register(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  list(): ToolDefinition[] {
    return [...this.tools.values()];
  }

  listCoreTools(): ToolDefinition[] {
    return this.list().filter((tool) => getToolLoadPolicy(tool) === "core");
  }

  listDeferredTools(): ToolDefinition[] {
    return this.list().filter((tool) => getToolLoadPolicy(tool) === "deferred");
  }

  search(query: string): ToolCard[] {
    const deferredTools = this.listDeferredTools();

    return deferredTools
      .filter((tool) => matchToolQuery(tool, query))
      .map((tool) => toToolCard(tool));
  }
}
```

查询匹配：

```ts
function matchToolQuery(tool: ToolDefinition, query: string): boolean {
  if (query.startsWith("select:")) {
    const names = query
      .replace("select:", "")
      .split(/\s+/)
      .map((name) => name.trim())
      .filter(Boolean);

    return names.includes(tool.name);
  }

  const text = [
    tool.name,
    tool.description,
    tool.whenToUse,
    tool.tags.join(" "),
  ].join("\n").toLowerCase();

  return query
    .toLowerCase()
    .split(/\s+/)
    .every((word) => text.includes(word));
}

function toToolCard(tool: ToolDefinition): ToolCard {
  return {
    name: tool.name,
    description: tool.description,
    whenToUse: tool.whenToUse,
    whenNotToUse: tool.whenNotToUse,
    risk: tool.risk,
    inputSchemaSummary: summarizeSchema(tool.inputSchema),
    exampleParams: createExampleParams(tool.name),
    requiresApproval: tool.risk !== "low",
  };
}
```

---

## 9. SearchExtraTools 实现

```ts
function createSearchExtraTools(registry: ToolRegistry): ToolDefinition {
  return {
    name: "SearchExtraTools",
    description: "搜索当前未默认加载的延迟工具。",
    whenToUse:
      "当核心工具不能完成任务，或者你需要布局、美化、图表、导出、内容改写、复杂分析等能力时使用。",
    whenNotToUse:
      "如果核心工具已经可以完成任务，不要使用该工具。",
    loadPolicy: "core",
    risk: "low",
    tags: ["tool-discovery", "deferred-tools"],
    inputSchema: SearchExtraToolsSchema,
    prompt() {
      return `
SearchExtraTools: LOW PRIORITY.
Only use this tool when no core tool can accomplish the task.
Use it to discover deferred tools such as layout, design, export, chart, table, text rewriting, or advanced analysis tools.
      `.trim();
    },
    async execute(params) {
      return {
        tools: registry.search(params.query),
      };
    },
  };
}
```

---

## 10. ExecuteExtraTool 实现

```ts
function createExecuteExtraTool(registry: ToolRegistry): ToolDefinition {
  return {
    name: "ExecuteExtraTool",
    description: "执行已经发现的延迟工具。",
    whenToUse:
      "当你通过 SearchExtraTools 找到合适的延迟工具后，用它执行该工具。",
    whenNotToUse:
      "不要用它执行 core tool、runtime tool、disabled tool 或未知工具。",
    loadPolicy: "core",
    risk: "medium",
    tags: ["tool-execution", "deferred-tools"],
    inputSchema: ExecuteExtraToolSchema,
    prompt() {
      return `
ExecuteExtraTool executes a deferred tool by name.
You must call SearchExtraTools first unless you already know the deferred tool was provided in the current context.
Never use ExecuteExtraTool to execute runtime-only tools.
      `.trim();
    },
    async execute(params, ctx) {
      const tool = registry.get(params.toolName);

      if (!tool) {
        return {
          ok: false,
          toolName: params.toolName,
          error: `Tool not found: ${params.toolName}`,
        };
      }

      const policy = getToolLoadPolicy(tool);

      if (policy === "runtime") {
        return {
          ok: false,
          toolName: params.toolName,
          error: `Tool ${params.toolName} is runtime-only and cannot be called by model.`,
        };
      }

      if (policy === "disabled") {
        return {
          ok: false,
          toolName: params.toolName,
          error: `Tool ${params.toolName} is disabled.`,
        };
      }

      if (policy === "core") {
        return {
          ok: false,
          toolName: params.toolName,
          error: `Tool ${params.toolName} is a core tool and should be called directly.`,
        };
      }

      const parsed = tool.inputSchema.safeParse(params.params);

      if (!parsed.success) {
        return {
          ok: false,
          toolName: params.toolName,
          error: String(parsed.error),
        };
      }

      if (tool.risk === "high") {
        return {
          ok: false,
          toolName: params.toolName,
          requiresApproval: true,
          error: `Tool ${params.toolName} requires approval before execution.`,
        };
      }

      const result = await tool.execute(parsed.data, ctx);

      return {
        ok: true,
        toolName: params.toolName,
        result,
      };
    },
  };
}
```

---

## 11. System Prompt 设计

系统提示词要替代意图分析器。

重点不是分类，而是告诉模型：

1. 你在什么环境中工作。
2. 你有哪些核心工具。
3. 核心工具不够时如何发现延迟工具。
4. 修改前必须读取上下文。
5. 修改前必须预览或提交。
6. 高风险操作必须等待确认。
7. 局部修改不能影响全局。
8. 美化默认保持语义不变。

---

### 11.1 Prompt 模板

```txt
你是一个运行在 PPT 编辑器中的 Agent。

你不需要等待系统为你分类任务。
你需要根据用户请求、当前 PPT 状态、可用工具和工具描述，自主决定下一步行动。

你可以完成：
- 聊天解释
- 读取当前 PPT
- 修改页面内容
- 美化页面样式
- 调整布局
- 检查问题
- 生成修改命令
- 提交修改方案
- 在必要时向用户追问

核心工具始终可用：
- ReadPresentationSnapshot：读取整套 PPT 结构
- ReadCurrentSlide：读取当前页
- ListSlides：列出所有页面
- GetSelection：获取用户当前选中内容
- PreviewCommands：沙箱预览修改命令
- SubmitCommands：提交待执行修改方案
- AskUser：向用户追问必要信息
- SearchExtraTools：搜索延迟工具
- ExecuteExtraTool：执行延迟工具

延迟工具使用规则：
- 如果核心工具无法完成任务，使用 SearchExtraTools。
- SearchExtraTools 是低优先级工具。
- 不要在核心工具足够时使用 SearchExtraTools。
- 不要猜测未知工具的参数。
- 通过 SearchExtraTools 获取工具说明后，再用 ExecuteExtraTool 执行。

PPT 修改规则：
- 不要直接假设 PPT 内容，先读取当前 PPT 或当前页。
- 用户说“这一页”“当前页”“这里”时，优先使用 GetSelection 和 ReadCurrentSlide。
- 用户指定页码时，使用 ListSlides 定位页面。
- 用户要求局部修改时，不要影响其他页面。
- 用户要求美化时，默认保持文字语义不变，只调整结构、层级、样式。
- 删除、覆盖、大范围重排、导出文件属于中高风险操作，需要提交预览或等待确认。
- 所有真实修改都必须通过 SubmitCommands 提交，不要绕过提交流程。

输出规则：
- 如果只是解释问题，返回 message。
- 如果需要用户补充信息，调用 AskUser。
- 如果要修改 PPT，先生成 commands，必要时 PreviewCommands，然后 SubmitCommands。
```

---

## 12. Agent Runtime 设计

Agent Runtime 负责：

1. 创建 LLM 请求。
2. 注入 system prompt。
3. 注入 core tools。
4. 执行 tool loop。
5. 收集模型最终输出。
6. 返回统一协议结果。

---

### 12.1 Runtime 输入输出

```ts
type AgentRuntimeInput = {
  threadId: string;
  request: string;
  model?: AgentModelSelection;
  commandBus: CommandBus;
  registry: ToolRegistry;
};

type AgentRuntimeOutput =
  | {
      type: "message";
      content: string;
    }
  | {
      type: "ask_user";
      message: string;
    }
  | {
      type: "command_proposal";
      summary: string;
      commands: PresentationCommand[];
      risk: "low" | "medium" | "high";
    };
```

---

### 12.2 Runtime Loop

```ts
async function runAgentRuntime(
  input: AgentRuntimeInput,
): Promise<AgentRuntimeOutput> {
  const coreTools = input.registry.listCoreTools();

  const ctx: ToolContext = {
    threadId: input.threadId,
    commandBus: input.commandBus,
    getPresentationSnapshot: () => input.commandBus.getSnapshot(),
    logger: agentLogger,
    permissions: {
      allowFileWrite: false,
      allowExport: true,
      allowNetwork: false,
      allowDestructiveAction: false,
    },
  };

  const messages = [
    {
      role: "system",
      content: createSystemPrompt({
        deferredToolIndex: createDeferredToolIndex(input.registry),
      }),
    },
    {
      role: "user",
      content: input.request,
    },
  ];

  for (let step = 0; step < 12; step++) {
    const response = await callModel({
      model: input.model,
      messages,
      tools: coreTools,
    });

    if (response.type === "tool_call") {
      const tool = input.registry.get(response.toolName);

      if (!tool) {
        messages.push({
          role: "tool",
          content: `Tool not found: ${response.toolName}`,
        });
        continue;
      }

      const result = await tool.execute(response.params, ctx);

      messages.push({
        role: "tool",
        toolName: response.toolName,
        content: JSON.stringify(result),
      });

      continue;
    }

    if (response.type === "final") {
      return normalizeAgentFinalResponse(response.content);
    }
  }

  return {
    type: "message",
    content: "我尝试处理这个请求，但工具调用步骤过多。请缩小修改范围后再试。",
  };
}
```

---

## 13. Graph 改造方案

### 13.1 旧 Graph

```txt
__start__
  ↓
propose
  ↓
validate
  ↓
approval / apply / fail
```

### 13.2 新 Graph

```txt
__start__
  ↓
agentRuntime
  ↓
routeAfterAgentRuntime
      ├── message → __end__
      ├── ask_user → __end__
      └── command_proposal → commitGate
                                  ↓
                              routeAfterCommitGate
                                  ├── apply
                                  ├── approval
                                  ├── agentRuntime
                                  └── fail
```

---

### 13.3 新 State

```ts
const AgentState = Annotation.Root({
  threadId: Annotation<string>(),
  request: Annotation<string>(),
  model: Annotation<AgentModelSelection | undefined>(),
  executionStrategy: Annotation<AgentExecutionStrategy>(),

  runtimeResult: Annotation<AgentRuntimeOutput | undefined>(),

  summary: Annotation<string>(),
  commands: Annotation<PresentationCommand[]>({
    reducer: (_, update) => update,
    default: () => [],
  }),

  diffSummary: Annotation<string>(),
  risk: Annotation<"low" | "medium" | "high">({
    reducer: (_, update) => update,
    default: () => "low",
  }),

  preview: Annotation<PresentationPreview | undefined>(),

  errors: Annotation<string[]>({
    reducer: (_, update) => update,
    default: () => [],
  }),

  attempt: Annotation<number>({
    reducer: (_, update) => update,
    default: () => 0,
  }),
});
```

---

### 13.4 Graph 代码

```ts
function createAgentWorkflow(commandBus: CommandBus, registry: ToolRegistry) {
  const agentRuntimeNode = async (
    state: AgentStateType,
  ): Promise<Partial<AgentStateType>> => {
    const result = await runAgentRuntime({
      threadId: state.threadId,
      request: state.request,
      model: state.model,
      commandBus,
      registry,
    });

    if (result.type === "command_proposal") {
      return {
        runtimeResult: result,
        summary: result.summary,
        commands: result.commands,
        risk: result.risk,
        attempt: state.attempt + 1,
      };
    }

    return {
      runtimeResult: result,
      attempt: state.attempt + 1,
    };
  };

  return new StateGraph(AgentState)
    .addNode("agentRuntime", agentRuntimeNode)
    .addNode("commitGate", commitGate(commandBus))
    .addNode("approval", approvalNode, { ends: ["apply", "reject"] })
    .addNode("apply", applyCommands(commandBus))
    .addNode("reject", () => ({}))
    .addNode("fail", failPlanning)

    .addEdge("__start__", "agentRuntime")
    .addConditionalEdges("agentRuntime", routeAfterAgentRuntime)
    .addConditionalEdges("commitGate", routeAfterCommitGate)
    .addEdge("apply", "__end__")
    .addEdge("reject", "__end__")
    .compile({ checkpointer: new MemorySaver() });
}
```

---

### 13.5 routeAfterAgentRuntime

```ts
function routeAfterAgentRuntime(
  state: AgentStateType,
): "commitGate" | "__end__" | "fail" {
  const result = state.runtimeResult;

  if (!result) return "fail";

  if (result.type === "command_proposal") {
    return "commitGate";
  }

  if (result.type === "message") {
    return "__end__";
  }

  if (result.type === "ask_user") {
    return "__end__";
  }

  return "fail";
}
```

---

### 13.6 routeAfterCommitGate

```ts
function routeAfterCommitGate(
  state: AgentStateType,
): "agentRuntime" | "approval" | "apply" | "fail" {
  if (state.errors.length > 0) {
    return state.attempt >= 3 ? "fail" : "agentRuntime";
  }

  if (state.executionStrategy === "AUTO" && state.risk === "low") {
    return "apply";
  }

  return "approval";
}
```

---

## 14. Commit Gate 设计

Commit Gate 是系统安全边界。

它负责：

1. 命令 schema 校验。
2. 沙箱试运行。
3. 生成 before / after preview。
4. 生成 diffSummary。
5. 判断风险等级。
6. 决定是否审批。

---

### 14.1 Commit Gate 代码

```ts
function commitGate(commandBus: CommandBus) {
  return function commitGateNode(
    state: AgentStateType,
  ): Partial<AgentStateType> {
    const before = commandBus.getSnapshot();
    let draft = structuredClone(before);

    const errors: string[] = [];

    for (const command of state.commands) {
      const parsed = presentationCommandSchema.safeParse(command);

      if (!parsed.success) {
        errors.push(String(parsed.error));
        continue;
      }

      try {
        draft = executeCommand(draft, parsed.data).presentation;
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }

    if (errors.length > 0) {
      return {
        errors,
      };
    }

    const diffSummary = createPresentationDiffSummary(before, draft);
    const risk = evaluateCommandRisk(state.commands, diffSummary);

    return {
      errors: [],
      preview: {
        before,
        after: draft,
      },
      diffSummary,
      risk,
    };
  };
}
```

---

### 14.2 Diff Summary 示例

```txt
本次修改将影响 3 页 PPT：

- 第 1 页：统一标题字号，调整副标题位置
- 第 2 页：删除重复副标题，增强正文层级
- 第 3 页：应用科技蓝主题色，调整项目符号间距

未修改：
- 页面顺序
- 原始正文语义
- 图片资源
```

---

### 14.3 风险判断

```ts
function evaluateCommandRisk(
  commands: PresentationCommand[],
  diffSummary: string,
): "low" | "medium" | "high" {
  const destructiveTypes = new Set([
    "deleteSlide",
    "deleteElement",
    "replaceAllText",
    "clearSlide",
  ]);

  if (commands.some((command) => destructiveTypes.has(command.type))) {
    return "high";
  }

  if (commands.length > 30) {
    return "medium";
  }

  const affectedSlides = new Set(
    commands
      .map((command) => "slideId" in command ? command.slideId : undefined)
      .filter(Boolean),
  );

  if (affectedSlides.size >= 5) {
    return "medium";
  }

  return "low";
}
```

---

## 15. Approval Node 升级

Approval 不只展示 commands，还要展示：

1. 修改摘要。
2. 影响范围。
3. 风险等级。
4. 预览结果。
5. 是否应用。

```ts
function approvalNode(state: AgentStateType): Command {
  const decision = interrupt({
    summary: state.summary,
    diffSummary: state.diffSummary,
    risk: state.risk,
    commands: state.commands,
    preview: state.preview,
  }) as { approved: boolean };

  return new Command({
    goto: decision.approved ? "apply" : "reject",
  });
}
```

---

## 16. Apply Node

Apply Node 只负责执行已经通过 Commit Gate 的 commands。

```ts
function applyCommands(commandBus: CommandBus) {
  return function applyCommandsNode(
    state: AgentStateType,
  ): Partial<AgentStateType> {
    commandBus.executeMany(state.commands);
    return {};
  };
}
```

不要在这里再做智能判断。

---

## 17. AgentService 改造

### 17.1 旧入口问题

旧入口里通常会先做：

```txt
outlinePlanner.review()
decision.mode === chat
decision.mode === ready
decision.mode === outline-required
```

这会让系统再次进入意图分析思路。

### 17.2 新入口

新的 `start()` 可以变薄：

```ts
async start(
  request: string,
  model?: AgentModelSelection,
  executionStrategy: AgentExecutionStrategy = "REQUEST_APPROVAL",
  listener?: AgentEventListener,
): Promise<AgentRunResult> {
  const threadId = crypto.randomUUID();

  listener?.({
    type: "request-status",
    message: "正在处理你的请求...",
    progress: 10,
  });

  const result = await this.graph.invoke(
    {
      threadId,
      request,
      model,
      executionStrategy,
    },
    {
      configurable: {
        thread_id: threadId,
      },
    },
  );

  return this.toResult(threadId, result);
}
```

---

### 17.3 toResult 改造

```ts
private toResult(
  threadId: string,
  result: Record<string, unknown>,
): AgentRunResult {
  const runtimeResult = result.runtimeResult as AgentRuntimeOutput | undefined;

  if (runtimeResult?.type === "message") {
    return {
      status: "chat",
      message: runtimeResult.content,
    };
  }

  if (runtimeResult?.type === "ask_user") {
    return {
      status: "chat",
      message: runtimeResult.message,
    };
  }

  const interrupts = result.__interrupt__ as
    | Array<{
        value: {
          summary: string;
          diffSummary: string;
          risk: "low" | "medium" | "high";
          commands: PresentationCommand[];
        };
      }>
    | undefined;

  if (interrupts?.[0]) {
    return {
      status: "approval-required",
      approval: {
        threadId,
        summary: interrupts[0].value.summary,
        diffSummary: interrupts[0].value.diffSummary,
        risk: interrupts[0].value.risk,
        commands: interrupts[0].value.commands,
      },
    };
  }

  return {
    status: "completed",
    presentation: this.commandBus.getSnapshot(),
  };
}
```

---

## 18. 前端交互改造

### 18.1 聊天区展示

Agent 返回 message：

```txt
直接显示普通消息。
```

Agent 返回 ask_user：

```txt
显示追问消息，等待用户继续输入。
```

Agent 返回 approval-required：

```txt
显示修改摘要卡片。
```

---

### 18.2 修改摘要卡片

建议展示：

```txt
AI 已生成修改方案

影响范围：
- 第 1 页
- 第 2 页
- 第 3 页

修改内容：
- 统一标题字号
- 删除重复副标题
- 应用科技蓝主题
- 调整正文间距

风险等级：
中

按钮：
[拒绝变更] [确认执行修改]
```

---

### 18.3 右侧预览区

Commit Gate 生成 preview 后，右侧可以切换：

```txt
当前版本
预览版本
```

如果支持 diff，高亮展示：

```txt
被修改的文本
被移动的元素
被删除的元素
新增的样式
```

第一版不需要做复杂 diff，先展示预览版本即可。

---

## 19. 目录结构建议

```txt
src/agent/
  workflow.ts
  service.ts

  runtime/
    agent-runtime.ts
    runtime-types.ts
    runtime-normalizer.ts
    system-prompt.ts

  tools/
    tool-definition.ts
    tool-registry.ts
    tool-loader.ts
    tool-card.ts

    core/
      read-presentation-snapshot.ts
      read-current-slide.ts
      list-slides.ts
      get-selection.ts
      preview-commands.ts
      submit-commands.ts
      ask-user.ts
      search-extra-tools.ts
      execute-extra-tool.ts

    deferred/
      detect-repeated-titles.ts
      analyze-deck-consistency.ts
      detect-overflow-text.ts
      select-style-strategy.ts
      auto-layout-slide.ts
      apply-theme-style.ts
      compress-text.ts
      rewrite-slide-content.ts
      beautify-chart.ts
      beautify-table.ts
      export-pptx.ts

  gate/
    commit-gate.ts
    risk-policy.ts
    presentation-diff.ts

  design/
    style-strategies.ts
    design-policy.ts
    layout-policy.ts
```

---

## 20. 分阶段落地路线

## 第一阶段：保持现有能力，先抽象 Tool Registry

目标：先建立工具分层，不动太多业务逻辑。

动作：

```txt
1. 新建 ToolDefinition
2. 新建 ToolRegistry
3. 注册 Core Tools
4. 注册 Deferred Tools
5. 实现 getToolLoadPolicy()
6. 实现 isDeferredTool()
7. 实现 SearchExtraTools
8. 实现 ExecuteExtraTool
```

验收标准：

```txt
模型默认只看到核心工具。
模型可以通过 SearchExtraTools 找到延迟工具。
模型可以通过 ExecuteExtraTool 执行延迟工具。
Runtime Tool 无法被模型执行。
```

---

## 第二阶段：替换 proposeCommands 为 Agent Runtime

目标：从 planner.plan() 切换到 agentRuntime.run()。

动作：

```txt
1. 新建 runAgentRuntime()
2. 注入 system prompt
3. 注入 core tools
4. 支持 tool loop
5. 支持 message / ask_user / command_proposal 三种结果
6. Graph 中把 propose 改成 agentRuntime
```

验收标准：

```txt
用户说普通问题时，模型直接回复。
用户说修改 PPT 时，模型读取 PPT 后提交 commands。
用户信息不足时，模型可以追问。
```

---

## 第三阶段：升级 Commit Gate

目标：把 validate 从“校验命令”升级为“提交闸门”。

动作：

```txt
1. validateCommands 改名 commitGate
2. schema 校验保留
3. executeCommand 沙箱试运行保留
4. 新增 preview
5. 新增 diffSummary
6. 新增 risk
```

验收标准：

```txt
任何 commands 都不会直接落盘。
所有 commands 都会先经过 schema 校验。
所有 commands 都会先经过沙箱试运行。
前端可以展示修改摘要和预览。
```

---

## 第四阶段：前端支持预览与审批

目标：让用户可以清楚知道 AI 要改什么。

动作：

```txt
1. approval-required 返回 diffSummary
2. 前端展示修改摘要卡片
3. 右侧 PPT 预览支持 preview version
4. 用户确认后 resume
5. 用户拒绝后 reject
```

验收标准：

```txt
用户点击“AI 美化”后，可以看到修改摘要。
用户确认前，真实 PPT 不改变。
用户确认后，才正式应用。
```

---

## 第五阶段：增强 Deferred Tools

目标：让模型拥有真正的 PPT 工作能力。

优先实现：

```txt
DetectRepeatedTitles
AnalyzeDeckConsistency
SelectStyleStrategy
AutoLayoutSlide
ApplyThemeStyle
CompressText
```

后续再做：

```txt
BeautifyChart
BeautifyTable
ExportPptx
ImportTemplate
GenerateSpeakerNotes
```

---

## 21. 典型调用链路

### 21.1 用户：标题、副标题重复，请优化

```txt
User:
标题、副标题重复。请优化。

Agent:
ReadCurrentSlide()
SearchExtraTools({ query: "select:DetectRepeatedTitles AutoLayoutSlide" })
ExecuteExtraTool({
  toolName: "DetectRepeatedTitles",
  params: { slideIds: ["current"] }
})
ExecuteExtraTool({
  toolName: "AutoLayoutSlide",
  params: {
    slideId: "slide-1",
    preserveText: true,
    goal: "clarity"
  }
})
PreviewCommands({ commands })
SubmitCommands({
  summary: "优化当前页标题层级，删除重复副标题，调整正文布局。",
  commands,
  risk: "medium"
})
```

系统：

```txt
Commit Gate
  ↓
schema 校验
  ↓
沙箱预览
  ↓
生成 diffSummary
  ↓
请求用户确认
```

---

### 21.2 用户：帮我整套 PPT 美化成科技蓝

```txt
User:
帮我整套 PPT 美化成科技蓝。

Agent:
ReadPresentationSnapshot()
SearchExtraTools({ query: "select:SelectStyleStrategy AnalyzeDeckConsistency ApplyThemeStyle" })
ExecuteExtraTool({
  toolName: "SelectStyleStrategy",
  params: {
    deckSummary: "...",
    userPreference: "科技蓝"
  }
})
ExecuteExtraTool({
  toolName: "AnalyzeDeckConsistency",
  params: {}
})
ExecuteExtraTool({
  toolName: "ApplyThemeStyle",
  params: {
    strategy: "tech-blue",
    preserveLayout: true
  }
})
PreviewCommands({ commands })
SubmitCommands({
  summary: "为整套 PPT 应用科技蓝主题，统一标题、颜色和间距。",
  commands,
  risk: "medium"
})
```

---

### 21.3 用户：这是什么功能？

```txt
User:
这个 AI 美化是干嘛的？

Agent:
直接返回 message，不进入 Commit Gate。
```

---

### 21.4 用户：每 5 分钟检查一次部署

如果你的系统未来支持定时任务：

```txt
User:
每 5 分钟检查一次部署。

Agent:
SearchExtraTools({ query: "select:CronCreate" })
ExecuteExtraTool({
  toolName: "CronCreate",
  params: {
    schedule: "*/5 * * * *",
    task: "check deployment status"
  }
})
```

这说明：模型不需要一开始知道 `CronCreate` 的完整 schema，只需要知道系统存在“延迟工具发现机制”。

---

## 22. 测试用例

### 22.1 Core Tools 加载测试

```txt
输入：启动 Agent Runtime
期望：
- ReadPresentationSnapshot 被加载
- SearchExtraTools 被加载
- ExecuteExtraTool 被加载
- AutoLayoutSlide 不在初始 tools 中
```

---

### 22.2 延迟工具搜索测试

```txt
输入：
SearchExtraTools({ query: "layout beautify slide" })

期望：
返回 AutoLayoutSlide、ApplyThemeStyle 等工具卡片。
```

---

### 22.3 Runtime Tool 隔离测试

```txt
输入：
ExecuteExtraTool({ toolName: "SavePresentation" })

期望：
返回错误：runtime-only tool cannot be called by model。
```

---

### 22.4 局部修改测试

```txt
用户：
只优化第 8 页，不要动其他页。

期望：
commands 只包含 slide-8。
Commit Gate 检查 affectedSlides.size === 1。
```

---

### 22.5 高风险操作测试

```txt
用户：
删除所有内容重新做。

期望：
risk = high。
必须进入 approval。
不能 AUTO apply。
```

---

### 22.6 普通聊天测试

```txt
用户：
LangGraph 是什么？

期望：
返回 message。
不调用 SubmitCommands。
不进入 Commit Gate。
```

---

## 23. 关键风险与限制

### 23.1 SearchExtraTools 可能被滥用

解决：

```txt
system prompt 明确 SearchExtraTools 是低优先级。
如果核心工具能完成，不要调用。
限制每轮最大搜索次数。
```

---

### 23.2 ExecuteExtraTool 可能成为后门

解决：

```txt
禁止执行 runtime tool。
执行前必须 schema 校验。
高风险工具必须 approval。
所有调用写日志。
```

---

### 23.3 模型可能生成错误 commands

解决：

```txt
Commit Gate schema 校验。
executeCommand 沙箱试运行。
失败后把 errors 反馈给 Agent Runtime。
最多重试 3 次。
```

---

### 23.4 模型可能过度修改 PPT

解决：

```txt
risk policy 判断影响范围。
局部请求限制 slideIds。
大范围修改必须审批。
前端展示 diffSummary。
```

---

## 24. 最小可行版本

第一版不要追求完整。

只做这个闭环：

```txt
Core Tools:
- ReadPresentationSnapshot
- ReadCurrentSlide
- ListSlides
- GetSelection
- PreviewCommands
- SubmitCommands
- AskUser
- SearchExtraTools
- ExecuteExtraTool

Deferred Tools:
- DetectRepeatedTitles
- SelectStyleStrategy
- AutoLayoutSlide
- ApplyThemeStyle

Runtime:
- Commit Gate
- Approval
- commandBus.executeMany
```

第一版目标：

```txt
用户说：标题、副标题重复，请优化。
系统能：
1. 读取当前页
2. 发现延迟工具
3. 检测重复标题
4. 生成布局优化 commands
5. 沙箱预览
6. 展示修改摘要
7. 用户确认后应用
```

这就是最小闭环。

---

## 25. 最终结论

这次改造的本质不是“优化 LangGraph 流程”，而是把系统从：

```txt
Workflow 驱动 Agent
```

升级为：

```txt
Tool Environment 驱动 Agent
```

LangGraph 仍然保留，但只承担生命周期职责：

```txt
start
agentRuntime
commitGate
approval
apply
reject
fail
```

模型不再被强制塞进固定流程。

模型面对的是一个清晰的工作环境：

```txt
核心工具
延迟工具发现
工具执行器
系统提示词
安全闸门
命令总线
预览与审批
```

这样系统会更灵活，也更符合当前大模型的能力边界。

最终设计原则：

> 少编排模型，多设计环境。
> 少判断意图，多提供工具。
> 少直接执行，多走 Commit Gate。
> 少一次性暴露全部能力，多做延迟发现。
