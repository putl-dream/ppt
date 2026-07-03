---
name: ppt-brief
description: 起草 brief.md，明确目的、受众、页数与风格（仅大型新建时使用）
when_to_use: 大型新建（>10 页）且 workspace 尚无 brief.md 时
---

# PPT Brief 起草

## 目标

Task 子 Agent 创建精简的 `brief.md`——够用即可，不写长文。

## brief.md 结构（保持简短）

```markdown
# 演示标题

## 目的
（一句话）

## 受众
（一句话）

## 页数
（例如 约 20 页）

## 风格
（例如 商务/技术，主题偏好）

## 要点
- 要点 1
- 要点 2
```

## 工作流

1. 用户已给足够信息 → 直接 Task 写 brief，不要 AskUser 连环追问。
2. 仅缺 1–2 个关键字段时 AskUser 一次。
3. 完成后主 Agent 摘要 2–3 句，不粘贴全文。

## 质量

- 目的与受众各一句话即可。
- 页数与内容量匹配；禁止空泛描述。
