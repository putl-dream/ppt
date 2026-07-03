---
name: ppt-storyboard
description: 根据 outline 生成 slides/storyboard.json 逐页分镜
when_to_use: brief 与 outline 已就绪，需要规划每页标题、布局与要点时
---

# Storyboard 分镜

## 目标

通过 Task 子 Agent 读写 `slides/storyboard.json`，输出可驱动 SubmitCommands 的分镜计划。

## storyboard.json 结构

```json
{
  "slides": [
    {
      "id": "slide-cover",
      "title": "封面标题",
      "layout": "cover",
      "intent": "建立主题与演讲者身份",
      "bulletPoints": ["副标题一行"],
      "notes": "开场 30 秒"
    }
  ]
}
```

## 布局取值

cover、section、concept、comparison、process、architecture、case、summary

## 工作流

1. Task 读取 `brief.md`、`outline.md`（若存在）。
2. 按 outline 章节映射为 section 页 + 内容页。
3. 每页 `intent` 说明该页叙事作用，避免重复标题。
4. 写回 `slides/storyboard.json`。
5. 主 Agent 摘要：总页数、章节结构、需用户确认的 1–2 处。

## 约束

- 单页 bullet 不超过 5 条，每条不超过 15 字（中文）。
- 复杂对比用 comparison，流程用 process，不要全部 concept。
