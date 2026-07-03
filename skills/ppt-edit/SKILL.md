---
name: ppt-edit
description: 对已有幻灯片做增量修改，包括改标题、改文案、增删元素与调布局
when_to_use: deck 已存在，用户要求改某一页、某段文字、替换图片或调整顺序时
allowed-tools:
  - ReadPresentationSnapshot
  - ReadCurrentSlide
  - GetSelection
  - ListSlides
  - PreviewCommands
  - SubmitCommands
---

# 增量编辑

## 目标

在保留其余页面的前提下，精准修改指定幻灯片，避免全量重建。

## 先读后改

1. `ReadPresentationSnapshot` 或 `ListSlides` 获取 `slideId`。
2. 改当前页： `ReadCurrentSlide` + `GetSelection` 获取 `elementId`。
3. **禁止**编造 ID；所有 ID 必须来自快照。

## 常用命令

| 操作 | 命令类型 |
|------|---------|
| 改演示标题 | `set-presentation-title` |
| 改页标题 | `set-slide-title` |
| 改文本/样式 | `update-element`（完整 element 对象） |
| 新增文本框/图 | `add-element` |
| 删除元素 | `remove-element` |
| 换版式 | `update-slide-layout` |
| 移动/缩放 | `move-element` / `resize-element` |
| 删页 | `remove-slide`（risk: high，需用户确认） |
| 插页 | `add-slide` + `update-slide-layout` |

## 工作流

1. 明确用户意图：哪一页、改什么、是否动其他页。
2. 组装最小命令集；`PreviewCommands` 验证。
3. `SubmitCommands`：
   - 单元素文字：`risk: low`
   - 删页 / 批量改 5+ 页：`risk: medium` 或 `high`
4. 回复摘要：改了哪些 slide、是否需要再看效果。

## 与 storyboard 同步

若项目有 `slides/storyboard.json`，结构性改动（增删页、改章节）应 Task 同步更新 storyboard，避免 workspace 与 deck 漂移。

## 衔接

纯文案润色可用 `ppt-beautify` 的 RewriteSlideContent；大范围问题用 `deck-review`。
