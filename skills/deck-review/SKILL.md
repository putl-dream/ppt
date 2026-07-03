---
name: deck-review
description: 审查现有幻灯片的一致性、重复标题与文本溢出风险
when_to_use:  deck 已有较多页面，用户要求审阅、润色前质检、或提交前自检时
---

# Deck 审查

## 目标

结合 ReadPresentationSnapshot / ListSlides 与可选 Deferred Tools，输出结构化审查报告。

## 检查项

1. **标题重复**：DetectRepeatedTitles（若已通过 SearchExtraTools 发现）
2. **文本溢出**：DetectOverflowText
3. ** deck 一致性**：AnalyzeDeckConsistency
4. **手动检查**：封面/章节页是否成对、summary 是否呼应开头

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
