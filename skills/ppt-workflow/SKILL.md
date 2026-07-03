---
name: ppt-workflow
description: 端到端演示创作流程编排；默认走轻量路径，完整路径仅用于大型新建
when_to_use: 用户要从零做完整 PPT、不确定下一步、或要求「一条龙」完成演示时
---

# 端到端工作流

## 路径选择（先判断，不要默认走完整流程）

| 场景 | 路径 | 步骤 |
|------|------|------|
| 改页/加页/换主题/用户已给内容 | **轻量** | ReadPresentationSnapshot → SubmitCommands |
| 小型新建（≤10 页，需求清晰） | **轻量** | AskUser（若缺信息）→ SubmitCommands 直接建稿 |
| 大型新建（>10 页）或用户要求先规划 | **完整** | 见下表 |

## 完整路径阶段（按需跳过可选项）

| 阶段 | LoadSkill | 产出 | 执行者 |
|------|-----------|------|--------|
| 0 规划 | — | TodoWrite（3–5 步） | 主 Agent |
| 1 需求 | `ppt-brief` | `brief.md` | Task |
| 2 大纲 | `ppt-outline` | `outline.md` | Task |
| 3 分镜 | `ppt-storyboard` | `slides/storyboard.json` | Task |
| 4 建稿 | `ppt-build` | 幻灯片实体 | SubmitCommands |
| 5 美化/导出 | `ppt-beautify` / `ppt-export` | 可选 | 仅用户要求 |

**默认跳过**：research（`ppt-research`）、独立 design 文件（主题可直接 set-theme）、deck-review。

## 主 Agent 职责

1. 先选路径；轻量路径**不要** LoadSkill、TodoWrite、Task。
2. 完整路径每步：LoadSkill → Task 或 SubmitCommands → 摘要 2–3 句。
3. workspace 文件一律 Task 委派；幻灯片改动 SubmitCommands。
4. 控制步数：合并 SubmitCommands；不重复 LoadSkill；TodoWrite 只在完整路径开始时用一次。

## 分支

- 用户只改一页 → 轻量路径，LoadSkill `ppt-edit`（若存在）或直接 SubmitCommands
- 已有 brief 无 outline → 从 outline 开始
- 已有 storyboard → 直接 ppt-build
- 只要导出 → ppt-export
