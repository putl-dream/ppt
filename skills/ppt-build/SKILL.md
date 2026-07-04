---
name: ppt-build
description: 根据 storyboard 用 SubmitCommands 创建内容草稿（不含主题与排版命令）
when_to_use: 需要把分镜或用户内容落成幻灯片内容草稿时
stages:
  - author
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
4. 落盘时沿用 storyboard 的 `layout`（或 `narrativeRole` 推导值）作为 `slide.layout` 占位。

## 画布与结构

- 画布：**1280 × 720**，安全边距 **40px**。
- `slide.title` 由 UI 渲染在页眉；画布上只放正文元素；**禁止** fontSize≥36 的画布文本。
- 布局枚举（仅 slide.layout 字段占位）：`cover` `section` `concept` `comparison` `process` `architecture` `case` `summary`。
- 元素类型：`text` | `image` | `shape`。

## 内容撰写原则

- **先写全、写清楚**：要点可完整表达，不强行压字数或条数。
- 每条要点一个独立 `text` element。
- 标题只用 `slide.title`，不要在画布重复大标题。

## 版式容量（按此组织内容，获得最佳观感）

引擎排版时**不再丢弃**超量内容：超出的要点会折叠进最近的格子、过长文本会自动缩小字号。但缩字/折叠会降低观感，所以内容应尽量贴合每种 layout 的自然容量：

| layout | 自然容量 | 超出时引擎行为 |
|--------|----------|----------------|
| `cover` | 标题 + 0–1 条副标题 | 多余并入副标题 |
| `case` | 第 1 条叙述 + 第 2 条数字（或 1 张图） | 第 3 条起折叠进叙述栏 |
| `process` / `architecture` | 2–4 步/层 | 列/行变窄 + 缩字，不截断 |
| `comparison` | 偶数条（左右成对） | 缩字 |
| `quote` | 金句 + 可选署名 | 多余并入金句 |
| `toc` | 3–8 项 | 行高压缩 + 缩字 |
| `concept` | 3–4 条并列 | 卡片变窄 + 缩字 |
| `summary` | 3–5 条 | 缩字 |

**超出自然容量时**：优先拆成多页（如 6 个步骤拆成 2 页 process），而非堆在一页靠引擎缩字兜底。

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

用户选择排版方式后进入 design / style；届时再精简文案与定主题版式。
