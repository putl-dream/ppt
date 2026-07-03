---
name: ppt-brief
description: 起草 brief.md，含 guizang 式需求澄清（风格/受众/时长/素材），明确目的与页数（大型新建时使用）
when_to_use: 大型新建（>10 页）且 workspace 尚无 brief.md，或用户只给模糊主题需对齐方向时
---

# PPT Brief 起草

## 目标

Task 子 Agent 创建精简的 `brief.md`。信息已足则直接写；仅缺关键项时 AskUser **一次**（最多 1–3 问）。

## 需求澄清（guizang 适配 · 动手前）

用户只给主题或模糊想法时，优先对齐以下项（已明确则跳过）：

| # | 字段 | 为什么要问 |
|---|------|------------|
| 1 | **风格基调** | 杂志人文(A) vs 数据瑞士(B) → 见 `ppt-layout/style-modes.md` |
| 2 | **受众与场景** | 内部分享 / 竞聘 / 发布 / demo |
| 3 | **分享时长** | 15min≈10页 · 30min≈20页 · 45min≈25–30页 |
| 4 | **原始素材** | 文档/数据/旧稿/链接 |
| 5 | **图片计划** | 有无截图；后期 add-element 或占位 |
| 6 | **主题色** | nordic/ocean/sunset/midnight（一套 deck 不换） |
| 7 | **硬约束** | 必含数据 / 禁出现内容 |

风格快速推荐：人文故事→A+nordic；KPI/技术→B+ocean；不指定→ocean+cyan。

## brief.md 结构（保持简短）

```markdown
# 演示标题

## 目的
（一句话）

## 受众
（一句话）

## 时长与页数
（例如 30 分钟 · 约 20 页）

## 风格
（杂志风 A / 瑞士数据风 B · theme 偏好）

## 素材
（有/无 · 简述）

## 要点
- 要点 1
- 要点 2
```

## 工作流

1. 用户已给完整大纲 → 可跳过 brief，直接 outline/storyboard。
2. 缺 1–2 项 → AskUser 一次；不要连环追问。
3. 完成后主 Agent 摘要 2–3 句，不粘贴全文。

## 质量

- 目的与受众各一句话。
- 页数与时长匹配 narrative-arc 表。
- 禁止空泛「高端大气」类描述。

## 衔接

完成后 LoadSkill `ppt-outline`。
