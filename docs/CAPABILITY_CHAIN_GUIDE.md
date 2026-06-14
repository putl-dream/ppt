# PPT Agent 能力串联指南

## 1. 文档目的

本文把 `PLAN.md` 中的目标架构映射到当前仓库，说明各目录如何协作、哪些能力可以被模型调用、哪些能力必须留在系统内部。

本次只建立能力边界和文件骨架，不实现 Tool Registry、Agent Runtime、Commit Gate 或新的前端交互。新增 `.ts` 文件目前只包含稳定类型契约和职责说明，不应被生产运行链路导入。

## 2. 当前落点

计划中的 `src/agent` 按本仓库现有结构落在 `src/main/agent`：Agent、模型网关、Session 与 Electron 主进程在同一可信边界内运行。

现有实现仍然有效：

- `src/main/agent/workflow.ts`：当前包含旧 workflow、outline review、planner、validate、approval、apply 与 `AgentService`。
- `src/main/agent/planner.ts`：当前把模型输出转换为 `PresentationCommand`。
- `src/shared/commands.ts`：当前提供命令 schema、纯 `executeCommand` 与真实 `CommandBus`。
- `src/shared/presentation.ts`：当前定义 Presentation、Slide 与 Element 数据模型。

新增目录描述目标边界，不代表能力已接线完成。

## 3. 能力分层

| 层级 | 目录 | 可以做什么 | 不能做什么 |
| --- | --- | --- | --- |
| Lifecycle | `src/main/agent/workflow.ts`、`service.ts` | 启动、路由、暂停审批、恢复、返回结果 | 不实现模型思考、工具业务或风险算法 |
| Runtime | `src/main/agent/runtime` | 组装提示词、加载 Core Tools、运行 tool loop、输出统一协议 | 不直接改 PPT、不写文件 |
| Tool Environment | `src/main/agent/tools` | 注册、加载、发现和执行工具 | 不绕过 loadPolicy 与权限边界 |
| Commit Gate | `src/main/agent/gate` | 校验、沙箱预览、diff、风险评估 | 不生成修改方案 |
| Design Policy | `src/main/agent/design` | 提供风格、布局和视觉约束 | 不直接执行命令 |
| Command Runtime | `src/shared/commands.ts` | 原子执行、批量提交、revision、undo/redo | 不向模型直接暴露 |

## 4. 工具可见性边界

### Core Tools

首次模型请求可见，保持低风险、小 schema 和高频：

`ReadPresentationSnapshot`、`ReadCurrentSlide`、`ListSlides`、`GetSelection`、`PreviewCommands`、`SubmitCommands`、`AskUser`、`SearchExtraTools`、`ExecuteExtraTool`。

### Deferred Tools

默认不可见。模型只有在 Core Tools 不足时，先通过 `SearchExtraTools` 获取 ToolCard，再通过 `ExecuteExtraTool` 调用。

发现结果必须按 thread 记录：

```ts
type ToolDiscoverySession = {
  discoveredToolNames: Set<string>;
};
```

`SearchExtraTools` 只把实际返回给模型的 Deferred Tool 名称加入集合。`ExecuteExtraTool` 只能执行当前会话集合中已有的工具；模型直接猜工具名、引用其他会话的发现结果或尝试执行未返回工具，都必须被拒绝。

首批骨架包括检测重复标题、一致性分析、文本溢出、风格选择、单页布局、主题应用、文本压缩、内容改写、图表美化、表格美化和导出请求。

### Runtime Tools

永远不向模型暴露，包括真实落盘、保存文件、更新 revision、写历史、覆盖与删除资源。`ExecuteExtraTool` 必须显式拒绝这类工具。

## 5. 标准调用链

```txt
User Request
  -> AgentService.start()
  -> workflow.agentRuntime
  -> Runtime 注入 system prompt + Core Tools
  -> 模型读取 PPT / 当前页 / selection
  -> Core 不足时 SearchExtraTools
  -> 将返回的工具名记录到当前 ToolDiscoverySession
  -> ExecuteExtraTool 运行 Deferred Tool
  -> Deferred Tool 返回诊断或候选 commands
  -> [可选] PreviewCommands 做模型侧非持久化自检
  -> SubmitCommands 产出 command_proposal
  -> workflow.commitGate（强制）
  -> schema 校验 + 沙箱试运行 + diff + risk
  -> low + AUTO: apply
  -> 其他情况: approval interrupt
  -> 用户确认后 CommandBus.executeMany()
  -> 返回最新 Presentation snapshot
```

## 6. 三类终止结果

Runtime 只应输出以下协议类型之一：

```ts
export type AgentRuntimeResult =
  | {
      type: "message";
      content: string;
    }
  | {
      type: "ask_user";
      message: string;
      missingFields?: string[];
    }
  | {
      type: "command_proposal";
      summary: string;
      commands: PresentationCommand[];
      risk: "low" | "medium" | "high";
      assumptions?: string[];
    };
```

