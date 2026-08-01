# 工程能力地图：Claude Code 参考与 Agent PPT 落点

> 文档类型：现行能力盘点
> 最后核对：2026-08-01
> 事实来源：`/mnt/e/Coding/claude-code`、`src/`、`skills/`、`tests/` 与 `package.json`

下文中 `/mnt/e/Coding/claude-code/...` 是参考项目绝对路径；`src/...`、`tests/...`
和 `docs/...` 均相对本仓库根目录。

## 1. 文档目的

本文回答三个问题：

1. `claude-code` 作为通用 Coding Agent，具备哪些可复用的工程能力；
2. 这些能力在 Agent PPT 中应当如何落位；
3. 当前代码已经实现到哪里，哪些只是部分能力或路线图。

这里的“工程能力”不是功能菜单，而是让 Agent 可以长期、可恢复、安全地执行任务的机制。能力状态统一使用：

| 状态 | 含义 |
|---|---|
| **Implemented** | 当前代码已有明确实现，并有测试或可执行入口 |
| **Partial** | 主链路存在，但覆盖范围、协议或产品闭环尚未完整 |
| **Proposed** | 只存在于 `docs/roadmap/`，不能作为当前行为依赖 |
| **Not adopted** | Claude Code 具备，但不属于当前 PPT 产品边界 |

状态描述的是 Agent PPT，不评价参考项目自身的完成度。`claude-code` 是反编译恢复项目，部分模块由 feature flag 控制或仍是 stub，不能仅凭目录名判断能力可用。

## 2. Claude Code 的工程能力分层

从源码结构看，Claude Code 的能力可归纳为八层。

| 层 | Claude Code 的代表实现 | 可复用的工程原则 |
|---|---|---|
| 入口与运行形态 | `/mnt/e/Coding/claude-code/src/entrypoints/cli.tsx`、`/mnt/e/Coding/claude-code/src/main.tsx`、pipe、daemon、bridge、background session | 快速路径与完整 Agent 启动分离；运行形态共享核心能力 |
| Query 编排 | `/mnt/e/Coding/claude-code/src/query.ts`、`/mnt/e/Coding/claude-code/src/QueryEngine.ts` | Query Loop 独立；跨圈状态与单圈临时状态分离 |
| 模型适配 | `/mnt/e/Coding/claude-code/src/services/api/`、provider registry | Provider 差异在边界层收敛，下游消费统一内容块 |
| 工具与权限 | `/mnt/e/Coding/claude-code/src/Tool.ts`、`/mnt/e/Coding/claude-code/src/tools.ts`、`/mnt/e/Coding/claude-code/packages/builtin-tools/`、`/mnt/e/Coding/claude-code/src/hooks/` | 工具动态暴露；校验、权限、Hook、执行和结果归一化形成单管线 |
| Context 与记忆 | `/mnt/e/Coding/claude-code/src/context.ts`、`/mnt/e/Coding/claude-code/src/utils/claudemd.ts`、compact、memory services | 稳定 Prompt 与动态上下文分区；超预算时有确定性降级 |
| 任务与协作 | `/mnt/e/Coding/claude-code/src/tasks/`、`/mnt/e/Coding/claude-code/src/coordinator/`、teammate、workflow engine | Task 是持久化协调协议；子 Agent 有独立身份、收件箱和终态 |
| 恢复与远程 | transcript、session、background、daemon、bridge、ACP、RCS | 执行状态可持久化；交互端与执行端可解耦 |
| 扩展与运维 | skills、plugins、MCP、LSP、telemetry、health、feature flags | 扩展能力与核心循环解耦；构建、诊断和可观测性是产品能力的一部分 |

Agent PPT 不需要复制这些入口和命令，但需要吸收其中与长任务正确性相关的边界。

## 3. Agent PPT 能力总表

