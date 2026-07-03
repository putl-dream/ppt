---
name: ppt-storyboard
description: 根据 outline 生成 slides/storyboard.json 逐页分镜
when_to_use: outline 已就绪，完整路径中需要规划每页布局时
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
      "layout": "cover",
      "bulletPoints": ["副标题一行"]
    }
  ]
}
```

## 布局

cover、section、concept、comparison、process、architecture、case、summary

## 工作流

1. Task 读取 `outline.md`（或 brief，若 outline 不存在）。
2. 按章节映射为 section 页 + 内容页。
3. 写回 `slides/storyboard.json`。
4. 主 Agent 摘要：总页数 + 1 处需确认项（若有）。

## 约束

- 单页 bullet ≤5 条，每条 ≤15 字。
- 不写 intent/notes 长段；layout 选对即可。
- 复杂对比用 comparison，流程用 process。