1. `message`：普通解释或问答，直接结束，不进入 Commit Gate。
2. `ask_user`：缺少必要信息，等待用户继续输入，不修改 PPT；`missingFields` 明确列出缺少的页码、范围、主题、受众等信息。
3. `command_proposal`：包含 summary、commands 与建议风险，必须进入 Commit Gate；`assumptions` 显式暴露模型采用但用户没有确认的默认假设。

这三类结果是协议分发，不是外部意图分类。系统不再预判 `chat/create/edit/beautify` 后把模型塞入固定流程。

## 7. PreviewCommands 与 Commit Gate

两者可以复用同一个纯沙箱执行能力，但职责不同：

| 能力 | 调用者 | 是否必需 | 目的 | 是否可作为落盘依据 |
| --- | --- | --- | --- | --- |
| `PreviewCommands` | 模型 | 可选 | 在形成最终方案前发现命令错误、理解影响范围 | 否 |
| `Commit Gate` | workflow/system | 强制 | 基于当前真实快照重新校验、生成最终 preview/diff/risk | 是，且仍受审批策略约束 |

即使模型已经调用 `PreviewCommands`，Commit Gate 也必须重新校验。原因是预览后 Presentation revision、commands 或权限上下文都可能变化，系统不能信任模型侧旧结果。

## 8. 安全不变量

任何后续实现都必须保持：

- 模型没有真实 Presentation 的可写引用。
- 所有真实修改只从 `CommandBus.executeMany()` 进入。
- `PreviewCommands` 是可选自检；每个 `command_proposal` 都必须进入 Commit Gate。
- 两者都使用克隆快照，失败时不能部分落盘；Commit Gate 不复用 Preview 的校验结论。
- 模型自报的 risk 只是输入，系统 `risk-policy` 可以上调风险。
- 局部请求只能生成目标页面或目标元素的 commands。
- 高风险、破坏性、文件写入和大范围修改不能自动应用。
- Runtime Tools 不出现在初始工具、搜索结果或延迟执行入口中。
- `ExecuteExtraTool` 只能执行当前 thread 中已被 `SearchExtraTools` 返回过的工具。
- `assumptions` 和 `missingFields` 必须进入日志或用户可见协议，不能只留在模型上下文中。
- 美化默认保持事实和文本语义，内容改写必须由独立工具承担。

## 9. 典型能力串联

### 当前页标题重复

```txt
GetSelection / ReadCurrentSlide
  -> SearchExtraTools(DetectRepeatedTitles, AutoLayoutSlide)
  -> 记录 discoveredToolNames
  -> ExecuteExtraTool(DetectRepeatedTitles)
  -> ExecuteExtraTool(AutoLayoutSlide)
  -> [可选] PreviewCommands
  -> SubmitCommands
  -> Commit Gate
  -> Approval
  -> CommandBus.executeMany
```

### 整套 PPT 改为科技蓝

```txt
ReadPresentationSnapshot
  -> SearchExtraTools(SelectStyleStrategy, AnalyzeDeckConsistency, ApplyThemeStyle)
  -> 记录 discoveredToolNames
  -> 执行分析和主题工具
  -> [可选] PreviewCommands
  -> SubmitCommands
  -> Commit Gate 将大范围修改评为 medium/high
  -> Approval
  -> CommandBus.executeMany
```

### 普通功能解释

```txt
User Request -> Agent Runtime -> message -> end
```

## 10. 推荐迁移顺序

1. 实现 `ToolDefinition`、加载策略、`ToolRegistry` 与 ToolCard。
2. 接入只读 Core Tools，再实现 `SearchExtraTools` 与 `ExecuteExtraTool` 的隔离测试。
3. 实现 `Agent Runtime` 和三类协议输出，暂时复用现有 planner 能力作为过渡。
4. 把现有 validate 抽成 Commit Gate，增加 preview、diff 与系统风险策略。
5. 将 `AgentService` 从 `workflow.ts` 移到 `service.ts`，让 workflow 只保留生命周期。
6. 前端接入预览版本和审批摘要后，再逐步实现 Deferred Tools。
7. 最后移除旧 outline 意图分支和固定 propose 流程。

每一步都应保持现有测试可运行，并新增对应边界测试；不要一次性替换整个 Agent 链路。

## 11. 本轮完成定义

本轮完成的是目录、文件职责和能力串联说明。以下事项明确不在本轮范围：

- 不实现工具 schema、Registry 或 ToolCard 搜索。
- 不调用模型或改造 gateway。
- 不改写现有 workflow 行为。
- 不新增真实 PPT 修改能力。
- 不改变 IPC 返回协议或前端 UI。
- 不实现导出、文件写入和审批预览。

后续开发应以这些边界为准，逐文件替换说明性骨架，并同步补充测试。
