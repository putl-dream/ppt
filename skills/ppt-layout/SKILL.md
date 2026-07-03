---
name: ppt-layout
description: 第二阶段视觉排版；融合 guizang 叙事/风格思路，为内容页选 layout、set-theme 与 update-slide-layout，产出简洁可用演示
when_to_use: 用户已确认排版方式（标准排版或创意装饰），需要对内容草稿应用视觉层、选版式、定风格或统一 deck 节奏时
allowed-tools:
  - ReadPresentationSnapshot
  - ListSlides
  - PreviewCommands
  - SubmitCommands
  - SearchExtraTools
  - ExecuteExtraTool
---

# 排版阶段（第二阶段）

## 设计目标

产出**简洁、可用、可扫读**的演示——结构优于装饰，节奏优于堆料。融合 [guizang-ppt-skill](https://github.com/op7418/guizang-ppt-skill) 与 [reference-templates.md](reference-templates.md)。

## 前置

用户已在 LayoutChoiceCard 选择排版方式。本阶段**只处理视觉层**，不改写要点文案。

## 风格选择（动手前）

读 [style-modes.md](style-modes.md)：杂志人文(A)→template+nordic/sunset；数据瑞士(B)→template+ocean/midnight；流程装饰→creative。

## 排版决策（先读后做）

1. `ReadPresentationSnapshot` + `ListSlides`
2. 逐页核对 layout 与叙事角色（[layout-catalog.md](layout-catalog.md) + [narrative-arc.md](narrative-arc.md)）
3. 检查节奏：无连续 3 页同 layout；8 页+ 含 section
4. 若 layout 不合理，修正 `update-slide-layout` 参数，**不改 text**
5. 选 theme/palette（用户已选则沿用；未指定见下表）

| 场景 | theme | palette |
|------|-------|---------|
| 简约商务 / 工作汇报 | ocean | cyan |
| 竞聘 / 正式汇报 | nordic | cyan |
| 人文 / 杂志风 | nordic | cyan |
| 技术 / 数据 / 瑞士风 | ocean | cyan |
| 温暖品牌 | sunset | orange |
| 深色大屏 | midnight | cyan |

## 标准排版（template）

1. 一批 `SubmitCommands`：
   - `set-theme`（theme/palette 按上表或用户选择）
   - 对**每一页** `update-slide-layout`（layout 取 slide 已有值；缺省 `summary`）
2. **禁止**在画布放 `slide.title`；禁止手动坐标堆叠正文
3. 封面/章节页（cover/section）由 `applyLayout` 自动居中标题区，无需额外 shape
4. 完成后 `LoadSkill deck-review`；对照 [checklist.md](checklist.md) P0/P1

## 创意装饰（creative）

1. `LoadSkill ppt-beautify`
2. 先执行标准排版（set-theme + 全部 update-slide-layout）
3. 仅对 `process` / `comparison` 页追加轻量 shape（arrow、accent line、circle 序号），**不**覆盖卡片底色
4. 全 deck 装饰元素 ≤ 每页 3 个；禁止重复 `slide.title`

## 版式与引擎约束（必须遵守）

画布 **1280×720**，内容区 y≈200、h≈430（页眉由 UI 渲染 `slide.title`）。

| layout | 引擎行为 | 要点数 |
|--------|----------|--------|
| cover | 大标题居中 + 可选副标题 | 0–1 副标题 |
| section | 章节分隔，居中标题 | 0–1 引导语 |
| concept | 横排卡片 + 顶 accent 条 | 1–4 |
| comparison | 左右双栏卡片 | 偶数条，左右交替 |
| process | 横排步骤卡 + 箭头 | 2–4 |
| architecture | 纵排层级卡 | 2–4 |
| case | 左叙述卡 + 右数字/结论 | 2 |
| summary | 纵排要点 + 左 accent 竖条 | 3–5 |

单条中文 ≤15 字；单页 bullet ≤5。comparison 至少 2 条且左右列均非空。

## Deck 结构建议（参考商务模板）

典型 8–15 页轻量 deck：

```
cover → section(可选) → 内容×N → section(可选) → 内容×N → summary
```

- 每大章前插 `section` 作分隔（对应模板「MORE>>>」章节页）
- 目录信息放 cover 副标题或第一页 concept，**不**单独做复杂 TOC 页（引擎暂无专用 TOC layout）
- 数据亮点用 `case`（如 76%、89%）；步骤/阶段用 `process`；优劣势用 `comparison`

## 禁止

- 不在本阶段重建内容草稿（不 remove-slide、不改要点 text）
- 不跳过 `update-slide-layout`
- 不用 fontSize≥36 的画布文本充当标题
- 不把多条要点合并进一个 text element

## 衔接

排版完成后客户端展示 DeckPreviewCard。问题修复走 `deck-review`；深度润色走 `ppt-beautify`。

## 延伸阅读

- guizang 风格映射：[style-modes.md](style-modes.md)
- 叙事弧与节奏：[narrative-arc.md](narrative-arc.md)
- 设计原则：[design-principles.md](design-principles.md)
- 质检清单：[checklist.md](checklist.md)
- 本地参考 PPT：[reference-templates.md](reference-templates.md)
- 内容→版式：[layout-catalog.md](layout-catalog.md)
