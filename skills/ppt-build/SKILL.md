---
name: ppt-build
description: 根据 storyboard 用 SubmitCommands 批量创建或更新幻灯片，含版式与元素规范
when_to_use: storyboard 已就绪、需要把分镜落成真实幻灯片、或用户要求生成/重建 deck 时
allowed-tools:
  - ReadPresentationSnapshot
  - ListSlides
  - PreviewCommands
  - SubmitCommands
---

# Deck 构建（SubmitCommands）

## 目标

将 `slides/storyboard.json` 转为 PresentationCommand，经 `PreviewCommands` 自检后 `SubmitCommands` 提交。

## 前置

1. `ReadPresentationSnapshot` 了解当前 revision、已有 slide ID。
2. Task 读取 `slides/storyboard.json`（主 Agent 不直接读 workspace 文件）。
3. 若尚无主题，先提交 `set-theme`（见 ppt-design）。

## 画布与约束

- 画布：**1280 × 720**，安全边距 **40px**（元素需在安全区内）。
- `slide.title` 由 UI 渲染在页眉；画布上只放正文元素。
- 布局枚举：`cover` `section` `concept` `comparison` `process` `architecture` `case` `summary`。
- 元素类型：`text` | `image` | `shape`（`rectangle` `circle` `arrow` `line`）。

## 推荐命令序列（每页）

```json
[
  {"id":"cmd-1","type":"add-slide","index":0,"slide":{"id":"slide-cover","title":"封面","layout":"cover","elements":[
    {"id":"el-sub","type":"text","x":120,"y":380,"width":1040,"height":100,"text":"副标题","fontSize":28,"align":"center"}
  ]}},
  {"id":"cmd-2","type":"update-slide-layout","slideId":"slide-cover","layout":"cover"}
]
```

- 新建页：`add-slide` → `update-slide-layout`（触发自动排版）。
- 已有页改内容：`update-element` / `add-element` / `set-slide-title`。
- 批量创建：**一次 SubmitCommands** 提交全部命令，按 index 从低到高。

## 布局与 body 元素数量

| layout | body 文本建议 | 说明 |
|--------|--------------|------|
| cover / section | 0–1 条副标题 | 标题用 slide.title |
| concept | 1–4 卡片 | 每条一个要点 |
| comparison | 偶数条，左右交替 | 左列 idx 0,2,4… 右列 1,3,5… |
| process | 2–4 步 | 每步一条 |
| architecture | 2–4 层 | 每层一条 |
| case | 描述 + 指标 | 两条：叙述 + 数字/结论 |
| summary | 3–5 条 | 呼应开场 |

单条中文要点 ≤15 字；单页 bullet ≤5 条。

## 工作流

1. 从 storyboard 映射：每页生成唯一 `slide.id`（与 storyboard `id` 一致便于追溯）。
2. 首批：`set-presentation-title` + `set-theme` + 全部 `add-slide` + `update-slide-layout`。
3. 调用 `PreviewCommands`；若有 errors，修正后重试。
4. `SubmitCommands`，`risk` 新建 deck 用 `low`，大批量覆盖用 `medium`。
5. 摘要：新建页数、主题、需用户确认的占位图/数据。

## 禁止

- 不凭记忆编造 slide/element ID；改已有页必须先 `ReadPresentationSnapshot`。
- 不在未 Preview 的情况下一次提交超过 15 条命令（分批提交）。
- 不用 Deferred Tool 做基础创建；`add-slide` 等 Core 命令即可。

## 衔接

构建后可选 LoadSkill `deck-review` 质检，或 `ppt-beautify` 增强。
