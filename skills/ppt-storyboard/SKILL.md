---
name: ppt-storyboard
description: 根据 outline 生成 storyboard.json，规划每页标题与要点（完整路径）
when_to_use: outline 已就绪，完整路径中需要逐页分镜时
stages:
  - planning
  - content
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
      "bulletPoints": ["副标题或补充说明"]
    }
  ]
}
```

## 布局字段（占位即可）

`layout` 字段先按内容形态选粗略类型：cover、section、concept、comparison、process、architecture、case、summary。

**本阶段不做**：版式节奏 Rubric、连续三页同 layout 自检、style-modes——留给 `ppt-design-layout` / `ppt-layout`。

## 工作流

1. Task 读取 `outline.md`（或 brief）。
2. 按 outline 叙事弧映射：Hook(cover) → section → Core → summary。
3. 写回 `slides/storyboard.json`。
4. 主 Agent 摘要：总页数、1 处需确认项。

## 约束（内容阶段）

- **充分写要点**：每条 bullet 表达完整意思，不强行 ≤15 字。
- 单页要点数量按内容需要，不必压到 3–5 条。
- 不写 intent/notes 长段；复杂对比用 comparison，流程用 process。
- **按版式容量分页**：case 每页 1 叙述 + 1 数字；process/architecture 每页 2–4 步；concept 3–4 条；toc 3–8 项。超出就**多开一页**，不要把 6 个步骤塞进一页 process。引擎会缩字兜底但观感下降。

## 衔接

完成后主 Agent LoadSkill `ppt-build` 落盘幻灯片。
