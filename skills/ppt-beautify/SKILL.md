---
name: ppt-beautify
description: 用 Deferred Tools 做自动排版、文本压缩、图表表格美化与文风改写
when_to_use: 基础 deck 已生成，需要排版优化、精简文案、统一风格或单页润色时
stages:
  - style
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
| 换设计系统 | ApplyDesignSystem | `set-design-system` |
| 风格推荐 | SelectStyleStrategy | 返回 preset + DesignSystemV1（不直接改 deck） |
| 长文精简 | CompressText | 调用模型做事实保持压缩；无法保留数字/日期/链接时会失败 |
| 改写字风 | RewriteSlideContent | 调用模型生成 `update-element`，并校验关键事实 token |
| 图表样式 | BeautifyChart | 美化已有 chart；明确 KPI 文本只强化 metric 样式，不生成数据 |
| 表格样式 | BeautifyTable | P2：`\|` 分隔文本 → table 元素 |
| 搜索页面图片 | SearchSlideImages（Core） | 免费图库优先的候选 + 可直接插入参数 |
| 图片入槽 | InsertSlideImage（Core） | add/update image（自动坐标；远程图默认本地化并保存来源元数据） |
| 字体角色 | ApplyTypography | update-text-style 批量 |
| 单页预览 | PreviewSlide | 结构化摘要 + PNG 缩略图（base64） |
| 版式节奏 | ValidateDeckLayout | 连续 layout / 多样性报告 |
| 页级背景节奏 | UpdateSlideVariant | `update-slide-variant` commands |
| 一致性分析 | AnalyzeDeckConsistency | 报告（不直接改 deck） |

## P2 元素能力

P2 元素能力必须区分“已有数据”和“文本样式”：

- **BeautifyChart**：已有 `chart` → 同步设计系统图表样式；数值文本 → `metric` 样式。只有显式结构化数据才能创建 chart 元素
- **BeautifyTable**：结构化或 `|` 分隔文本 → `table` 元素（headerRow + zebraStripe）
- **icon 元素**：经 `add-element` 添加，`name` 为内置 24 Lucide 兼容图标之一
- **slideVariant**：经 `update-slide-variant` 设置页级 light/dark/hero 节奏

典型命令序列（KPI 页）：

```
BeautifyChart(slideId) → SubmitCommands
update-slide-variant(slideId, hero|light|dark) → SubmitCommands
```

## 工作流

1. `ReadPresentationSnapshot` 定位目标 `slideId` / `elementId`。
2. `SearchExtraTools` 用自然语言查询（如「自动排版」「溢出」），勿猜测工具名。
3. `ExecuteExtraTool` 执行；若返回 `{ commands }`，汇总后 `SubmitCommands`。
4. 若返回分析报告，向用户展示后再决定是否修改。
5. 单页操作优先 `ReadCurrentSlide` + `GetSelection` 确认选中元素。

## 典型场景

**全 deck 换肤**：SelectStyleStrategy → ApplyDesignSystem → SubmitCommands

**单页排版乱了**：AutoLayoutSlide(slideId, layout) → SubmitCommands

**图片放入槽位**：SearchSlideImages(slideId) → InsertSlideImage(候选 insertArgs) → SubmitCommands（无需工具发现、无需 x/y）

**排版后自检**：PreviewSlide(slideId) → ValidateDeckLayout → 修复后 SubmitCommands

**文字太长溢出**：DetectOverflowText（审查）→ CompressText → update-element 命令

**润色不改事实**：AutoLayoutSlide / Beautify*；BeautifyChart 不会从文字生成数值，BeautifyTable 只接受结构化 pipe 表格。**允许改写措辞**：RewriteSlideContent

## 约束

- Deferred Tool **不能替代**基础 `add-slide`；仅用于增强。
- `ExecuteExtraTool` 产出的 commands 仍须 `SubmitCommands`，不会自动生效。
- 改写类工具 `risk` 建议 `medium`；纯排版 `low`。
- 大改前先 LoadSkill `deck-review`，用户确认后再批量修复。
