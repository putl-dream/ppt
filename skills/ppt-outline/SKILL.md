---
name: ppt-outline
description: 根据 brief 起草 outline.md 章节骨架（仅完整路径时使用）
when_to_use: brief 已就绪、大型新建需要结构化大纲时
---

# PPT Outline 大纲

## 目标

Task 子 Agent 创建精简 `outline.md`，为 storyboard 提供章节骨架。

## outline.md 结构

```markdown
# [演示标题]

## 章节

### 1. [章节名]（N 页）
- 要点 1
- 要点 2

### 2. [章节名]（N 页）
...
```

## 工作流

1. Task 读取 `brief.md`（若不存在且需求已清晰，可跳过 brief 直接写 outline）。
2. 按 brief 页数拆章节；顺序：钩子 → 背景 → 方案 → 总结。
3. 写回 `outline.md`。
4. 主 Agent 摘要：章节数、总页数。

## 质量

- 每章至少 1 个要点；禁止空章节。
- 不写「所需素材」长表；缺素材在要点旁标注「待补」即可。

## 衔接

完成后 LoadSkill `ppt-storyboard`。
