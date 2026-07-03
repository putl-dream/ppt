---
name: ppt-design
description: 选定主题与配色并 set-theme（可跳过独立 design 文件，直接 SubmitCommands）
when_to_use: 需要确定视觉风格、应用主题时
allowed-tools:
  - ReadPresentationSnapshot
  - SearchExtraTools
  - ExecuteExtraTool
  - SubmitCommands
---

# 设计与主题

## 目标

选定 theme/palette 并 SubmitCommands 提交 `set-theme`。不必写 design 文件，除非用户要求留存设计决策。

## 可用主题与调色板

**主题**：`nordic` `midnight` `ocean` `sunset` `purple`

**调色板**：`cyan` `green` `purple` `orange`

| 场景 | 推荐 |
|------|------|
| 商务 | nordic + cyan |
| 技术 | ocean + cyan |
| 创意 | sunset + orange |

## 工作流

1. 从 brief 或用户描述选 theme/palette；未明确时用 ocean + cyan。
2. 主 Agent 直接 SubmitCommands：

```json
{"id":"cmd-theme","type":"set-theme","theme":"ocean","palette":"cyan"}
```

3. 仅当用户要求记录设计决策时，Task 写 `design/theme.json`。

## 衔接

主题确定后 LoadSkill `ppt-build` 或直接 SubmitCommands 建页。
