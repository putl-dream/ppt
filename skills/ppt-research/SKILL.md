---
name: ppt-research
description: 整理调研素材到 research/notes.md，支撑 outline 与 storyboard 的事实依据
when_to_use: 需要收集资料、整理数据要点、或演示依赖外部事实/案例/引用时
---

# 调研笔记

## 目标

通过 Task 子 Agent 维护 `research/notes.md`，为 outline 与幻灯片文案提供可引用素材。

## research/notes.md 结构

```markdown
# 调研笔记

## 来源
- [标题](URL) — 摘要一句话

## 关键事实
- 事实 1（附来源编号或链接）
- 事实 2

## 数据与图表
| 指标 | 数值 | 来源 |
|------|------|------|

## 案例 / 引用
- 案例名：…

## 待核实
- 用户需补充的项
```

## 工作流

1. Task 读取 `brief.md` 中「必须包含」与主题方向。
2. 将用户粘贴的资料、文件摘要或检索结论结构化写入 notes。
3. 每条关键事实标注来源；无法核实的放入「待核实」。
4. 主 Agent 摘要：事实条数、待核实项、建议落入 outline 的章节。

## 质量检查

- 不把未核实数据写成定论。
- 数据表保持简短，详表放附件路径（若用户提供）。
- notes 是素材库，不是幻灯片正文；单条要点仍须符合 storyboard 字数约束。

## 衔接

notes 就绪后更新 `ppt-outline` 或在 storyboard 阶段引用具体事实。
