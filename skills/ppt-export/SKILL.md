---
name: ppt-export
description: 校验已提交 SVG-native deck 的每页 visualSource 与 hash，并从同一视觉来源导出 PPTX
when_to_use: 用户要求导出、下载或生成最终 pptx 文件，且 SVG 页面已经提交时
stages:
  - export
  - style
allowed-tools:
  - ListSlides
  - PreviewSvgPage
  - SearchExtraTools
  - ExecuteExtraTool
---

# 导出 SVG-native PPTX

## 目标

通过 `ExportPptx` 从已提交的完整 SVG 页面导出 PPTX。导出必须消费与预览/提交相同的 visual source；不得把 deck 转回 element IR，也不得在导出时追加标题、页码、背景或 layout chrome。

## 前置检查

1. 用 `ListSlides` 取得已提交 deck 的完整有序页面清单。
2. 对每页确认：
   - `svgSourcePath` 与 `svgSha256` 存在，表示该页拥有已提交 SVG visual source；
   - 页面顺序与 `slides/page-plan.json` 一致；
   - 没有占位页或重复 `svgSourcePath`。
3. 对每个 `svgSourcePath` 调用 `PreviewSvgPage`；其返回的 `sha256` 必须等于 `ListSlides.svgSha256`。不一致表示 workspace 作者源尚未重新提交，应停止导出。
4. 应用 `deck-review` 完成最终视觉审查；存在严重错误、来源漂移或未提交修改时先停止导出。

## 工作流

1. 用 `SearchExtraTools` 精确发现 `ExportPptx`，再用 `ExecuteExtraTool` 调用它并设置 `format: "pptx"`。不要选择其他导出器。
2. 若工具再次报告 source/hash 不一致，回到 SVG 编辑/提交流程；不要绕过校验或改走旧导出器。
3. 成功后向用户报告工具返回的 `filePath`、`slideCount`，以及它实际提供的 revision/hash receipt（若有）。

## 约束

- 导出是只读交付动作，不修改 SVG 作者源或 deck revision。
- SVG 中显式引用的 workspace 相对图片必须由提交流程内联；导出阶段不重新下载远程资源。
- 不允许 ExportPptx 发明 fallback 页面或静默省略不支持对象；校验失败即阻断交付。
- 不导出空 deck、占位页或 source/hash 不完整的 deck。
- 本技能只负责 PPTX；其他格式需要独立、明确的导出能力。

## 衔接

标准链路：brief → design spec → page plan → SVG pages → `SubmitSvgDeck` → deck-review → 本技能。
