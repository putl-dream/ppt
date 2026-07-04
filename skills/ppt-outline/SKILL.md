---
name: ppt-outline
description: 根据 brief 起草 outline.md，含叙事弧章节骨架（完整路径时使用）
when_to_use: brief 已就绪、大型新建需要结构化大纲时
stages:
  - planning
  - content
---

# PPT Outline 大纲

## 目标

Task 子 Agent 创建精简 `outline.md`，为 storyboard 提供带叙事弧的章节骨架。

## 叙事弧（guizang 适配）

```
钩子 Hook     → 1 页
定调 Context  → 1–2 页
主体 Core     → 按 brief 页数分配
转折 Shift    → 1 页（可选）
收束 Takeaway → 1–2 页
```

详细叙事结构见 brief 中的页数分配；版式节奏在排版设计阶段再定。

## outline.md 结构

```markdown
# [演示标题]

## 叙事弧
- Hook: …
- Context: …
- Core: …
- Takeaway: …

## 章节

### 1. [章节名]（N 页 · section?）
- 要点 1
- （可选）内容形态：并列 / 对比 / 流程

### 2. [章节名]（N 页）
...
```

## 工作流

1. Task 读取 `brief.md`（需求已清晰且无 brief 时，可内联推断）。
2. 按 brief 时长→页数拆章节；顺序：Hook → Context → Core → Shift → Takeaway。
3. 每章标注是否需 `section` 分隔页。
4. 写回 `outline.md`。
5. 主 Agent 摘要：章节数、总页数、1 处待确认项（若有）。

## 质量

- 每章至少 1 个要点；禁止空章节。
- Core 段章节类型应多样（不全同一形态）。
- 要点可完整表达，不必压字数。

## 衔接

完成后 LoadSkill `ppt-storyboard`。