| 能力域 | 当前状态 | Agent PPT 落点 | 与 Claude Code 的关系 |
|---|---|---|---|
| 独立 Query Loop | **Implemented** | `src/main/agent/runtime/query/query.ts`、`src/main/agent/runtime/query/query-types.ts` | 采用独立循环与显式 transition，不复制 CLI 状态 |
| Run 生命周期 | **Implemented** | `src/main/agent/runtime/agent-runtime.ts`、`src/main/agent/runtime/lifecycle/agent-run-scope.ts`、`src/main/agent/runtime/agent-run-finalizer.ts` | 将 Query 编排与资源/提交生命周期分开 |
| Provider Gateway | **Implemented** | `src/main/agent/gateway/anthropic.ts`、`src/main/agent/gateway/openai.ts`、`src/main/agent/gateway/content-blocks.ts` | 在适配层统一流与内容块 |
| 模型调用恢复 | **Implemented** | `src/main/agent/runtime/turns/model-call-recovery.ts`、`src/main/agent/gateway/withRetry.ts` | 将可恢复错误与终止错误显式分类 |
| Context 压缩 | **Implemented** | `src/main/agent/runtime/context-compact/` | 具备预算、micro/snip/full compact 与 emergency trim |
| System Prompt 分区 | **Implemented** | `src/main/agent/runtime/prompts/` | section registry、稳定/动态边界、stage 建议化 |
| 动态工具系统 | **Implemented** | `src/main/agent/tools/tool-registry.ts`、`src/main/agent/tools/tool-loader.ts`、`src/main/agent/runtime/tools/` | 注册、暴露、权限和执行解耦 |
| 文件安全操作 | **Implemented** | `src/main/agent/tools/files/workspace-file-service.ts`、`src/main/agent/tools/core/workspace-files.ts` | Main/teammate 共享 read-before-write 与原子提交 |
| 项目文件管理 | **Implemented** | `src/main/project/project-file-service.ts`、`src/shared/ipc.ts`、`src/renderer/src/components/ProjectFilesPage.tsx` | SVG-native artifact 分组、list/detail/diff；注册文本 artifact 使用隔离编辑凭证与 SHA-256 CAS |
| 权限与审批 | **Implemented** | `src/main/agent/runtime/tools/permission-check.ts`、`src/main/agent/runtime/tools/tool-approval-broker.ts`、`src/main/agent/gate/commit-gate.ts` | Prompt 不承担权限；Presentation 变更有独立提交门 |
| Skill 渐进加载 | **Implemented** | `src/main/agent/skills/loadSkillsDir.ts`、`src/main/agent/tools/core/load-skill.ts`、`skills/` | Skill 是知识/流程注入，不是硬编码阶段机 |
| Task / teammate | **Implemented** | `src/main/agent/task/`、`src/main/agent/teammate/`、`src/main/agent/subagent/` | 六项目标；Lead 协作工具 Deferred；独立会话、消息总线与生命周期 |
| 后台任务 | **Partial** | `src/main/agent/runtime/background/` | 已有 manager 与 inbox 输入，尚非 daemon/跨进程后台平台 |
| 持久化与恢复 | **Implemented** | `src/main/agent/persistence/`、`src/main/agent/runtime/lifecycle/checkpoint-coordinator.ts` | History、checkpoint、lease、CAS 与 inflight 恢复分层 |
| Web / 图片检索 | **Implemented** | `src/main/agent/search/`、`src/main/agent/tools/core/web-search.ts`、`src/main/agent/tools/core/search-slide-images.ts` | 作为受控外部能力进入工具管线 |
| SVG-native 创建 | **Implemented** | `skills/ppt-workflow/`、`preview-svg-page.ts`、`submit-svg-deck.ts` | 产品唯一新建路径 |
| Layout Grammar / element-IR | **Removed** | 共享库、element-IR 模型与 Agent 作者工具均已删除 | 产品 STRICT SVG-only |
| 渲染反馈与质量门 | **Implemented** | deck validators、quality gate、`PreviewSvgPage` 预览门禁 | 最终约束由确定性代码执行；旧 render-feedback-loop 已移除 |
| Artifact / Job 生命周期 | **Implemented** | `src/shared/presentation-lifecycle.ts`、`src/main/presentation-lifecycle/` | 跨 Query PptJob、immutable revision graph、Proposal/Presentation/Export 与恢复 |
| MCP / Plugin / LSP | **Not adopted** | 无对应产品入口 | 不是当前 PPT 主链路所必需 |
| Daemon / Remote Control / ACP | **Not adopted** | 无对应产品入口 | Electron 本地应用暂不需要复制远程运行面 |
| 通用 Shell / Computer Use | **Partial** | teammate-only `src/main/agent/subagent/workspace-tools.ts` | Bash 为 fail-closed 的只读 direct-exec allowlist；无任意 shell 或 Computer Use |

