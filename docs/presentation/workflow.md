# Presentation 工作流与状态

> 文档类型：现行架构
> 最后核对：2026-07-30
> 活跃演进方案见 [Presentation 生命周期路线图](../roadmap/presentation-lifecycle.md)

## 1. 工作流不是 Agent Loop

Agent Loop 负责一个 Query 内的模型和工具推进；Presentation 工作流负责一份演示从需求到交付的业务产物。

模型可以根据用户目标选择：

- 直接回答，不创建 PPT；
- 对现有 deck 做一次轻量编辑；
- 使用 SVG-native Agent 路径新建整套演示；
- 从任一已有 artifact 继续；
- 只审查或导出。

Prompt stage 只提供当前事实和推荐能力，不能强迫所有请求经过固定六阶段。

## 2. 产品创建路径：SVG-native Agent

产品入口仅接受 Agent 模式。IPC 拒绝 `generationMode === "lean"`（文案：Lean Mode 已退役，请以 SVG-native 工作流继续）。

新建整套 PPT 的权威流程由 `skills/ppt-workflow` 约定：

```text
request
  → design/design-spec.json（沟通契约 + deck-wide 设计锁）
  → slides/page-plan.json（逐页内容与构图意图）
  → slides/svg/PNN.svg（唯一页面视觉作者源）
  → PreviewSvgPage（逐页真实 PNG 门禁）
  → SubmitSvgDeck（锁文件核对 + 素材内联）
  → approval + CommitGate
  → committed Presentation
```

硬约束：

- 页面视觉事实源是完整页面 SVG（`viewBox="0 0 1280 720"`），不是 layout handler 填槽片段；
- 除 SVG 显式引用的本地 `assets/**` 图片外，背景、标题、正文、页码、图示与装饰都必须已在 SVG 中；
- 新建流程禁止调用 `PreviewCommands`、`SubmitCommands`、`ExecuteLayoutPlan`；
- `SubmitSvgDeck` 要求 `communication` / `designSystem` / 每页 `id/path/narrative` 与锁文件一致；修订 SVG 会使旧 Preview 凭据失效。

相关实现：`src/main/agent/tools/core/preview-svg-page.ts`、
`src/main/agent/tools/core/submit-svg-deck.ts`、`skills/ppt-workflow/SKILL.md`。

## 3. 残余与遗留路径

### Lean / Commercial compiler（非产品 Mode）

`src/main/agent/lean/*`、`scripts/generate-commercial-pptx.ts` 与相关测试仍保留
DeckSpec → Director → compile → quality gate 管线，供离线脚本与回归使用。
它不是 `agent:start` 可达路径。细节见
[Commercial Visual Compiler](./commercial-pipeline.md)。

### Layout Plan（非新建主路径）

`slides/layout-plan.json` + `ExecuteLayoutPlan` 仍可用于遗留或非 SVG 的布局编译，
将 Plan 编译为命令提案。Skill 明确禁止将其用于新建整套演示。Plan 本身不直接修改 Presentation。

简单局部编辑可跳过 Layout Plan / SVG 全流程，直接使用安全的 Presentation 工具（在非 SVG-native 创建场景下）。

## 4. 当前 artifact

| Artifact | 作用 | 典型位置 | 角色 |
|---|---|---|---|
| Design Spec | 沟通契约与 deck-wide 设计锁 | `design/design-spec.json` | SVG-native 新建锁 |
| Page Plan | 有序逐页内容与构图意图 | `slides/page-plan.json` | SVG-native 新建锁 |
| Page SVG | 唯一页面视觉作者源 | `slides/svg/PNN.svg` | SVG-native 视觉事实 |
| Assets | SVG 显式引用的本地资源 | `assets/**` | 素材 |
| Brief / Outline / Research | 可选早期叙事材料 | `brief.md` / `outline.md` / `research/` | 可选 |
| Storyboard | 页级叙事（遗留/兼容） | `slides/storyboard.json` | 遗留；现行 probe 仍检测 |
| Layout Plan | 逐页 layout/variant（遗留） | `slides/layout-plan.json` | 遗留；非新建主路径 |
| Brand / Design System | 品牌与视觉偏好 | `design/` | 与 Design Spec 并存演进 |
| Presentation | 已应用可编辑 deck | deck snapshot | CommitGate 后事实 |
| Export | PPTX/HTML 与 postflight | export history | 交付物 |

文件存在不等于 artifact 已验证。消费方必须解析 schema、检查依赖和当前 Presentation revision。
项目默认 artifact 注册表（如 `storyboard` / `design/system.json`）与 SVG skill 作者文件尚未完全对齐，属已知后续项，不以文档假装已统一。

## 5. 当前状态来源

当前代码仍有两种状态视图：

