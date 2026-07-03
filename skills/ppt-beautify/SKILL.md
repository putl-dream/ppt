---
name: ppt-beautify
description: 用 Deferred Tools 做自动排版、文本压缩、图表表格美化与文风改写
when_to_use: 基础 deck 已生成，需要排版优化、精简文案、统一风格或单页润色时
allowed-tools:
  - ReadPresentationSnapshot
  - ReadCurrentSlide
  - GetSelection
  - SearchExtraTools
  - ExecuteExtraTool
  - SubmitCommands
---

# 美化与增强

## 目标

在**不重建 deck** 的前提下，用 Deferred Tools 生成 commands 或建议，经 `SubmitCommands` 应用。

## 工具选型

| 需求 | Deferred Tool | 产出 |
|------|--------------|------|
| 单页重排版 | AutoLayoutSlide | `update-slide-layout` |
| 换主题 | ApplyThemeStyle | `set-theme` |
| 风格推荐 | SelectStyleStrategy | 建议 theme/palette（不直接改 deck） |
| 长文精简 | CompressText | 压缩后文本（需再 update-element） |
| 改写字风 | RewriteSlideContent | `update-element` |
| 图表样式 | BeautifyChart | commands |
| 表格样式 | BeautifyTable | commands |
| 一致性分析 | AnalyzeDeckConsistency | 报告（不直接改 deck） |

## 工作流

1. `ReadPresentationSnapshot` 定位目标 `slideId` / `elementId`。
2. `SearchExtraTools` 用自然语言查询（如「自动排版」「溢出」），勿猜测工具名。
3. `ExecuteExtraTool` 执行；若返回 `{ commands }`，汇总后 `SubmitCommands`。
4. 若返回分析报告，向用户展示后再决定是否修改。
5. 单页操作优先 `ReadCurrentSlide` + `GetSelection` 确认选中元素。

## 典型场景

**全 deck 换肤**：SelectStyleStrategy → ApplyThemeStyle → SubmitCommands

**单页排版乱了**：AutoLayoutSlide(slideId, layout) → SubmitCommands

**文字太长溢出**：DetectOverflowText（审查）→ CompressText → update-element 命令

**润色不改事实**：AutoLayoutSlide / Beautify*；**允许改写措辞**：RewriteSlideContent

## 约束

- Deferred Tool **不能替代**基础 `add-slide`；仅用于增强。
- `ExecuteExtraTool` 产出的 commands 仍须 `SubmitCommands`，不会自动生效。
- 改写类工具 `risk` 建议 `medium`；纯排版 `low`。
- 大改前先 LoadSkill `deck-review`，用户确认后再批量修复。