## 4. 核心 Agent 能力细节

### 4.1 Query、Run 与应用三层

当前主链路不是一个“大 AgentService”完成所有工作，而是三层：

```text
Renderer / IPC
  → AgentService                         应用用例与并发入口
  → PresentationAgentRunFactory         组装一次 Run 的依赖
  → AgentRuntime / AgentRunScope         lease、恢复、资源与终态
  → query() AsyncGenerator               model → tools → transition
  → ModelTurnRunner / ToolTurnRunner     单圈执行
```

关键不变量：

- `AgentQueryParams` 在 Query 开始时组装一次，不在循环中偷偷更换依赖；
- `AgentQueryState` 只保存完整提交的跨圈事实；
- `AgentIterationWorkspace` 保存本圈未提交的 assistant/tool 增量；
- `tool_use` 批次必须得到一一配对的 `tool_result` 后才能整体提交；
- UI 活动流是观察投影，不能反向成为 History 的事实源；
- Query terminal、Run terminal 与 Presentation artifact 状态是不同协议。

详见 [Query](../agent/query.md)、[Agent Loop](../agent/loop.md) 和
[Agent Runtime](../agent/runtime.md)。

### 4.2 Gateway 与内容协议

Gateway 当前支持 Anthropic 与 OpenAI 两条 driver 路径。`AgentGateway` 是整个程序
内部唯一的模型 I/O 边界——程序其余部分只依赖 Gateway 的中性协议类型，不直接接触
provider SDK。

**对内协议面（barrel `src/main/agent/gateway`）：**

- 统一类型：`AgentModelRequest`、`AgentModelResponse`、`AgentModelStreamChunk`、
  `AgentModelContentBlock` 等；`stopReason` 已归一为 Gateway 枚举
  （`end` / `max_tokens` / `tool_use` / `other`），Runtime 不再接触 raw provider 字符串；
- 标准错误：`AgentGatewayError`（含 `retryAfterMs`、`code` 与 `provider`）；
  raw provider/HTTP 错误只在 Gateway 内经 `normalizeProviderError` 吸入；
- 公共 helper：`textFromContentBlocks`、`toolUseBlocksFromContent`、
  `ensureToolResultPairing`、`isOutputTruncated`、`classifyGatewayRecovery` 等；
  其中 `classifyGatewayRecovery` 只接受 `AgentGatewayError`，裸 status/message
  一律视为不可恢复；
- 程序消费者应只从 barrel import，不应 deep-import 子模块。

**私有 driver 层：**

`anthropic.ts` 与 `openai.ts` 是 Gateway 私有的 SDK 适配器，只被 `AgentGateway`
调用。它们负责统一消息与 SDK 类型的双向映射、一次 SDK 调用、原生流事件转换和
`stopReason` 映射，不得在 driver 内做隐藏重试或跨 attempt 合并 usage。
`AgentGateway` 通过显式 `AgentProviderDriver` 注册表管理和调度这些驱动；各 driver
内部的 SDK content type / role 映射差异属于 provider 方言，不在 Gateway 合并统一。
`openaiApiMode` 是 driver 私有配置，不出现在 `ResolvedAgentModelConfig`。

