---
name: deck-review
description: 审查 deck 一致性、版式节奏与 guizang 式质检项；对照 design-principles Rubric A–E
when_to_use: deck 已有较多页面，排版后质检、用户要求审阅、或 layout-plan 执行后验收时
stages:
  - style
  - export
---

# Deck 审查

## 目标

结合 ReadPresentationSnapshot / ListSlides 与 Deferred Tools，对照 **design-principles Rubric A–E** 输出结构化审查报告。

## 检查项

### 自动化（Deferred Tools）

1. **版式节奏**：ValidateDeckLayout（连续 layout / 多样性 / cover-section-summary）
2. **单页缩略图**：PreviewSlide（返回 640×360 PNG base64 + 结构化摘要）
3. **标题重复**：DetectRepeatedTitles
3. **文本溢出**：DetectOverflowText
4. **deck 一致性**：AnalyzeDeckConsistency

### Rubric A · 叙事与节奏

| # | 检查 | 标准 |
|---|------|------|
| A1 | cover + summary | 完整 deck 首尾齐全 |
| A2 | section | 8 页+ 至少 1 个 section |
| A3 | 无连续 3 页同 layout | ValidateDeckLayout error=0 |
| A4 | layout 多样性 | 7 页+ ≥3 种；10 页+ ≥5 种 |
| A5 | slideVariant | 5 页+ deck 至少 2 种 variant |

### Rubric B · 版式匹配（手动对照 layout-catalog）

- 目录页用 toc；步骤用 process；KPI 用 case；对比用 comparison
- 7 页+ 商务 deck 含 toc

### Rubric C · 视觉层级

- 含 KPI/案例的 deck 至少 1 页 case 或 chart 元素
- comparison 偶数条，左右列均非空
- case 恰好 2 条 body
- 画布无 fontSize≥36 重复标题

### Rubric D · 克制

- 全 deck 同一 theme/palette
- 单条 ≤15 字，单页 ≤5 条（**deck-review 检已有内容**；设计阶段 ppt-design-layout 不管）
- creative 装饰每页 shape ≤3

### Rubric E · 反模式

| 反模式 | 严重度 |
|--------|--------|
| 连续 concept 趋势页 | 严重 |
| 无 toc（7 页+） | 建议 |
| 案例页无 KPI/chart | 建议 |
| 全程同色同构（无 slideVariant 变化） | 建议 |

### P2 元素类型（引擎）

- chart 元素：bar / h-bar / timeline / kpi-tower 数据绑定正确
- table 元素：headerRow + 斑马纹
- icon 元素：name 在内置 24 图标内

### layout-plan 对照（Executor 模式）

若存在 `slides/layout-plan.json`：

1. 每页实际 layout 与 plan 一致
2. slideVariant 与 plan 一致
3. plan.enhancements 已执行（chart/image 可见）

## 工作流

1. ReadPresentationSnapshot 获取全貌。
2. ExecuteExtraTool ValidateDeckLayout。
3. 对照 design-principles Rubric A–E 与 checklist P0/P1/P2-engine。
4. 输出 Markdown 报告。
5. 用户确认后再 SubmitCommands 修复。

## 输出格式

```markdown
## 审查摘要
- 总页数：N
- Rubric 通过：A✓ B✓ C△ D✓
- 严重：X 项 | 建议：Y 项

## 严重问题
1. ...

## 建议
1. ...

## 通过项
- ...
```
