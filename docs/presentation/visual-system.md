# Visual Expression System

> 文档类型：现行架构与剩余边界
> 最后核对：2026-07-30
> 模板上传、内容自动选择与默认回退方案见
> [Presentation 模板管理与自动选择](../roadmap/template-management.md)

## 1. 系统定位

产品新建路径以完整页面 SVG 为视觉作者源；Layout Grammar 仍服务于遗留布局编译与可编辑元素路径。两条路径最终都进入同一 Presentation，供 Editor / HTML / PPTX 消费。

```text
SVG-native（产品新建）:
  design-spec + page-plan
    → slides/svg/PNN.svg
    → PreviewSvgPage / SubmitSvgDeck
    → Presentation（visualSource.kind = "svg"）

Layout Grammar（遗留/并行）:
  Brand Profile
    → DesignSystemV2
    → Design Tokens
    → Layout Grammar + Variant
    → Motif / Image / Chart primitives
    → Presentation elements
```

## 2. 已形成的能力层

| 层 | 当前能力 |
|---|---|
| SVG page source | 完整页面 SVG（1280×720）；`visualSource.kind === "svg"`；预览 PNG 门禁 |
| Design System | DesignSystemV2：颜色、字体、密度、背景、图片和图表默认值 |
| Brand Profile | 稳定视觉人格到 DesignSystem 的确定性映射 |
| Layout Registry | cover、section、concept、comparison、process、architecture、case、summary、toc、quote、image-grid（遗留路径） |
| Grammar Handler | 同一 layout 下的多种可执行 variant（遗留路径） |
| Visual Tokens | spacing、radii、elevation、motif |
| Element vocabulary | text、shape、image、chart、table、icon、背景 |
| Rendering | Editor、HTML/contact sheet、PPTX 共用 Presentation |
| Evaluation | SVG 预览校验；layout/style/asset/商业视觉结构评分（后者偏残余 compiler） |

当前实现位于 `src/design-system/`、`src/shared/layout-*`、`src/shared/visual-*`、
`src/main/agent/tools/core/preview-svg-page.ts`、`src/main/agent/tools/core/submit-svg-deck.ts`。

## 3. 核心契约

### DesignSystemV2

定义 deck 级视觉语气（`designSystemV2Schema`）。Renderer 不应分别解释旧 theme/palette 和新 token；所有路径先解析为统一结果。SVG-native 提交时，`SubmitSvgDeck` 要求 `designSystem` 与 `design/design-spec.json` 锁一致。

### SVG visualSource

当 slide 带有 `visualSource.kind === "svg"` 时，该页的视觉作者源是对应 SVG 文件；元素树由提交工具从 SVG/内联素材派生。可见修改必须改 SVG 并重新预览，不能只改 page-plan 期待自动重绘。

### Grammar Variant（遗留）

模型选择：

- layout 语义；
- grammar variant；
- design token override；
- 内容/图片槽。

Handler 决定坐标、层级、默认装饰和可编辑元素。新建整套演示不得依赖此路径。

### Provenance

元素记录 `layout / user / agent / asset` 等来源。重排只清理可安全重建的 layout 生成物，不吞掉用户手工元素。

## 4. 单一渲染事实

Presentation 是三端共同输入：

```text
Presentation
  ├─ PPTMirror
  ├─ HTML / contact sheet
  └─ PPTX exporter
```

新增视觉字段必须同时覆盖三条路径和契约测试。Renderer 只忠实显示，不重新猜测设计意图。

## 5. 图片与素材

图片能力包含：

- 搜索候选和来源页；
- 本地化；
- license/provenance；
- 焦点裁切；
- cover/contain；
- plain/framed/masked 等 treatment；
- layout slot 与宽高比适配。

SVG-native 路径要求图片以 workspace 相对 `href` 写入 SVG；`SubmitSvgDeck` 内联同一字节。禁止远程 URL。

声明 required image 的 Scene/Grammar 若没有有效素材，应质量失败或更换不依赖图片的设计，不能留下空框。

## 6. 图表与可编辑性

优先使用 PowerPoint 原生可编辑图表。复杂视觉不得简单将整页栅格化：

- 文字、关键形状、表格和图表保持原生；
- 背景渐变可栅格化；
- 导出后 postflight 检查 chart parts、notes 和对象数量。

## 7. 模型控制边界

### SVG-native（产品新建）

模型负责写作完整页面 SVG 几何与文案，并遵守画布、自包含与素材路径约束。代码负责：

- PreviewSvgPage 真实渲染与凭据；
- SubmitSvgDeck 锁文件核对、素材内联与 schema 校验；
- CommitGate 与导出。

### Layout Grammar（遗留）

模型应该决定：

- 页面叙事角色；
- layout/variant；
- 品牌方向；
- 图片意图；
- 哪个数据是视觉焦点。

确定性代码应该决定：

- 坐标；
- 字号和 spacing 下限；
- 颜色可读性；
- slot 几何；
- 元素 ID；
- 导出降级；
- overflow 和硬质量门。

在 grammar 路径上，模型不输出任意 `x/y/width/height` 元素树；在 SVG-native 路径上，几何写在 SVG 内，不经 layout handler 填槽。

## 8. Render Feedback

反馈分两层：

1. 结构化 deterministic checks：overflow、重叠、资产缺失、节奏、token 一致性；SVG 路径另含 PreviewSvgPage PNG 门禁。
2. 有界视觉复盘：仅在成功渲染 PNG 时，最多审查有限页面和有限字段。

视觉模型不能无限返工，也不能修改事实、数字、来源、页序和商业目标。

## 9. 当前剩余工作

- 默认 project artifact / workspace probe 与 SVG-native 作者文件对齐；
- layout slot 与 grammar handler 继续收敛（遗留路径）；
- captioned image 建立独立内容模型；
- deck-review 增强母题、锚点、密度和页面差异度；
- 从内容自动推导 Brand Profile，并允许用户自然语言调节；
- 使用真实人工样本验证机器评分相关性（残余 compiler 见质量规范）。

剩余项集中维护在本文件、[工作流](./workflow.md) 和 [质量规范](./quality-rubric.md)，不再保留多个视觉建设 plan。

## 10. 关键实现

- `src/design-system/`
- `src/shared/presentation.ts`（`designSystemV2Schema`、`visualSource`）
- `src/main/agent/tools/core/preview-svg-page.ts`
- `src/main/agent/tools/core/submit-svg-deck.ts`
- `src/shared/layout-grammar.ts`
- `src/shared/layout-grammar-variants.ts`
- `src/shared/layout-handlers/`
- `src/shared/layout-slots.ts`
- `src/shared/visual-tokens.ts`
- `src/shared/visual-asset-audit.ts`
- `src/shared/shape-render-utils.ts`
- `src/shared/gradient-export.ts`
- `src/main/ppt-exporter.ts`

## 11. 验收

- 新建路径可仅凭 SVG 作者文件完成预览与提交。
- 同一内容在遗留 grammar 路径下仍可生成至少三种明显不同的视觉气质。
- 缩略图可区分页面角色和整套节奏。
- 同一 deck 的母题稳定，但页面不成为重复卡片墙。
- Editor、HTML 和 PPTX 的结构语义一致。
- 主要前景对象在 PPTX 中可编辑（在适用元素类型上）。