**Runtime 恢复：**

`src/main/agent/runtime/turns/model-call-recovery.ts` 根据 Gateway 返回的
`AgentGatewayError` 与归一化 `stopReason` 决定 attempt 之间的恢复，包括退避、
Context 压缩、输出 token 升级、截断续写和 fallback model。thinking-only 且因
token 上限结束也走这条 Runtime 恢复路径。新增 Provider 时应实现相同的
prepared-request/response driver 协议，不能把 Provider 分支扩散进 Query Loop
或 Presentation 工具。

验证入口：

- `tests/agent-gateway.test.ts`
- `tests/anthropic-gateway-adapter.test.ts`
- `tests/openai-gateway-adapter.test.ts`
- `tests/model-calls.test.ts`
- `tests/model-call-recovery.test.ts`
- `tests/native-tool-use.test.ts`
- `tests/response-contract.test.ts`
- `tests/agent-gateway-routing.test.ts`
- `tests/agent-gateway-errors.test.ts`

### 4.3 Context 预算与压缩

Context 管理已经不是简单截断聊天数组。当前能力包含：

| 机制 | 目的 | 代码入口 |
|---|---|---|
| token 估算 | 在请求前判断预算 | `src/main/agent/runtime/context-compact/estimate-tokens.ts` |
| tool result budget | 避免单个工具结果吞掉上下文 | `src/main/agent/runtime/context-compact/tool-result-budget.ts` |
| micro compact | 优先清理低价值局部内容 | `src/main/agent/runtime/context-compact/micro-compact.ts` |
| snip compact | 对大块内容做局部裁剪 | `src/main/agent/runtime/context-compact/snip-compact.ts` |
| canonical compact | 生成可继续推理的紧凑历史 | `src/main/agent/runtime/context-compact/compact-history.ts` |
| emergency trim | 正常压缩仍超限时保住协议有效性 | `src/main/agent/runtime/context-compact/emergency-trim.ts` |
| native message compact | 压缩并保持 tool pairing | `src/main/agent/runtime/context-compact/model-messages.ts`、`src/main/agent/runtime/context-compact/prepare-context.ts` |
| request projection | Gateway 临时注入 request context，不污染 History | `src/main/agent/gateway/protocol.ts`、`src/main/agent/gateway/message-pairing.ts` |

压缩必须保留 system/user 意图、未完成工具配对、关键决策和当前任务状态。Renderer transcript 可以更丰富，但不能拿 UI 文本代替 canonical provider messages。

### 4.4 工具注册、发现与执行

工具系统分为三个概念：

1. **Registered**：代码知道该工具；
2. **Resolved / Visible**：load policy、category 与 `isEnabled(context)` 允许本次暴露；
3. **Authorized / Executable**：本次输入通过 schema、permission、审批和 Hook，可以执行。

stage 只影响建议与排序，permission 只在 Preflight/执行前裁决；二者都不参与
Registry 的 `Resolved / Visible` 过滤。

统一执行链为：

```text
resolve registered core tool
  → parse and validate requested input
  → resolve delegation target when declared
  → parse and validate target input
  → non-removable permission / approval
  → mutable PreToolUse hooks
  → execute
  → output validation / PostToolUse hooks
  → bounded model result
  → emit paired tool_result
```

Core tools 提供高频基础能力；Deferred tools 通过搜索后按需进入上下文；Runtime-only 能力服务宿主运行，不应暴露给模型。`SearchExtraTools` 降低工具描述常驻上下文的成本，但不能绕过权限策略。

详见 [Tool 系统](../agent/tools.md)。

### 4.5 文件操作与并发安全

Claude Code 的 FileRead/Edit/Write 体现了一个重要原则：读写工具不是薄文件 API，而是并发协议。Agent PPT 当前将该协议集中到 `WorkspaceFileService`：

