# Visual Expression System

> 文档类型：现行架构与剩余边界
> 最后核对：2026-08-01
> 模板上传、内容自动选择与默认回退方案见
> [Presentation 模板管理与自动选择](../roadmap/template-management.md)
> （Proposed；零依赖 Grammar；对齐 SVG-native design-spec）

## 1. 系统定位

产品 Agent **作者路径**仅为完整页面 SVG。Layout Grammar / element-IR 共享库与
相关作者工具均已**移除**（见 `tests/svg-native-tool-surface.test.ts`）。产品新建只写入
`visualSource.kind === "svg"` 的 Presentation，供 Editor / HTML / PPTX 使用。

```text
产品作者（Agent SVG-native）:
  design-spec + page-plan
    → slides/svg/PNN.svg
    → PreviewSvgPage / SubmitSvgDeck
    → Presentation（visualSource.kind = "svg"）
```

## 2. 已形成的能力层

| 层 | 当前能力 |
|---|---|
| SVG page source | 完整页面 SVG（1280×720）；`visualSource.kind === "svg"`；预览 PNG 门禁 |
| Design System | DesignSystemV2：颜色、字体、密度、背景、图片和图表默认值 |
| Brand Profile | 稳定视觉人格到 DesignSystem 的确定性映射 |
| Visual Tokens | spacing、radii、elevation、motif |
| Rendering | Editor、HTML/contact sheet、PPTX 共用 SVG-native Presentation |
| Evaluation | SVG 预览校验；deck 结构与 designSystem 一致性评分 |

当前实现位于 `src/design-system/`、`src/shared/visual-*`、
`src/main/agent/tools/core/preview-svg-page.ts`、`src/main/agent/tools/core/submit-svg-deck.ts`。

## 3. 核心契约

### DesignSystemV2

定义 deck 级视觉语气（`designSystemV2Schema`）。Renderer 不应分别解释旧 theme/palette 和新 token；所有路径先解析为统一结果。SVG-native 提交时，`SubmitSvgDeck` 要求 `designSystem` 与 `design/design-spec.json` 锁一致。

### SVG visualSource

当 slide 带有 `visualSource.kind === "svg"` 时，该页的视觉作者源是对应 SVG 文件。
可见修改必须改 SVG 并重新预览，不能只改 page-plan 期待自动重绘。

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
- layout slot 与宽高比适配；SVG 路径用显式 `href`。

SVG-native 路径要求图片以 workspace 相对 `href` 写入 SVG；`SubmitSvgDeck` 内联同一字节。禁止远程 URL。

声明依赖图片的设计若没有有效素材，应质量失败或更换不依赖图片的设计，不能留下空框。

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

### Layout Grammar / element-IR（已移除）

Layout Grammar 共享库、element-IR slide 模型与 Grammar / 命令轨作者工具均已从产品中移除。
Presentation slide 现为 STRICT SVG-only（`visualSource` 必填；无 `elements` / `layout` /
`grammarVariant`）。遗留文档中的 handler / variant / slot 语义不再适用。

## 8. Render Feedback

反馈分两层：

1. 结构化 deterministic checks：overflow、重叠、资产缺失、节奏、token 一致性；SVG 路径另含 PreviewSvgPage PNG 门禁。
2. 有界视觉复盘：仅在成功渲染 PNG 时，最多审查有限页面和有限字段。

视觉模型不能无限返工，也不能修改事实、数字、来源、页序和商业目标。

## 9. 当前剩余工作

- 默认 project artifact / workspace probe 与 SVG-native 作者文件对齐；
- captioned image 建立独立内容模型；
- deck-review 增强母题、锚点、密度和页面差异度；
- 从内容自动推导 Brand Profile，并允许用户自然语言调节。

### Grammar / element-IR 清理（已完成）

Layout Grammar / element-IR 共享库、element-IR 渲染与导出分支，以及 Grammar / 命令轨
Agent 作者工具均已移除。默认注册表与 Deferred 发现面为空
（`tests/svg-native-tool-surface.test.ts`）。

[template-management](../roadmap/template-management.md)（Proposed）与 Grammar 零耦合：
内置模板只锁定 Design System 与 SVG 作者指引。

剩余项集中维护在本文件和 [工作流](./workflow.md)，不再保留多个视觉建设 plan。

## 10. 关键实现

- `src/design-system/`
- `src/shared/presentation.ts`（`designSystemV2Schema`、`visualSource`）
- `src/main/agent/tools/core/preview-svg-page.ts`
- `src/main/agent/tools/core/submit-svg-deck.ts`
- `src/main/agent/tools/tool-registry.ts`（默认注册表不含 Grammar 作者工具）
- `src/shared/visual-tokens.ts`
- `src/shared/visual-asset-audit.ts`
- `src/shared/shape-render-utils.ts`
- `src/shared/gradient-export.ts`
- `src/main/ppt-exporter.ts`

## 11. 验收

- 新建路径可仅凭 SVG 作者文件完成预览与提交。
- 默认工具注册表不含 Grammar/命令轨作者工具；Deferred 发现面为空。
- 缩略图可区分页面角色和整套节奏。
- 同一 deck 的母题稳定，但页面不成为重复卡片墙。
- Editor、HTML 和 PPTX 的结构语义一致。
- 对 SVG 页，视觉修改必须改 SVG 源并重新 Preview；不能只改派生元素树。
