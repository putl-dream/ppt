---
name: ppt-storyboard
description: 根据 outline 生成 storyboard.json，含 guizang 叙事弧、版式节奏与 layout 多样性规划
when_to_use: outline 已就绪，完整路径中需要规划每页布局与 deck 节奏时
---

# Storyboard 分镜

## 目标

Task 子 Agent 写 `slides/storyboard.json`，驱动 SubmitCommands。

## storyboard.json 结构

```json
{
  "slides": [
    {
      "id": "slide-cover",
      "title": "封面标题",
      "layout": "cover",
      "bulletPoints": ["副标题一行"]
    }
  ]
}
```

## 布局

cover、section、concept、comparison、process、architecture、case、summary

选 layout 时遵循 `ppt-layout` 的 [layout-catalog.md](../ppt-layout/layout-catalog.md) 与 [narrative-arc.md](../ppt-layout/narrative-arc.md)。

**guizang 节奏规则（storyboard 自检）**

- 先画「页码 → layout → 叙事角色」表，再写 JSON
- 禁止连续 3 页同 layout
- 8 页+ 至少 1 个 `section`；10 页+ 至少 5 种不同 layout
- 必须含 cover + summary；Core 段穿插 case/process/comparison
- `slide.title` 与首条 bullet 语义不重复（kicker 规则）

guizang 版式对照见 [style-modes.md](../ppt-layout/style-modes.md)。

| 内容形态 | layout |
|----------|--------|
| 封面/封底 | cover |
| 章节分隔 | section |
| 并列要点 | concept |
| 左右对比 | comparison（偶数条） |
| 步骤/时间线 | process |
| 分层架构 | architecture |
| 叙述+数字 | case |
| 总结收束 | summary |

## 工作流

1. Task 读取 `outline.md`（或 brief）。
2. 按 outline 叙事弧映射：Hook(cover) → section → Core(多样 layout) → summary。
3. 写回 `slides/storyboard.json`。
4. 主 Agent 摘要：总页数、layout 种类数、1 处需确认项。

## 约束

- 单页 bullet ≤5 条，每条 ≤15 字。
- 不写 intent/notes 长段；layout 选对即可。
- 复杂对比用 comparison，流程用 process。
