---
name: ppt-brief
description: 起草演示文稿 brief.md，明确目的、受众、时长与风格约束
when_to_use: 用户开始新项目、需要澄清演示方向、或 workspace 尚无 brief.md 时
---

# PPT Brief 起草

## 目标

通过 Task 子 Agent 在 workspace 根目录创建或更新 `brief.md`。

## brief.md 结构

```markdown
# 演示标题

## 目的
（这场演示要达成什么）

## 受众
（谁在看、背景水平）

## 时长与页数
（例如 20 分钟 / 约 25 页）

## 风格与约束
（正式/轻松、是否含代码、品牌色等）

## 必须包含
- 要点 1
- 要点 2

## 明确排除
- 不要的内容
```

## 工作流

1. 若用户已给出足够信息，直接委派 Task 写 brief。
2. 若关键字段缺失，主 Agent 用 AskUser 一次性收集，再 Task。
3. brief 完成后，在回复中摘要 3–5 条结论，不要粘贴全文。

## 质量检查

- 目的与受众必须具体，不能是"通用商务演示"。
- 页数/时长与内容量应匹配。
