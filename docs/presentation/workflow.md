# Presentation 工作流与状态

> 文档类型：现行架构
> 活跃演进方案见 [Presentation 生命周期路线图](../roadmap/presentation-lifecycle.md)

## 1. 工作流不是 Agent Loop

Agent Loop 负责一个 Query 内的模型和工具推进；Presentation 工作流负责一份演示从需求到交付的业务产物。

模型可以根据用户目标选择：

- 直接回答，不创建 PPT；
- 对现有 deck 做一次轻量编辑；
- 使用 Agent Mode 逐步产出中间文件；
- 使用 Lean Mode 一次生成商业初稿；
- 从任一已有 artifact 继续；
- 只审查或导出。

Prompt stage 只提供当前事实和推荐能力，不能强迫所有请求经过固定六阶段。

## 2. 当前两条创建路径

### Agent Mode

```text
request
  → optional brief.md
  → optional outline.md
  → optional slides/storyboard.json
  → content proposal / Presentation draft
  → optional slides/layout-plan.json
  → ExecuteLayoutPlan / other tools
  → command proposal
  → approval + CommitGate
  → committed Presentation
```

中间文件按任务需要创建，不再仅因当前 stage 自动要求齐全。

### Lean Mode

```text
request
  → one structured content model call
  → LeanDeckSpecV2
  → CommercialVisualDirector
  → DirectedDeckPlan
  → asset resolution
  → deterministic compile
  → CommercialQualityGate
  → optional bounded visual review
  → proposal / committed Presentation
```

两条路径目前在前半段使用不同 artifact，但都必须进入同一 Presentation schema、质量验证和提交边界。

## 3. 当前 artifact

| Artifact | 作用 | 典型位置 |
|---|---|---|
| Brief | 目标、受众、范围 | `brief.md` |
| Outline | 章节和页级骨架 | `outline.md` |
| Research | 来源与素材笔记 | `research/` |
| Storyboard | 页级叙事与内容 | `slides/storyboard.json` |
| Layout Plan | 逐页 layout/variant/tokens/enhancement | `slides/layout-plan.json` |
| Brand Profile | 品牌人格与视觉偏好 | `design/brand-profile.json` |
| Presentation | 已应用或当前编辑的可编辑 deck | deck snapshot |
| Export | PPTX/HTML 和 postflight 报告 | export history |

文件存在不等于 artifact 已验证。消费方必须解析 schema、检查依赖和当前 Presentation revision。

## 4. 当前状态来源

当前代码仍有两种状态视图：

- workspace probe：文件是否 missing/default/invalid/verified；
- project artifact metadata：draft/ready/stale。

它们是当前兼容事实，不应继续扩成第三套工作流状态。跨 Query 的统一 revision/dependency 状态属于路线图中的 `PptJob`。

## 5. 读取和写入

Main Agent 与 teammate 使用统一 Glob/ReadFile/WriteFile/EditFile：

- 读取建立 receipt/read-set；
- 覆盖和 Edit 执行乐观并发检查；
- 写入使用原子替换；
- 通用文件写入只保证文本与并发安全，不自动运行 artifact schema validator；
- 消费方在使用前负责解析和验证；`ready/verified` 不能只由文件存在推导。

不要通过 Shell 重定向生成工作流文件。

## 6. Layout Plan

`slides/layout-plan.json` 在 Agent 视觉排版路径中是设计决策事实：

- 与当前 slide ID、数量和顺序对齐；
- 每页声明 layout、narrative role 和可选 grammar/tokens；
- validator 检查 schema、节奏、可执行变体和图片槽；
- `ExecuteLayoutPlan` 将其编译为命令提案；
- Plan 本身不直接修改 Presentation。

模型也可以为简单局部编辑跳过 Layout Plan，直接使用安全的 Presentation 工具。

## 7. Proposal 与 CommitGate

模型不能直接篡改当前 Presentation 对象。

```text
Tool result
  → PresentationCommand[]
  → proposal
  → schema + sandbox apply
  → diff
  → validation + risk
  → auto apply or user approval
  → CommandBus CAS
  → new Presentation revision
```

必须区分：

- 工具执行成功；
- proposal 已生成；
- proposal 已批准；
- commands 已应用；
- export 已发布。

任何一步都不能用普通聊天文本冒充下一步完成。

## 8. 用户交互点

只有真实产品决策才暂停：

- 目标/约束缺失且模型无法安全推断；
- 高风险命令审批；
- 用户明确要求比较方案；
- 素材授权需要确认；
- Proposal 与当前 revision 冲突。

“当前 stage 应该问用户”不是暂停理由。模型能通过读取事实或工具验证的信息应自行获取。

## 9. 修改已有 deck

轻量 edit：

1. 读取当前 snapshot/目标文件；
2. 定位用户指定范围；
3. 直接调用相应工具；
4. 生成最小 proposal；
5. 通过 CommitGate。

大规模 restyle/restructure 可以创建新的 design candidate，但在用户批准前不覆盖 committed Presentation。

## 10. 恢复

- Query checkpoint 恢复模型/工具批次。
- Project artifact 文件恢复中间内容。
- Presentation revision 恢复已应用 deck。
- Export history 恢复已发布交付物。

它们不能互相替代。恢复时先读 durable facts，再让模型决定继续、修复或重新生成。

## 11. 关键实现

- `src/main/project/`
- `src/shared/project-artifacts.ts`
- `src/shared/project-artifact-state.ts`
- `src/shared/layout-plan.ts`
- `src/main/agent/tools/core/execute-layout-plan.ts`
- `src/main/agent/tools/core/submit-commands.ts`
- `src/main/agent/gate/`
- `src/shared/commands.ts`（`CommandBus`）
- `src/shared/presentation.ts`

## 12. 当前已知结构性缺口

- Agent/Lean 前半段 artifact 尚未统一。
- artifact 缺少统一 immutable revision 和 dependency hash。
- candidate、preview 和 committed Presentation 边界仍需进一步收敛。
- 完整工作流状态尚未成为跨 Query 的单一 `PptJob`。

这些问题只在 [路线图](../roadmap/presentation-lifecycle.md) 中维护，不再创建新的阶段性 plan 文档。
