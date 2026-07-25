---
name: ppt-workflow
description: 端到端演示创作流程；默认轻量路径，完整路径按需分阶段
when_to_use: 用户要从零做完整 PPT、不确定下一步、或要求「一条龙」完成演示时
stages:
  - discover
---

# 端到端工作流

## 路径选择（先判断，不要默认走完整流程）

| 场景 | 路径 | 步骤 |
|------|------|------|
| 改页/加页/换设计系统/用户已给内容 | **轻量** | ReadPresentationSnapshot → SubmitCommands |
| 小型新建（≤10 页，需求清晰） | **两阶段** | 内容草稿 → 设计方向 → **设计 → 执行** |
| 大型新建（>10 页）或用户要求先规划 | **完整** | 见下表 |

## 完整路径阶段（按需跳过可选项）

| 阶段 | LoadSkill | 产出 | 执行者 |
|------|-----------|------|--------|
| 0 规划 | — | TaskCreate（3–5 项）+ TaskUpdate 建依赖 | 主 Agent（lead/orchestrator） |
| 1 需求 | `ppt-brief` | `brief.md` | teammate 自主领取 |
| 2 大纲 | `ppt-outline` | `outline.md` | teammate 自主领取 |
| 3 分镜 | `ppt-storyboard` | `slides/storyboard.json` | teammate 自主领取 |
| 4 内容草稿 | `ppt-build` | add-slide（无排版） | 主 Agent 整合冻结产物后 SubmitCommands |
| **4b 设计方向** | **`ppt-design`** | **需求合同 + safe / shifted / bold，或用户锁定的单一方向** | **主 Agent + 用户（需要选择时）** |
| **4c 排版设计** | **`ppt-design-layout`** | **`slides/layout-plan.json`** | **teammate 自主领取（design 阶段）** |
| 5 视觉执行 | `ppt-layout` | ExecuteLayoutPlan 按 plan 执行 commands + 增强 | Core Tool（style 阶段） |
| 5b 质检 | `deck-review` | Rubric + ValidateDeckLayout | style 阶段 |
| 6 美化/导出 | `ppt-beautify` / `ppt-export` | 可选 | 仅用户要求 |

**设计能力来源**：`ppt-master` 的设计决策层已复刻为本项目原生能力：5 种论证模式、18 种视觉风格、三档设计方向、阅读模式、页面节奏和 audience move。其 Python/SVG/PPTX 生成管线不进入本项目。

**默认跳过**：research（`ppt-research`）。设计系统直接进入 layout-plan；项目化留存路径为 `design/system.json`。

## 主 Agent 职责

主 Agent 是 lead/orchestrator，不是全流程生产工人。

1. 先识别意图并选路径；完整/多阶段任务按需用 `TaskCreate` 建任务，再用 `TaskUpdate` 建依赖；单页修改无需 Task。
2. 任务计划系统只用职责分离的 `Task*` 工具；恢复时先 `TaskList` / `TaskGet`。
3. 创建计划时每步标记 executionTarget：workspace 文件产物用 `teammate`，SubmitCommands / ExecuteLayoutPlan / 用户决策用 `lead`。
4. teammate 节点 description 必须自包含输入、输出路径、验收标准和禁止事项；保持 pending/unowned，由 watcher Claim；完成工作后 `TaskReviewRequest`，lead 用 approve/reject 验收。
5. claim 只写 owner；开始工作须显式 `TaskUpdate(in_progress)`，普通工具结果不自动推进状态。
6. 新建/批量加页：内容草稿完成后，LoadSkill `ppt-design` 并建立完整需求合同。用户明确指定风格时生成一个 locked 方向；否则生成彼此有实质差异的 safe / shifted / bold 三档方向，并让用户确认。
7. 方向确认后：**先** LoadSkill `ppt-design-layout`，等待 teammate 产出并提交 LayoutPlan v2；**再**验收 Complete，LoadSkill `ppt-layout` 并调用 `ExecuteLayoutPlan` 按 plan 执行（禁止 freestyle 改 layout）。
8. 图片页先写入图片元素，再按同一 grammar 做最终布局；不得先冻结空槽位坐标。
9. 控制步数：方向决策只做一次；执行阶段合并 SubmitCommands；不重复 LoadSkill。

## 阶段 4c → 5 衔接

```
LoadSkill ppt-design
ResolveDesignPlan → 用户确认 direction
    ↓
LoadSkill ppt-design-layout
teammate 自主 Claim → TaskUpdate(in_progress) → slides/layout-plan.json → TaskReviewRequest → lead TaskReviewApprove
    ↓
LoadSkill ppt-layout（Executor 模式）
ReadPresentationSnapshot
ExecuteLayoutPlan：读取 LayoutPlan v2 → 校验 direction / audienceMove / rhythm → 生成 set-design-system/update-slide-layout/update-slide-variant
ExecuteLayoutPlan：先插入或替换 image，再执行最终 layout；ExecuteExtraTool：其余 enhancements（BeautifyChart 等）
    ↓
LoadSkill deck-review
```

## 分支

- 用户只改一页 → 轻量路径，LoadSkill `ppt-edit`（若存在）或直接 SubmitCommands
- 已有 brief 无 outline → 从 outline 开始
- 已有 storyboard → 直接 ppt-build
- 只要导出 → ppt-export
- 用户拒绝推荐方向 → 回到 `ppt-design` 修改或锁定方向；不得跳过计划让 Executor 自主选风格
