---
name: ppt-build
description: 根据 storyboard 用 SubmitCommands 创建内容草稿（不含主题与排版命令）
when_to_use: 需要把分镜或用户内容落成幻灯片内容草稿时
stages:
  - content
allowed-tools:
  - ReadPresentationSnapshot
  - ListSlides
  - PreviewCommands
  - SubmitCommands
---

# Deck 构建 — 内容草稿阶段

## 目标

将 storyboard 或用户给定内容转为 **内容草稿** PresentationCommand，经 `PreviewCommands` 自检后 `SubmitCommands` 提交。

## 前置

1. `ReadPresentationSnapshot` 了解当前 revision、已有 slide ID。
2. Task 读取 `slides/storyboard.json`（若有）。
3. **本阶段不提交** `set-theme`、`update-slide-layout`。

## 画布与结构

- 画布：**1280 × 720**，安全边距 **40px**。
- `slide.title` 由 UI 渲染在页眉；画布上只放正文元素；**禁止** fontSize≥36 的画布文本。
- 布局枚举（仅 slide.layout 字段占位）：`cover` `section` `concept` `comparison` `process` `architecture` `case` `summary`。
- 元素类型：`text` | `image` | `shape`。

## 内容撰写原则

- **先写全、写清楚**：要点可完整表达，不强行压字数或条数。
- 每条要点一个独立 `text` element。
- 标题只用 `slide.title`，不要在画布重复大标题。

## 推荐命令序列

```json
[
  {"id":"cmd-1","type":"add-slide","index":0,"slide":{"id":"slide-1","title":"页面标题","layout":"concept","elements":[
    {"id":"el-1","type":"text","x":0,"y":0,"width":100,"height":40,"text":"完整要点一","fontSize":20}
  ]}}
]
```

- 一次 SubmitCommands 提交全部 add-slide。
- message 告知「内容草稿已就绪，请选择排版方式」。

## 禁止

- 不凭记忆编造 ID；改已有页先 ReadPresentationSnapshot。
- **禁止 update-slide-layout / set-theme**（排版阶段再做）。
- 基础创建不用 Deferred Tool。

## 衔接

用户选择排版方式后进入 layout-design / layout-exec；届时再精简文案与定主题版式。