- 所有路径相对受控 workspace 解析；
- 读文件建立 receipt/baseline；
- 覆盖已有文件和 Edit 必须先读；
- Edit 使用精确 old/new text，拒绝零匹配和歧义匹配；
- 提交前校验文件未偏离读取基线；
- 写入使用临时文件加原子替换；
- Main Agent 与 teammate 使用同一服务，不维护两套语义；
- 工具结果区分可给模型的摘要与本地富数据。
- 超预算结果与 Context 归档只在模型可读 workspace 中返回恢复路径；checkpoint 等
  application runtimeRoot 状态不暴露为文件工具路径。

这套能力保护 workspace 文本文件，不替代 Presentation 的 Proposal、CommitGate 和 artifact revision。

Renderer 的项目文件管理也复用同一安全边界，但使用独立的应用协议：

```text
list workspace files
  → open UTF-8 text file
  → issue editToken + sha256 version
  → inspect detail / diff
  → save(editToken, expectedVersion)
  → WorkspaceFileService compare-and-commit
```

`editToken` 绑定 session、workspace root、相对路径和一次隔离的读取 scope；其他调用者
重新读取同一文件不能刷新这份基线。保存时 token 或 SHA-256 version 任一不匹配都会
拒绝写入。`ProjectFileService` 的既有 artifact 读写也已委托
`WorkspaceFileService`，因此 Renderer、Agent 和项目持久化共享 UTF-8、symlink、
inode/hash、跨进程锁和原子替换语义。

当前管理页提供 artifact 分组、文件列表、详情、diff 和文本编辑。只有归属于已注册、
可编辑 artifact 的普通文本文件可以保存；`deck`、`history` 和未知 artifact 文件只读，
从 Main 的 `saveProjectFile` 也会强制拒绝写入，避免绕过 Presentation 与导出事实源。
页面不提供删除、重命名或二进制编辑。它管理的是当前 workspace 文件，不生成
immutable Artifact Revision，也不把一次保存自动解释为 `ready/verified`。

详见 [文件操作](../agent/file-operations.md)。

### 4.6 Prompt、Skill 与 Hook

三者职责不同：

| 机制 | 负责 | 不负责 |
|---|---|---|
| System Prompt section | 身份、稳定规则、当前上下文和能力说明 | 真正的权限拦截 |
| Skill | 按需注入领域知识、步骤建议和检查表 | 强制 Runtime 阶段转换 |
| Hook | 在确定执行点观察、阻塞或补充行为 | 修改 canonical state 的任意旁路 |

Prompt 采用稳定前缀和动态后缀，section 顺序与 cache key 由 assembler 管理。PPT 的
`ppt-workflow`（SVG-native 新建）、design、layout、beautify、review、export 等 Skill
是渐进式知识包；stage policy 只改变推荐度，不应把其他安全工具变为不可用。

### 4.7 多 Agent、任务与后台工作

多 Agent 的目标方向是六项能力：并行处理、上下文隔离、专业化、独立判断与交叉验证、长任务委派与生命周期管理、组织协作。它是可选协作层，不是 SVG-native 作者路径的必经步骤。

当前协作能力由四个相互独立的对象构成：

- `TaskStore`：任务身份、状态、依赖和持久化；
- teammate conversation：子 Agent 自己的消息历史与工具上下文；
- message bus / inbox：Agent 间消息传递；
- background task manager：前台 Query 之外的受控执行。

teammate 必须有独立 Agent identity，但共享 workspace 安全边界和文件服务。任务完成、失败、取消和 shutdown 都应进入终态，不能只靠进程/Promise 消失判断完成。Lead 侧 Task\* / `spawn_teammate` 等协作工具为 Deferred，经 `SearchExtraTools` 按需发现，避免常驻 Core schema。

