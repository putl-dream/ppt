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
| 小型新建（≤10 页，需求清晰） | **两阶段** | 内容草稿 → LayoutChoiceCard → **设计 → 执行** |
| 大型新建（>10 页）或用户要求先规划 | **完整** | 见下表 |

## 完整路径阶段（按需跳过可选项）

| 阶段 | LoadSkill | 产出 | 执行者 |
|------|-----------|------|--------|
| 0 规划 | — | TaskGraphCreatePlan（3–5 步，sequential） | 主 Agent（lead/orchestrator） |
| 1 需求 | `ppt-brief` | `brief.md` | teammate 自主领取 |
| 2 大纲 | `ppt-outline` | `outline.md` | teammate 自主领取 |
| 3 分镜 | `ppt-storyboard` | `slides/storyboard.json` | teammate 自主领取 |
| 4 内容草稿 | `ppt-build` | add-slide（无排版） | 主 Agent 整合冻结产物后 SubmitCommands |
| 4b 排版选择 | — | LayoutChoiceCard | 用户（author 子状态） |
| **4c 排版设计** | **`ppt-design-layout`** | **`slides/layout-plan.json`** | **teammate 自主领取（design 阶段）** |
| 5 视觉执行 | `ppt-layout` | ExecuteLayoutPlan 按 plan 执行 commands + 增强 | Core Tool（style 阶段） |
| 5b 质检 | `deck-review` | Rubric + ValidateDeckLayout | style 阶段 |
| 6 美化/导出 | `ppt-beautify` / `ppt-export` | 可选 | 仅用户要求 |

**设计思路来源**：[guizang-ppt-skill](https://github.com/op7418/guizang-ppt-skill) 已适配至 `ppt-layout/`（style-modes、narrative-arc、checklist）。HTML/WebGL 规则不适用本项目。

**默认跳过**：research（`ppt-research`）。设计系统直接进入 layout-plan；项目化留存路径为 `design/system.json`。

## 主 Agent 职责

主 Agent 是 lead/orchestrator，不是全流程生产工人。

1. 先识别意图并选路径；完整/多阶段(≥3 步)**必须**先 `TaskGraphCreatePlan`(sequential) 建计划再执行；单页修改**不要** TaskGraph、两阶段。
2. 任务计划系统只用 `TaskGraph*`；不要使用、恢复或维护临时、平面的任务列表。
3. 创建计划时每步标记 executionTarget：workspace 文件产物用 `teammate`，SubmitCommands / ExecuteLayoutPlan / 用户决策用 `lead`。
4. teammate 节点 description 必须自包含输入、输出路径、验收标准和禁止事项；节点保持 pending/unowned，由常驻 worker 自主 Claim 并置为 submitted；主 Agent 验收后才 `TaskGraphComplete`。lead 节点才由主 Agent 主动 Claim。
5. `Task` 仅用于不属于 TaskGraph 的一次性临时工作；不要对任务图节点重复委派 Task。
6. 新建/批量加页：内容草稿完成后停止，等待 LayoutChoiceCard。
7. 用户确认排版方式后：**先** LoadSkill `ppt-design-layout`，等待 teammate 产出并提交 layout-plan；**再**验收 Complete，LoadSkill `ppt-layout` 并调用 `ExecuteLayoutPlan` 按 plan 执行（禁止 freestyle 改 layout）。
8. 控制步数：设计决策在 teammate 内完成；执行阶段合并 SubmitCommands；不重复 LoadSkill。

## 阶段 4c → 5 衔接

```
LayoutChoiceCard 确认
    ↓
LoadSkill ppt-design-layout
teammate 自主 Claim → slides/layout-plan.json → submitted → lead 验收 Complete
    ↓
LoadSkill ppt-layout（Executor 模式）
ReadPresentationSnapshot
ExecuteLayoutPlan：读取 layout-plan → 校验 → 生成 set-design-system/update-slide-layout/update-slide-variant
ExecuteLayoutPlan：自动执行 insert-image；ExecuteExtraTool：其余 enhancements（BeautifyChart 等）
    ↓
LoadSkill deck-review
```

## 分支

- 用户只改一页 → 轻量路径，LoadSkill `ppt-edit`（若存在）或直接 SubmitCommands
- 已有 brief 无 outline → 从 outline 开始
- 已有 storyboard → 直接 ppt-build
- 只要导出 → ppt-export
- 用户拒绝 Design Agent → 可降级为 ppt-layout 自主选 layout（质量不保证）
