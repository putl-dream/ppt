---
name: ppt-storyboard
description: 根据 outline 生成 storyboard.json，规划每页标题、叙事角色与版式意图（完整路径）
when_to_use: outline 已就绪，完整路径中需要逐页分镜时
stages:
  - discover
  - author
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
      "narrativeRole": "hook",
      "layout": "cover",
      "keyPoints": ["副标题或补充说明"]
    }
  ]
}
```

## 叙事角色（narrativeRole，P1-2 联合决策）

每页标注 `narrativeRole`，系统会推导默认 `layout`（可被显式 `layout` 覆盖）：

| narrativeRole | 默认 layout | 适用场景 |
|---------------|-------------|----------|
| `hook` | cover | 开场、封面 |
| `section` | section | 章节过渡 |
| `core` | concept | 核心观点、并列要点 |
| `evidence` | case | 数据、案例、KPI |
| `process` | process | 流程、步骤 |
| `compare` | comparison | 对比、优劣 |
| `summary` | summary | 总结、收尾 |

**本阶段不做**：版式节奏 Rubric、连续三页同 layout 自检、style-modes——留给 `ppt-design-layout` / `ppt-layout`。

## 工作流

1. Task 读取 `outline.md`（或 brief）。
2. 按 outline 叙事弧映射：Hook → section → Core → evidence/process → summary。
3. 为每页填写 `narrativeRole` + `keyPoints`；`layout` 可省略（由 role 推导）。
4. 写回 `slides/storyboard.json`。
5. 主 Agent 摘要：总页数、1 处需确认项。

## 约束（内容阶段）

- **充分写要点**：每条 keyPoint 表达完整意思，不强行 ≤15 字。
- 单页要点数量按内容需要，不必压到 3–5 条。
- **按版式容量分页**：case 每页 1 叙述 + 1 数字；process/architecture 每页 2–4 步；concept 3–4 条；toc 3–8 项。超出就**多开一页**。
- 复杂对比用 `compare` + comparison；流程用 `process`。

## 衔接

完成后主 Agent LoadSkill `ppt-build` 落盘幻灯片（使用 storyboard 的 `layout` / `narrativeRole`）。
