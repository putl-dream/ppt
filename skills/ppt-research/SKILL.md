---
name: ppt-research
description: 整理调研素材到 research/notes.md（默认跳过，仅用户明确要求调研时）
when_to_use: 用户明确要求收集资料、或提供了大量外部素材需要整理时
stages:
  - planning
  - content
---

# 调研笔记

## 目标

Task 子 Agent 维护精简的 `research/notes.md`——事实清单，不是报告。

## research/notes.md 结构

```markdown
# 调研笔记

## 关键事实
- 事实 1（来源）
- 事实 2

## 待核实
- 需用户补充的项
```

## 工作流

1. 仅当用户提供了资料或明确要求调研时才执行。
2. Task 读取 `brief.md` 主题方向。
3. 结构化写入 notes；每条事实标注来源。
4. 主 Agent 摘要：事实条数 + 待核实项。

## 约束

- 默认跳过此阶段；小型 PPT 不需要 research。
- notes 是素材清单，不是幻灯片正文。
- 不把未核实数据写成定论。
