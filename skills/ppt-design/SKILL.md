---
name: ppt-design
description: 选定演示主题与配色，维护 design 约束，驱动 set-theme 与视觉一致性
when_to_use: 需要确定视觉风格、应用主题、或 deck 风格与 brief 不符时
allowed-tools:
  - ReadPresentationSnapshot
  - SearchExtraTools
  - ExecuteExtraTool
  - SubmitCommands
---

# 设计与主题

## 目标

根据 `brief.md` 风格约束选定 theme/palette，写入 workspace 设计文件，并提交 `set-theme`。

## 可用主题与调色板

**主题**（`layout.ts` 内置）：`nordic` `midnight` `ocean` `sunset` `purple`

**调色板**：`cyan` `green` `purple` `orange`

| 场景 | 推荐组合 |
|------|---------|
| 商务/高管 | nordic + cyan |
| 技术/产品 | ocean + cyan 或 midnight + cyan |
| 创意/品牌 | sunset + orange 或 purple + purple |
| 深色舞台 | midnight / ocean + cyan |

## design/theme.json（Task 写入）

```json
{
  "theme": "ocean",
  "palette": "cyan",
  "rationale": "技术受众，深色背景突出数据",
  "fontStack": "Outfit, Inter, sans-serif"
}
```

## design/constraints.json（可选，Task 写入）

沿用项目默认：`titleMinFontSize: 36`，`bodyMaxFontSize: 32`，`safeMarginPx: 40`，`maxElementsPerSlide: 12`。

## 工作流

1. Task 读取 `brief.md`「风格与约束」。
2. 若 brief 未明确，可用 `SearchExtraTools` → `SelectStyleStrategy`（传入受众与核心信息）获取推荐。
3. Task 写 `design/theme.json`。
4. 主 Agent `SubmitCommands` 提交：

```json
{"id":"cmd-theme","type":"set-theme","theme":"ocean","palette":"cyan"}
```

5. 或对已有 deck：`ExecuteExtraTool` `ApplyThemeStyle` 获取 commands，再 `SubmitCommands`。

## 质量检查

- theme/palette 组合须在上述枚举内，否则布局配色会回退默认。
- 应用主题后 `ReadPresentationSnapshot` 确认 `presentation.theme` 已更新。
- 同一 deck 内不混用多套主题。

## 衔接

主题确定后 LoadSkill `ppt-build` 批量建页；美化阶段见 `ppt-beautify`。