- workspace probe：文件是否 missing/default/invalid/verified（现行 probe 集仍覆盖 brief/outline/storyboard/layout-plan，尚未扩展为 design-spec/page-plan/svg 全量）；
- project artifact metadata：draft/ready/stale。

它们是当前兼容事实，不应继续扩成第三套工作流状态。跨 Query 的统一 revision/dependency 状态属于路线图中的 `PptJob`。

workspace 项目文件管理页只投影这两类现有事实：文件分组与内容来自 workspace，
artifact 标签来自现有 metadata/validator。页面自己的 loading、dirty、diff 或保存
状态不是新的 Presentation 工作流状态。

## 6. 读取和写入

Main Agent 与 teammate 使用统一 Glob/ReadFile/WriteFile/EditFile：

- 读取建立 receipt/read-set；
- 覆盖和 Edit 执行乐观并发检查；
- 写入使用原子替换；
- 通用文件写入只保证文本与并发安全，不自动运行 artifact schema validator；
- 消费方在使用前负责解析和验证；`ready/verified` 不能只由文件存在推导。

Renderer 提供 workspace-level 项目文件管理页：

- 按 artifact 分组展示文件列表，并提供文本详情和保存前 diff；
- 只打开普通 UTF-8 文本，不跟随 symlink，也不编辑二进制文件；
- Main 在打开文件时返回隔离的 `editToken` 与 `sha256:` version；
- 保存必须同时提交同一 token 和 `expectedVersion`，由 `WorkspaceFileService`
  compare-and-commit；Agent、外部编辑器或另一个页面先修改文件时返回冲突；
- 只有归属于已注册、可编辑 artifact 的文本文件允许保存；`deck`、`history` 与未知
  artifact 文件只读，Main 在保存入口再次强制校验，不能由 Renderer 绕过；
- 保存成功后沿用现有 artifact dependency 规则标记下游 stale，但不能仅凭保存把
  当前 artifact 标记成 `ready/verified`。

现有 `ProjectFileService` 的 artifact 读写同样委托 `WorkspaceFileService`，不再维护
一套弱化的路径、编码和原子写语义。当前页面不提供删除、重命名或二进制编辑。

不要通过 Shell 重定向生成工作流文件。

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

`SubmitSvgDeck` 与遗留 `SubmitCommands` / `ExecuteLayoutPlan` 均产出提案，再进入同一 CommitGate。
`executionStrategy`（AUTO / REQUEST_APPROVAL）只控制审批，不是创建模式。

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

SVG-native deck 的可见修改应改对应 `slides/svg/PNN.svg` 并重新 `PreviewSvgPage`，再视需要 `SubmitSvgDeck`；不能只改 page-plan 期待提交工具代为重绘。

大规模 restyle/restructure 可以创建新的 design candidate，但在用户批准前不覆盖 committed Presentation。

## 10. 恢复

- Query checkpoint 恢复模型/工具批次。
- Project artifact 文件恢复中间内容。
- Presentation revision 恢复已应用 deck。
- Export history 恢复已发布交付物。

它们不能互相替代。恢复时先读 durable facts，再让模型决定继续、修复或重新生成。

## 11. 关键实现

- `skills/ppt-workflow/SKILL.md`
- `src/main/agent/tools/core/preview-svg-page.ts`
- `src/main/agent/tools/core/submit-svg-deck.ts`
- `src/main/index.ts`（拒绝 lean generationMode）
- `src/main/project/`
- `src/main/project/project-file-service.ts`
- `src/shared/ipc.ts`
- `src/renderer/src/app/ProjectFilesView.tsx`
- `src/renderer/src/app/project/useProjectFiles.ts`
- `src/renderer/src/components/ProjectFilesPage.tsx`
- `src/shared/project-artifacts.ts`
- `src/shared/project-artifact-state.ts`
- `src/shared/layout-plan.ts`（遗留）
- `src/main/agent/tools/core/execute-layout-plan.ts`（遗留）
- `src/main/agent/tools/core/submit-commands.ts`
- `src/main/agent/gate/`
- `src/shared/commands.ts`（`CommandBus`）
- `src/shared/presentation.ts`

## 12. 当前已知结构性缺口

- artifact 缺少统一 immutable revision 和 dependency hash。
- candidate、preview 和 committed Presentation 边界仍需进一步收敛。
- 完整工作流状态尚未成为跨 Query 的单一 `PptJob`。
- 文件管理页的 SHA-256 version 是并发前置条件，不是 immutable Artifact Revision。
- 现行 workspace probe / 默认 project artifact 注册与 SVG-native 作者文件未完全对齐。
- Lean 库与部分 UI 文案仍可能残留，但不构成产品 Mode。

这些问题只在 [路线图](../roadmap/presentation-lifecycle.md) 中维护（生命周期部分），不再创建新的阶段性 plan 文档。
