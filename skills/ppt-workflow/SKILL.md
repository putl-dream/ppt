---
name: ppt-workflow
description: 端到端演示创作流程编排，按阶段 LoadSkill 并委派 Task，从 brief 到导出
when_to_use: 用户要从零做完整 PPT、不确定下一步、或要求「一条龙」完成演示时
---

# 端到端工作流

## 阶段与技能

| 阶段 | LoadSkill | 产出 | 执行者 |
|------|-----------|------|--------|
| 0 规划 | — | TodoWrite 步骤列表 | 主 Agent |
| 1 需求 | `ppt-brief` | `brief.md` | Task |
| 2 调研 | `ppt-research` | `research/notes.md` | Task（可选） |
| 3 大纲 | `ppt-outline` | `outline.md` | Task |
| 4 分镜 | `ppt-storyboard` | `slides/storyboard.json` | Task |
| 5 设计 | `ppt-design` | `design/theme.json` + set-theme | Task + SubmitCommands |
| 6 建稿 | `ppt-build` | 幻灯片实体 | SubmitCommands |
| 7 质检 | `deck-review` | 审查报告 | 主 Agent |
| 8 美化 | `ppt-beautify` | 排版/润色 | Deferred + SubmitCommands |
| 9 导出 | `ppt-export` | .pptx 文件 | ExecuteExtraTool |

## 主 Agent 职责

1. **TodoWrite** 列出上表相关步骤（可跳过可选阶段）。
2. 每步开始：`LoadSkill` → 按技能指引执行 → **TodoWrite** 标 completed。
3. workspace 文件一律 **Task 委派**；幻灯片改动 **SubmitCommands**。
4. 每步结束只回传 3–5 条摘要，不粘贴中间产物全文。
5. 互不依赖的 Task（如 research 某段 + outline 某段）可用 `descriptions` 数组并发。

## 分支决策

- 用户只改一页 → 跳过 1–4，LoadSkill `ppt-edit`
- 已有 brief 无 outline → 从阶段 3 开始
- 已有 storyboard 无幻灯片 → 从阶段 5–6 开始
- 只要导出 → `deck-review`（可选）→ `ppt-export`

## 质量关卡

- 阶段 6 后：严重审查问题为 0 再进入 8/9。
- 阶段 6 前：`PreviewCommands` 必须通过再 SubmitCommands。
- 删页、全量覆盖：AskUser 确认。

## 示例 Todo 列表

```
1. 起草 brief（ppt-brief）
2. 写 outline（ppt-outline）
3. 写 storyboard（ppt-storyboard）
4. 定主题并建稿（ppt-design + ppt-build）
5. 审查 deck（deck-review）
6. 导出 pptx（ppt-export）
```
