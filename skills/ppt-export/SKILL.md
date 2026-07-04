---
name: ppt-export
description: 将完成的演示导出为 PPTX 文件，导出前做最终质检
when_to_use: 用户要求导出、下载、生成 pptx 文件，或演示定稿交付时
stages:
  - export
  - style
allowed-tools:
  - ReadPresentationSnapshot
  - SearchExtraTools
  - ExecuteExtraTool
---

# 导出 PPTX / HTML

## 目标

在 deck 定稿后通过 `ExportPptx` 导出外部文件；导出前确保内容与主题就绪。

## 前置检查

1. `ReadPresentationSnapshot`：slides 非空、title 已设、theme 已应用。
2. 可选 LoadSkill `deck-review`，严重问题为 0 再导出。
3. 向用户确认导出格式：**pptx**（默认）或 **html**（网页预览）；pdf 尚未实现。

## 工作流

1. `SearchExtraTools` 查询「导出」→ `ExecuteExtraTool` `ExportPptx`：

```json
{"format": "pptx"}
```

或 HTML：

```json
{"format": "html"}
```

2. 将返回的 `filePath`、`revision` 告知用户。
3. Task 可选更新 `history/exports.json` 记录本次导出。

## 约束

- 导出**不修改** presentation revision；是只读副作用（写磁盘文件）。
- 若 slides 为空或仅占位页，先 AskUser 是否继续。
- 导出失败时检查 theme 是否为有效枚举值。

## 衔接

导出前链路：brief → outline → storyboard → ppt-build → deck-review → 本 skill。
