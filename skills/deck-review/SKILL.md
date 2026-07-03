---
name: deck-review
description: 审查 deck 一致性、版式节奏与 guizang 式质检项（重复标题、溢出、layout 多样性）
when_to_use: deck 已有较多页面，排版后质检、用户要求审阅、或提交前自检时
---

# Deck 审查

## 目标

结合 ReadPresentationSnapshot / ListSlides 与可选 Deferred Tools，输出结构化审查报告。

## 检查项

1. **标题重复**：DetectRepeatedTitles（若已通过 SearchExtraTools 发现）
2. **文本溢出**：DetectOverflowText
3. **deck 一致性**：AnalyzeDeckConsistency
4. **版式匹配**（手动）：每页 layout 是否与内容任务一致（见 `ppt-layout` layout-catalog）
5. **结构节奏**（手动）：是否有 cover；大章前是否有 section；收尾是否有 summary
6. **comparison 列**：偶数条 body text，左右列均非空
7. **case 页**：恰好 2 条 body（叙述 + 数字/结论）
8. **layout 多样性**（guizang）：10 页+ ≥5 种 layout；无连续 3 页同 layout
9. **title/kicker 重复**：slide.title 与首条 body 语义不重复
10. **完整清单**：对照 `ppt-layout/checklist.md` P0–P2

## 工作流

1. ReadPresentationSnapshot 获取全貌。
2. 若需增强工具，SearchExtraTools 后 ExecuteExtraTool。
3. 输出 Markdown 报告：
   - 严重问题（必须改）
   - 建议改进（可选）
   - 通过项
4. 用户确认后再 SubmitCommands 修复，不要静默大改。

## 输出格式

```markdown
## 审查摘要
- 总页数：N
- 严重：X 项 | 建议：Y 项

## 严重问题
1. ...

## 建议
1. ...
```
