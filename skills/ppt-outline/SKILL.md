---
name: ppt-outline
description: 根据 brief 起草 outline.md 内容大纲，划分章节与叙事顺序
when_to_use: brief 已就绪、需要结构化内容大纲、或 workspace 尚无 outline.md 时
---

# PPT Outline 大纲

## 目标

通过 Task 子 Agent 在 workspace 根目录创建或更新 `outline.md`，为 storyboard 提供章节骨架。

## outline.md 结构

```markdown
# [演示标题]

## 叙事弧线
（一句话：这场演示如何从开始推到结论）

## 章节

### 1. [章节名]
- 核心信息：
- 建议页数：N
- 要点：
  - ...
- 所需素材：（数据/图/案例，无则写「无」）

### 2. [章节名]
...
```

## 工作流

1. Task 读取 `brief.md`；若不存在，先 LoadSkill `ppt-brief` 并委派起草。
2. 按 brief 的「目的 / 受众 / 时长与页数」拆章节，总建议页数与 brief 一致（±10%）。
3. 章节顺序遵循：钩子 → 问题/背景 → 方案/论证 → 案例/证据 → 总结/行动。
4. 写回 `outline.md`。
5. 主 Agent 摘要：章节数、总建议页数、与 brief 的对齐点。

## 质量检查

- 每章至少 1 个可落地的要点，禁止空章节。
- 「建议页数」之和应接近 brief 中的页数目标。
- 明确标注需用户补充的数据或素材，写入章节「所需素材」。

## 衔接

outline 完成后，下一步 LoadSkill `ppt-storyboard` 生成分镜。
