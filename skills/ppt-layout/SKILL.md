---
name: ppt-layout
description: 视觉排版执行；按 layout-plan 应用 designSystem/layout
when_to_use: layout-plan 已就绪或用户已确认排版方式，需要 set-design-system 与 update-slide-layout 时
stages:
  - design
  - style
allowed-tools:
  - ReadPresentationSnapshot
  - ListSlides
  - ExecuteLayoutPlan
  - PreviewCommands
  - SubmitCommands
  - SearchExtraTools
  - ExecuteExtraTool
---

# 排版阶段（第二阶段 · Layout Executor）

## 角色定位

本 Skill 有两种模式：

| 模式 | 何时 | 职责 |
|------|------|------|
| **Executor**（默认） | 存在 `slides/layout-plan.json` | **严格按 plan 执行**；优先 `ExecuteLayoutPlan`，不得擅自改 layout |
| **Direct** | 无 layout-plan 的轻量修改 | 基于现有 designSystem 调整单页 layout |

## 设计目标

产出**简洁、可用、可扫读**的演示——结构优于装饰，节奏优于堆料。融合 [guizang-ppt-skill](https://github.com/op7418/guizang-ppt-skill) 与 [reference-templates.md](reference-templates.md)。

## 前置

用户已在 LayoutChoiceCard 选择排版方式。本阶段**只处理视觉层**，不改写要点文案、不调整页数、不重复内容密度约束（15 字 / 3–5 条属于内容阶段）。

**Executor 模式**：以 `slides/layout-plan.json` 为唯一事实源；deck 级 designSystem 与每页 layout / slideVariant / designOverride 以 plan 为准。默认调用 `ExecuteLayoutPlan` 读取、校验并生成 command proposal，不手工重猜 layout。

## 风格选择（动手前）

读 [style-modes.md](style-modes.md)：杂志人文→editorial；数据瑞士/商务→business 或 report；技术发布→technical；流程装饰→creative。

## Executor 模式工作流

1. `ReadPresentationSnapshot` + `ListSlides`
2. 调用 `ExecuteLayoutPlan({ "path": "slides/layout-plan.json" })`
   - 工具内部读取 plan
   - 校验 plan 与 snapshot 页数 / slideId / 顺序一致
   - 执行 `validateLayoutPlan` + `validateLayoutPlanRhythm`
   - 由 `buildLayoutPlanCommands` 生成 `set-design-system` / `update-slide-layout(grammarVariant + designOverride)` / `update-slide-variant`
3. 若 `ExecuteLayoutPlan` 返回 error：修复或重新生成 `slides/layout-plan.json` 后再执行；**禁止**从聊天上下文凭记忆重建 layout
4. `ExecuteLayoutPlan` 已自动编译并本地化 `insert-image`；只对其余 plan.enhancements 逐项 `ExecuteExtraTool`：
   - `beautify-chart` → BeautifyChart
   - `beautify-table` → BeautifyTable
   - `add-decorations` → AddLayoutDecorations（仅 creative）
5. `ValidateDeckLayout` 确认节奏；`LoadSkill deck-review`

轻量编辑缺图时，直接走 Core Tool：`SearchSlideImages(slideId)` → 选择候选 → `InsertSlideImage` → `SubmitCommands`，无需 SearchExtraTools。远程图片默认本地化到 workspace `assets/images/`；若来源页或授权信息缺失，必须保留 warning，不能宣称图片已获得商用授权。

Grammar handler 会把 token 推导出的实际变体写回 `slide.grammarVariant`，PreviewSlide 与 deck-review 应以实际值检查页面差异度。

**Executor 禁止**：擅自改 plan 中的 layout；重新推理版式选择；手写 `set-design-system` / `update-slide-layout` 绕过 `ExecuteLayoutPlan`；改写 text。

## Direct 模式（无 plan 的轻量修改）

1. `ReadPresentationSnapshot` + `ListSlides`
2. 逐页核对 layout 与叙事角色（[layout-catalog.md](layout-catalog.md) + [narrative-arc.md](narrative-arc.md)）
3. 检查节奏：无连续 3 页同 layout；8 页+ 含 section
4. 若 layout 不合理，修正 `update-slide-layout` 参数，**不改 text**
5. 沿用 presentation.designSystem；只有用户明确要求换肤时才提交新的完整 DesignSystemV1

| 场景 | design preset |
|------|---------------|
| 简约商务 / 工作汇报 | business |
| 竞聘 / 正式报告 | report |
| 人文 / 杂志风 | editorial |
| 技术 / 数据发布 | technical |
| 学术 / 研究 | academic |

## 标准排版（template）

1. 一批 `SubmitCommands`：
   - `set-design-system`（完整 DesignSystemV1，通常由 layout-plan 提供）
   - 对**每一页** `update-slide-layout`（layout 取 slide 已有值；缺省 `summary`）
2. **禁止**在画布放 `slide.title`；禁止手动坐标堆叠正文
3. 封面/章节页（cover/section）由 `applyLayout` 自动居中标题区，无需额外 shape
4. 完成后 `LoadSkill deck-review`；对照 [checklist.md](checklist.md) P0/P1

## 创意装饰（creative）

1. `LoadSkill ppt-beautify`
2. 先执行标准排版（set-design-system + 全部 update-slide-layout）
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
| toc | 目录 + 序号圆 | 3–8 |
| quote | 金句居中 | 1–2 |
| image-grid | 2–4 图网格 | 0–4 caption |

> 上表「要点数」是**引擎 layout 容量**（内容阶段参考），非设计阶段改写依据。Executor 以 snapshot 现有元素为准，不强制删改 bullet。

## Deck 结构建议（参考商务模板）

典型 8–15 页轻量 deck：

```
cover → section(可选) → 内容×N → section(可选) → 内容×N → summary
```

- 每大章前插 `section` 作分隔（对应模板「MORE>>>」章节页）
- 7 页+ 商务 deck 第 2 页用 `toc` layout
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