当前 `Partial` 的是“后台平台”而非基本后台执行：Agent PPT 尚未具备 Claude Code 的 daemon、跨进程 attach、`ps/logs/kill`、Remote Control 或 ACP 接入。

详见 [Multi-Agent](../agent/multi-agent.md)。

### 4.8 持久化、恢复与取消

持久化分为三类事实：

| 数据 | 保存内容 | 不能保存 |
|---|---|---|
| History | 已提交的 canonical 对话 | 未配对的临时 tool result |
| Checkpoint | Run phase、inflight、恢复 fence | UI 展示组件状态 |
| Transcript / activity | 可读审计与进度投影 | Provider History 的替代品 |

writer lease 防止两个执行者同时推进同一 Run；CAS 防止旧快照覆盖新状态；checkpoint coordinator 在模型提交、工具副作用和终态之间建立恢复边界；cancellation 负责停止后续调度，但已经发生的外部副作用仍需通过 checkpoint 和幂等边界处理。

详见 [持久化与恢复](../agent/persistence.md)。

## 5. Presentation 专属工程能力

Claude Code 提供通用 Agent 骨架，Agent PPT 的产品价值来自以下领域层。

### 5.1 产品创建路径

- **Agent SVG-native（产品唯一创建/作者路径）**：`design/design-spec.json` → `slides/page-plan.json` → `slides/svg/PNN.svg` → `PreviewSvgPage` → `SubmitSvgDeck` → CommitGate。
- **Layout Grammar / element-IR**：共享库、element-IR slide 模型与 Agent 作者工具均已**移除**
  （`tests/svg-native-tool-surface.test.ts`）。Presentation 现为 STRICT SVG-only。

所有可达写入最终进入同一 Presentation schema、CommitGate、renderer 与 exporter，不能各自产生不兼容的“第二套 slide 事实”。

### 5.2 设计与布局

当前能力包括：

- SVG-native 页面作者源与 `visualSource.kind === "svg"`；
- `src/design-system/` 中的 DesignSystemV2 schema、preset、brand profile、颜色、背景与图片处理；
- HTML 预览、Renderer 镜像与 PPTX 导出使用 SVG-native Presentation 模型。

SVG-native 路径下模型直接写作完整页面 SVG；不再存在 layout handler、element-IR 或
Grammar 作者工具面。

### 5.3 提案、质量与交付

写入链路是：

```text
tool proposal（SubmitSvgDeck）
  → preview / diff
  → schema and deck validators
  → risk policy
  → CommitGate
  → canonical presentation
  → thumbnail / preview
  → PPTX export
  → postflight
```

自动质量能力覆盖 SVG 预览门禁、layout/style/asset 与 deck validators。最终约束由确定性代码执行，不能由模型绕过。

详见 [工作流与状态](../presentation/workflow.md) 和
[Visual Expression System](../presentation/visual-system.md)。

## 6. 明确不复制的 Claude Code 能力

以下能力有价值，但现在不应因为参考项目存在就进入 PPT Runtime：

| 能力 | 暂不采用的原因 | 重新评估条件 |
|---|---|---|
| 任意 Bash / PowerShell | 权限面过大；当前只保留 teammate 的 fail-closed 只读 direct-exec 子集 | 出现无法由结构化工具覆盖的明确用例，并先具备可证明的 OS sandbox |
| MCP / Plugin Marketplace | 会显著扩大配置、权限和兼容面 | 产品需要第三方数据源/企业连接器 |
| LSP / IDE 集成 | 与 Presentation 主任务无关 | 产品扩展为通用内容开发环境 |
| Computer Use / Chrome Control | 外部副作用与隐私边界复杂 | 明确需要浏览器内采集或演示 |
| Daemon / Remote Control / ACP | Electron 当前是本地交互入口 | 需要无人值守、移动端或远程协作 |
| 多 Provider 全兼容 | 维护成本高，且语义能力并不等价 | 有明确用户、模型能力和测试矩阵 |
| Feature flag 大矩阵 | 当前规模下会隐藏真实行为组合 | 发布渠道或实验数量确实需要 |

