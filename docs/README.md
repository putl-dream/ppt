# Agent PPT 文档

本文档集只保留三类内容：

- **现行架构**：代码正在遵守的稳定契约；
- **本轮目标契约**：正在收敛、不得反向引入旧设计的边界；
- **活跃提案**：尚未实现，明确放在 `roadmap/`。

已完成、已被替代的实施计划不归档在主文档树中。行为事实以代码和测试为准。

## 从这里开始

| 文档 | 内容 |
|---|---|
| [架构总览](./architecture/overview.md) | 五层架构、数据流、状态边界与自主性原则 |
| [工程能力地图](./architecture/engineering-capabilities.md) | Claude Code 能力分层、PPT 落点、成熟度、缺口与验证入口 |
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
| [工作流与状态](./presentation/workflow.md) | Agent/Lean 路径、artifact、workspace 文件管理、Layout Plan、Proposal 与 CommitGate |
| [Visual Expression System](./presentation/visual-system.md) | Design System、Layout Grammar、素材、三端渲染与反馈 |
| [Commercial Visual Compiler](./presentation/commercial-pipeline.md) | DeckSpec v2、Visual Director、素材解析、编译与质量门 |
| [商业视觉质量规范](./presentation/quality-rubric.md) | 机器证据与人工评分的边界 |

## 活跃路线图

| 文档 | 状态 |
|---|---|
| [Presentation Artifact 与 Job 生命周期](./roadmap/presentation-lifecycle.md) | Proposed；尚未成为现行代码事实 |
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
10. Presentation 业务状态与单次 Agent Query 状态正交。
11. 项目文件管理只投影当前 workspace 文件；文本保存必须携带隔离的编辑凭证和读取时
    SHA-256 version，不能把文件保存等同于 artifact revision 或验证完成。

## 本轮重构状态

| 系统 | 状态 | 当前边界 |
|---|---|---|
| Query / Loop | Implemented | 独立 AsyncGenerator、Params/State/Workspace、显式事件与完整批次提交 |
| Runtime | Implemented | 生命周期 facade；装配、循环和 finalization 分离 |
| Model Context | Implemented | canonical messages 压缩、request-scoped Context 投影、多段 max-output 恢复 |
| Tools | Implemented | 动态可用性、definition-owned behavior、统一 permission/hook/execution 管线 |
| System Prompt | Implemented | Section Registry、稳定/动态边界、契约级 cache key、stage 建议化 |
| File operations | Implemented | Main/teammate 共用 read receipt、精确 Edit、冲突检测与受保护提交 |
| Project file management | Implemented | artifact 分组、文件列表/详情/diff；注册文本 artifact 用隔离 `editToken` + SHA-256 CAS 编辑，deck/history/未知文件只读 |
| Presentation lifecycle | Proposed | 跨 Query 的 Artifact Revision / PptJob 仍只在 roadmap |

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
- 文档引用实际路径；移动文件时同步运行链接检查。
- 状态转换优先用类型、表格或图表达，不用模糊进度文案。
- 新规则先判断它属于模型建议还是代码不变量；只有后者进入 Runtime/Policy。
