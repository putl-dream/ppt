# Agent PPT 文档

本文档集只保留三类内容：

- **现行架构**：代码正在遵守的稳定契约；
- **本轮目标契约**：正在收敛、不得反向引入旧设计的边界；
- **活跃提案或实施记录**：未实现设计明确标记 Proposed；已落地路线图明确标记
  Implemented，并作为架构决策与数据策略记录保留。

已完成、已被替代的实施计划不归档在主文档树中。行为事实以代码和测试为准。

## 从这里开始

| 文档 | 内容 |
|---|---|
| [架构总览](./architecture/overview.md) | 五层架构、数据流、状态边界与自主性原则 |
| [工程能力地图](./architecture/engineering-capabilities.md) | Claude Code 能力分层、PPT 落点、成熟度、缺口与验证入口 |
| [本地日志与运行诊断](./architecture/observability.md) | JSONL 日志、关联身份、事件级别、脱敏与容量边界 |
| [Query](./agent/query.md) | QueryParams、QueryState、IterationWorkspace、身份与恢复 |
| [Agent Loop](./agent/loop.md) | 独立 AsyncGenerator、显式 outcome、工具批次与事件 |
| [Agent Runtime](./agent/runtime.md) | Service、RunFactory、RunScope、Runtime 与 Finalizer |

## Agent 系统

| 文档 | 内容 |
|---|---|
| [Tool 系统](./agent/tools.md) | ToolDefinition、动态解析、单一执行管线、权限和并发 |
| [文件操作](./agent/file-operations.md) | Main/teammate 共用 Glob、ReadFile、WriteFile、EditFile，读后写与原子提交 |
| [System Prompt 与 Context](./agent/system-context.md) | 稳定/动态分区、Section Registry、Skill stage 建议化 |
| [持久化与恢复](./agent/persistence.md) | History、checkpoint、lease、inflight 恢复和数据安全 |
| [Multi-Agent](./agent/multi-agent.md) | TaskStore、teammate 生命周期、mailbox 与后台任务 |

## Presentation 系统

| 文档 | 内容 |
|---|---|
| [工作流与状态](./presentation/workflow.md) | SVG-native Agent 创建路径、artifact、workspace 文件管理、Proposal 与 CommitGate |
| [Presentation Artifact 与 Job 生命周期](./roadmap/presentation-lifecycle.md) | 已落地的 Query/PptJob/ArtifactRevision、事务、恢复与数据根契约 |
| [Visual Expression System](./presentation/visual-system.md) | DesignSystemV2、SVG visualSource、Layout Grammar 遗留路径、三端渲染 |

## 活跃路线图

| 文档 | 状态 |
|---|---|
| [Presentation 模板管理与自动选择](./roadmap/template-management.md) | Proposed；模板上传、内容匹配、默认回退与母版复用边界 |

## 核心设计约束

1. Query Loop 由独立 `AsyncGenerator` 驱动，不嵌入 UI 或固定 PPT 阶段机。
2. `QueryParams → QueryState → IterationWorkspace` 是唯一 Query 状态层级。
3. 观察事件只做投影，不能成为第二个事实源。
4. 工具按当前 Context 动态解析；注册工具不等于始终暴露。
5. Main Agent 可以直接使用安全的 Glob/Read/Write/Edit，不强制借 teammate 写文件。
6. 覆盖/Edit 必须 read-before-write，所有文本写入使用原子替换。
7. Skill stage 只影响推荐和排序，不是权限 allow-list。
8. System Prompt 使用稳定前缀、动态后缀和 Section Registry。
9. 权限、tool pairing、CommitGate 和持久化不变量由代码执行，不依赖 Prompt。
10. `QueryId` 管一次请求；每个 `PresentationId` 只有一个长期 `PptJob`；
    `ArtifactRevision` 证明已校验阶段产出。三者身份与 `runId/threadId` 分离。
11. 项目文件管理只投影当前 workspace 文件；文本保存必须携带隔离的编辑凭证和读取时
    SHA-256 version，不能把文件保存等同于 artifact revision 或验证完成。
12. 产品创建路径仅为 Agent SVG-native（`PreviewSvgPage` → `SubmitSvgDeck`）。
    `executionStrategy`（AUTO / REQUEST_APPROVAL）是审批策略，不是创建模式。
13. Query completed、Proposal ready、Presentation applied 与 Export completed 是四个
    独立事实；Renderer 通过只读 `PptJobProjection` 消费业务状态。
14. 应用持久数据只写入 `~/.agent-ppt`，Electron userData 位于
    `~/.agent-ppt/electron`；workspace/sandbox 仍在用户项目目录。
15. dev 阶段不 backfill、hydrate 或迁移 AppData 旧数据；旧路径由开发者手工清理。

## 本轮重构状态

| 系统 | 状态 | 当前边界 |
|---|---|---|
| Query / Loop | Implemented | 独立 AsyncGenerator、Params/State/Workspace、显式事件与完整批次提交 |
| Runtime | Implemented | 生命周期 facade；装配、循环和 finalization 分离 |
| Model Context | Implemented | canonical messages 压缩、request-scoped Context 投影、多段 max-output 恢复 |
| Tools | Implemented | 动态可用性、definition-owned behavior、统一 permission/hook/execution 管线 |
| System Prompt | Implemented | Section Registry、稳定/动态边界、契约级 cache key、stage 建议化 |
| File operations | Implemented | Main/teammate 共用 read receipt、精确 Edit、冲突检测与受保护提交 |
| Project file management | Implemented | design-spec/page-plan/Page SVG/assets/deck/export history 为第一公民；注册文本 artifact 用隔离 `editToken` + SHA-256 CAS 编辑 |
| SVG-native create | Implemented | durable DesignSpec/PagePlan/SourceAsset/PageSvg/PreviewReceipt → Candidate/Quality/Proposal |
| Presentation lifecycle | Implemented | 每个 Presentation 一个跨 Query PptJob；immutable revision/dependency/stale、Proposal/Presentation/Review/Export 与 side-effect recovery |
| Application data root | Implemented | SQLite、blobs、logs、runtime、token usage 位于 `~/.agent-ppt`；Electron userData 位于 `~/.agent-ppt/electron` |

## 参考项目的使用方式

`/mnt/e/Coding/claude-code` 是工程设计参考，不是复制来源。重点吸收：

- `QueryEngine` 与 `query()` 的编排/循环分层；
- Query Params、跨圈 State 和显式 transition；
- Tool pool 动态组装与单一执行管线；
- File Read/Edit/Write 的并发与写入安全；
- System Prompt 的稳定/动态缓存分区；
- 权限作为代码策略层。

本项目保留 Electron、Presentation、CommitGate、PPTX 和本地项目 artifact 等自身领域边界。
完整的能力对照、当前成熟度和明确不复制的范围见
[工程能力地图](./architecture/engineering-capabilities.md)。

## 文档维护规则

- 代码重构完成后，更新现行文档并删除对应阶段计划。
- 活跃提案必须标记 `Proposed`，不能写成“当前已经如此”。
- 已落地且因架构决策或 dev 数据策略需要保留的路线图必须标记 `Implemented`，
  并同步现行 workflow 与本索引。
- 文档引用实际路径；移动文件时同步运行链接检查。
- 状态转换优先用类型、表格或图表达，不用模糊进度文案。
- 新规则先判断它属于模型建议还是代码不变量；只有后者进入 Runtime/Policy。