新增这些能力前，必须先定义产品用例、权限模型、持久化影响和验收矩阵，不能只移植入口。

## 7. 当前能力缺口与优先级

### 已完成：Artifact 与 Job 生命周期

现行实现已经建立每个 `PresentationId` 唯一的长期 `PptJob`，并用 immutable
ArtifactRevision 串联 design-spec、page-plan、SVG、preview、candidate、quality、
proposal、committed Presentation 与 export：

- Query completion 与 PptJob 业务状态正交；
- dependency revision/hash 驱动精确 stale 传播；
- ProposalId、PresentationRevisionId 与 ExportArtifact 分别证明审批、应用与交付；
- apply/export 使用 side-effect claim，恢复时不盲目重放；
- Renderer 通过只读 PptJobProjection 消费状态。

文件页面的 SHA-256 CAS 仍只负责编辑并发，不等于 ArtifactRevision。详细实现与
dev 数据策略见
[Presentation Artifact 与 Job 生命周期](../roadmap/presentation-lifecycle.md)。

### P1：后台执行产品闭环

基础 manager、task 和 inbox 已存在，仍需在出现真实无人值守需求后定义：

- Electron 退出时的任务语义；
- 跨进程 owner/lease；
- 可观察的 logs、cancel 和 retry；
- 凭据与 workspace 生命周期；
- 完成通知。

在这些契约明确前，不应将当前后台 Promise 描述为 daemon 能力。

### P1：端到端质量证据

单元测试可以证明协议和确定性编译，不等于证明真实模型、素材网络和 Office 渲染质量。发布验收还需要：

- Anthropic/OpenAI 真实网关用例；
- 网络搜索和图片来源失败场景；
- 生成样例的缩略图/HTML/PPTX 人工对照；
- PowerPoint/WPS/Keynote 兼容抽查；
- 商业质量评分表。

## 8. 验证矩阵

| 变更范围 | 最小验证 | 扩展验证 |
|---|---|---|
| Query / Runtime | `agent-query-*`、`agent-runtime-*`、`tool-result-pairing` | cancellation、checkpoint、recovery |
| Gateway | adapter、routing、response contract、model recovery | `npm.cmd run test:integration:agent` |
| Tool / Permission | tool pipeline、access policy、approval、hooks | 对应真实工具副作用测试 |
| 文件操作 / 项目文件管理 | `tests/workspace-file-service.test.ts`、`tests/project-file-editor-safety.test.ts` | 编辑 token 隔离、只读 artifact、并发修改、路径逃逸、UTF-8 与原子写失败；页面状态/交互测试 |
| Multi-Agent | task、message bus、teammate recovery | background 与 shutdown 场景 |
| Presentation model | schema、layout、design、compiler | sample fixture 与渲染快照 |
| Export | exporter、postflight、deck export | `npm.cmd run generate:pptx` 后人工打开 |
| 全仓 | `npm.cmd run typecheck`、`npm.cmd test` | `npm.cmd run build` |

文档更新至少应检查 Markdown 相对链接和代码路径是否存在。真实网关测试需要凭据，PPTX 视觉验收需要生成 artifact 后人工检查，二者不能被普通单元测试替代。

## 9. 维护规则

- 能力状态必须由代码和验证入口支持，目录存在不等于 **Implemented**；
- Claude Code 新增功能只有在改善 PPT 主链路正确性时才进入本表；
- 实现能力后同步更新状态、关键代码入口、测试入口和相应专题文档；
- 路线图能力落地前保持 **Proposed**，不要在现行架构中使用未来时态伪装现状；
- 删除或移动实现时先更新本表，避免能力索引成为失效目录清单；
- Provider、工具、Artifact 或恢复协议发生变化时，同时检查安全边界和持久化兼容性。
