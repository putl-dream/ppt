# Agent PPT 文档

| 文档 | 说明 |
|------|------|
| [agent-data-pipeline.md](./agent-data-pipeline.md) | 模型内容块、工具调用配对、结果归一化与持久化的数据链路设计 |
| [agent-persistence-recovery.md](./agent-persistence-recovery.md) | Durable Run checkpoint、跨重启审批、事务写入与冷启动恢复语义 |
| [agent-runtime-refactor-plan.md](./agent-runtime-refactor-plan.md) | 主 Agent Runtime 的 Session、transition、checkpoint lease、工具事务与领域边界渐进式重构方案 |
| [agent-runtime-thin-layer-refactor-plan.md](./agent-runtime-thin-layer-refactor-plan.md) | 主 Agent Runtime 第二阶段薄层收敛：RunScope、稳定 Loop Driver、单 turn 执行器与统一终态方案 |
| [ppt-quality-attention-plan.md](./ppt-quality-attention-plan.md) | PPT 生成质量与模型注意力问题诊断及改进计划 |
| [ppt-layout-state-machine-plan.md](./ppt-layout-state-machine-plan.md) | 排版流程状态机化：layout-plan 唯一事实源、校验器与执行器方案 |
| [ppt-style-capability-plan.md](./ppt-style-capability-plan.md) | 样式表达能力评估与分阶段能力建设方案 |
| [visual-expression-system-plan.md](./visual-expression-system-plan.md) | 视觉表达系统、Layout Grammar 与品牌化能力建设计划 |
| [commercial-ppt-visual-compiler-v2.md](./commercial-ppt-visual-compiler-v2.md) | Lean Mode 从自动排版稿升级到商业成品的 Scene、素材、视觉导演与质量门路线 |
| [harness-teammate-message-bus-fix-plan.md](./harness-teammate-message-bus-fix-plan.md) | Harness 多 Agent 协作与消息总线 review 问题修复方案 |
| [teammate-runtime-refactor-plan.md](./teammate-runtime-refactor-plan.md) | Teammate runtime 状态迁移、conversation 与工具管线的渐进式重构计划 |
| [teammate-runtime-second-stage-refactor-plan.md](./teammate-runtime-second-stage-refactor-plan.md) | Teammate runtime 第二阶段：Active Inbox、单 turn runner、任务所有权与终态清理方案 |
| [frontend-app-decomposition-plan.md](./frontend-app-decomposition-plan.md) | 前端 App 控制层拆分：Workspace、Presentation、Chat、Agent Controller 的分阶段路线图 |

相关 Skill 文档见仓库 `skills/ppt-layout/`（排版规则、guizang 适配、质检清单）。
