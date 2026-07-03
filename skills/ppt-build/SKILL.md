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
3. **内容草稿阶段**不提交 `set-theme`；主题在排版阶段（ppt-layout）设置。

## 画布与约束

- 画布：**1280 × 720**，安全边距 **40px**（元素需在安全区内）。
- `slide.title` 由 UI 渲染在页眉；画布上只放正文元素；**禁止** fontSize≥36 的画布文本。
- 布局枚举：`cover` `section` `concept` `comparison` `process` `architecture` `case` `summary`。
- 元素类型：`text` | `image` | `shape`（`rectangle` `circle` `arrow` `line`）。

## 两阶段职责

| 阶段 | 本 Skill 角色 |
|------|--------------|
| 内容草稿 | 只 add-slide + text elements + layout 字段；**不** update-slide-layout |
| 视觉排版 | set-theme + 全部 update-slide-layout（用户选完排版方式后） |

## 推荐命令序列

**内容草稿（第一阶段）**

```json
[
  {"id":"cmd-1","type":"add-slide","index":0,"slide":{"id":"slide-1","title":"页面标题","layout":"concept","elements":[
    {"id":"el-1","type":"text","x":0,"y":0,"width":100,"height":40,"text":"要点一","fontSize":20}
  ]}}
]
```

**视觉排版（第二阶段，用户确认后）**

```json
[
  {"id":"cmd-theme","type":"set-theme","theme":"ocean","palette":"cyan"},
  {"id":"cmd-layout","type":"update-slide-layout","slideId":"slide-1","layout":"concept"}
]
```

- 内容草稿：仅 `add-slide`（设 layout 字段 + 独立 text elements）。
- 视觉排版：`set-theme` → 全部 `update-slide-layout`。

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

1. 从 storyboard 映射 slide.id（与 storyboard id 一致）。
2. **内容草稿**：一次 SubmitCommands 提交全部 add-slide（含 layout 字段），**不含** update-slide-layout。
3. message 告知「内容草稿已就绪，请选择排版方式」。
4. **视觉排版**（用户确认后，LoadSkill `ppt-layout`）：set-theme + 全部 update-slide-layout。
5. PreviewCommands 自检；修正后 SubmitCommands。

## 禁止

- 不凭记忆编造 ID；改已有页先 ReadPresentationSnapshot。
- 基础创建不用 Deferred Tool。
- **内容草稿阶段禁止 update-slide-layout**（排版由 ppt-layout 第二阶段完成）。

## 衔接

构建后可选 LoadSkill `deck-review` 质检，或 `ppt-beautify` 增强。
