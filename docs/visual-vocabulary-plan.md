# 视觉词汇扩展 + 内置模板重做计划

> 版本：2026-07-05
> 状态：待评审
> 目标：把成品从「排版了」提升到「有设计感」，且不违背**可编辑 PPTX 硬需求**
> 关联：[ppt-quality-attention-plan.md](./ppt-quality-attention-plan.md)（§3.2 枚举驱动天花板）

---

## 1. 问题定位（已核实）

成品只是「排版了」，不精美，根因是**数据模型的视觉词汇被锁死**，不是模型不会审美：

- `ShapeElement` 只有单色 `fillColor` + 2px 实线 `strokeColor`，无渐变、无阴影、无圆角（`presentation.ts:82-92`）。
- 装饰工具（`add-layout-decorations.ts`）的「创意」上限 = 序号圆点 / 一条分隔线。
- 11 个内置 layout 的间距/层级/配色是「能用」级别，模板质量即观感上限（§3.2）。

「精美 vs 排版」的差距，70% 来自**渐变、阴影、圆角、层次**——本计划首期聚焦这三样（用户已确认范围）。

---

## 2. 硬约束核实：哪些能进可编辑 PPTX

已查 `node_modules/pptxgenjs/types/index.d.ts`，结论**必须据实设计**：

| 视觉效果 | HTML/CSS | pptxgenjs 可编辑图元 | 落地策略 |
|---|---|---|---|
| 阴影 | ✅ box-shadow | ✅ `ShadowProps`（outer/inner + blur/offset/angle/opacity，`index.d.ts:961`） | **原生支持**，直接映射 |
| 圆角矩形 | ✅ border-radius | ✅ `ROUNDED_RECTANGLE` + `rectRadius` | **原生支持**，改 shapeType |
| 透明度 | ✅ rgba/opacity | ✅ `transparency` 0-100（`ShapeFillProps.transparency`） | **原生支持** |
| shape 渐变填充 | ✅ linear/radial-gradient | ❌ **`ShapeFillProps.type` 只有 `'none' \| 'solid'`** | 见 §3.3 妥协方案 |
| 背景渐变 | ✅ | ⚠️ `slide.background` 亦仅 solid fill | 见 §3.3 |

**关键取舍——渐变**：pptxgenjs 的 shape 与 background 填充都**不支持**真渐变。要在「可编辑 PPTX」里保留渐变有两条路：

- **方案 R1（推荐）**：渐变仅作用于**背景层**。导出时把整页背景渐变**栅格化为一张背景图**（`slide.background = { data: pngDataUri }`）。背景变图不影响前景文本/表格/图表的可编辑性——用户仍能编辑所有内容元素，只是背景不可改。这是「可编辑」与「渐变观感」的最佳平衡。
- **方案 R2**：渐变色块用**近似纯色**导出（取渐变中点色）。完全可编辑，但丢失渐变观感。
- 前景 shape 的渐变：首期**不做**（导出必然降级），如需强调用「纯色块 + 阴影 + 圆角」组合已足够。

倾向 **R1**（背景渐变栅格化）+ 前景 shape 用纯色/透明度/圆角/阴影。§7 待你确认。

---

## 3. 数据模型扩展（词汇层）

三处渲染器必须**同步**支持每个新字段，否则出现「预览好看、导出崩」的裂缝：

1. `PPTMirror.tsx` / `ShapeElementView.tsx` — 编辑器实际显示（真相）
2. `slide-html-render.ts` — 反馈截图用的渲染
3. `ppt-exporter.ts` — 可编辑 PPTX 导出

> **单一真相纪律**：每个字段落地前，先在 §6 检查表勾掉三处渲染器，测试同时覆盖三条路径，避免任一处漏改。

### 3.1 `ShapeElement` 扩字段（`presentation.ts:82-92`）

```ts
export const shadowSchema = z.object({
  color: z.string().default("#000000"),
  blur: z.number().default(12),
  offsetX: z.number().default(0),
  offsetY: z.number().default(4),
  opacity: z.number().min(0).max(1).default(0.15),
}).optional();

export const shapeElementSchema = z.object({
  // ...现有字段...
  shapeType: z.enum(["rectangle", "circle", "arrow", "line", "roundedRect"]), // +roundedRect
  fillColor: z.string().default("#3b82f6"),
  strokeColor: z.string().default("#1d4ed8"),
  cornerRadius: z.number().optional(),      // 圆角半径 px（roundedRect / rectangle）
  fillOpacity: z.number().min(0).max(1).optional(),  // 半透明叠层
  shadow: shadowSchema,                     // 阴影
});
```

所有新字段**可选**——旧数据零迁移，未设置即当前行为。

### 3.2 背景层扩展（渐变栖身处）

背景渐变不放进 `ShapeElement`（前景 shape 导出不了渐变），而是作为**slide 级背景能力**。当前背景由 `slide-variant.ts` 的 `resolveSlideBackgroundWithVariant` 决定，返回 `slideBg`(CSS) + `exportFill`(纯色)。扩展：

```ts
// resolveSlideBackgroundWithVariant 返回值增加：
{
  slideBg: string;        // CSS，可含 linear-gradient（现有 PPTMirror 已用，见 :136）
  exportFill: string;     // 纯色兜底
  gradient?: {            // 新增：结构化渐变，供栅格化导出
    type: "linear" | "radial";
    angle?: number;
    stops: Array<{ color: string; pos: number }>;
  };
}
```

PPTMirror 的 `slideBg` 本就支持 `linear-gradient`（`PPTMirror.tsx:136,145`），HTML 渲染层已透传 `bg.slideBg`（`slide-html-render.ts:107`）——**渲染侧渐变几乎免费**，只差导出侧栅格化。

### 3.3 导出侧渐变栅格化（`ppt-exporter.ts`）

```ts
// 若 background.gradient 存在 → 用离屏渲染把 1280×720 渐变生成 PNG dataUri
if (slideBackground.gradient) {
  const bgPng = await renderGradientToPng(slideBackground.gradient); // 复用 slide-thumbnail 的 BrowserWindow 或 node canvas
  slide.background = { data: bgPng };
} else {
  slide.background = { fill: cleanColor(slideBackground.exportFill) };
}
```

前景元素继续走原生图元路径（可编辑）。新增 shape 字段映射：

```ts
// shape 导出
const shapeType = element.shapeType === "roundedRect"
  ? pptx.shapes.ROUNDED_RECTANGLE : /* ...现有映射... */;
slide.addShape(shapeType, {
  x, y, w, h,
  fill: { color: cleanFill, transparency: element.fillOpacity != null ? (1 - element.fillOpacity) * 100 : 0 },
  line: { color: cleanStroke, width: 2 },
  rectRadius: element.cornerRadius ? px(element.cornerRadius) : undefined,
  shadow: element.shadow ? {
    type: "outer",
    color: cleanColor(element.shadow.color),
    blur: element.shadow.blur, offset: element.shadow.offsetY,
    angle: 90, opacity: element.shadow.opacity,
  } : undefined,
});
```

---

## 4. 内置模板重做（观感上限层）

用户已确认此为词汇扩展后的落地重心。词汇补齐后，`layout.ts`（777 行，`applyLayout` + 各 layout handler）的模板才有材料重制。原则：

- **留白与层级**：大标题 + 明确的主/次/辅三级字号差；不要平铺。
- **accent 出血色块**：用带圆角+阴影的色块做视觉锚点，替代当前「一条线」的单调装饰。
- **卡片化**：concept/comparison/case 的要点包进带 `cornerRadius` + `shadow` + `fillOpacity` 的卡片。
- **背景渐变**：cover/section 用 hero 渐变背景（现有 variant 已有钩子，补 `gradient` 结构即可导出）。

**重做顺序**（按出现频率与视觉权重）：`cover` → `section` → `concept` → `comparison` → `case` → 其余。每个 layout 重做后立即用反馈截图（§5）对照迭代。

### 4.1 风格 token 扩展（`style-strategies.ts`）

当前 `StyleStrategy` 只有 `colors` + `spacing`。补 `radii`（圆角规范）、`elevation`（阴影规范）、`gradient`（背景渐变规范），让重做的模板从 token 取值而非硬编码，保证一套 deck 视觉一致。

---

## 5. 视觉反馈闭环（验证手段，非首期主线）

现状：HTML 渲染 + 截图**已跑通**（`slide-thumbnail-service.ts` 离屏 BrowserWindow capturePage），`preview-slide` 已能出 PNG，但是 deferred 且**未自动回喂**模型。

首期先把它当**开发者验证工具**：重做模板时人工看截图对照。二期再接原生 tool-use 图片块自动回喂，做 render→critique→fix（此前提是词汇已扩、模型有工具可修）。不阻塞本计划主线。

---

## 6. 落地步骤与三渲染器同步检查表

| # | 改动 | presentation.ts | PPTMirror/ShapeView | slide-html-render | ppt-exporter | 测试 |
|---|------|:---:|:---:|:---:|:---:|---|
| 1 | shape `+shadow` | ☐ schema | ☐ boxShadow | ☐ box-shadow | ☐ ShadowProps | 三路径快照 |
| 2 | shape `+cornerRadius`/`roundedRect` | ☐ | ☐ borderRadius | ☐ border-radius | ☐ ROUNDED_RECTANGLE+rectRadius | 同上 |
| 3 | shape `+fillOpacity` | ☐ | ☐ rgba/opacity | ☐ | ☐ transparency | 同上 |
| 4 | 背景 `gradient` 结构 + 栅格化导出 | — | ☐ 已支持 | ☐ 已支持 | ☐ renderGradientToPng | 导出集成测试 |
| 5 | style-strategy token（radii/elevation/gradient） | — | — | — | — | 单测 |
| 6 | 重做 layout 模板（cover→section→…） | — | 依赖 1-5 | 依赖 1-5 | 依赖 1-5 | 视觉截图对照 |

**顺序**：1→2→3（shape 三字段，纯增量、旧数据零迁移）→ 4（背景渐变，独立）→ 5（token）→ 6（重做模板，消费前五步）。每步 `npm run typecheck` + `npm run test` 全绿。

---

## 7. 待确认问题

1. **渐变导出策略**：确认走 **R1**（背景渐变栅格化为 PNG 背景图，前景全可编辑）还是 **R2**（渐变降级为纯色，完全可编辑但丢渐变）？倾向 R1。
2. **栅格化渲染器**：渐变转 PNG 复用 `slide-thumbnail-service` 的 Electron BrowserWindow，还是引入轻量库（如 `@napi-rs/canvas`）？前者零新依赖但耦合 Electron；后者可在纯 Node/测试跑。倾向复用 BrowserWindow（首期零新依赖）。
3. **前景 shape 渐变**：首期确认**不做**（导出必降级），用纯色+透明度+阴影+圆角替代？
4. **模板重做的验证**：是否先接入 §5 的截图自动回喂再重做模板（模型自评），还是先人工对照截图快速迭代？倾向先人工，闭环二期。

---

## 8. 风险

- **三渲染器漂移**：最大风险。任一处漏改 → 预览/截图/导出不一致，且截图反馈会误导模型。规避：§6 检查表逐字段勾三处 + 测试覆盖三路径。
- **渐变栅格化性能**：每页导出多一次离屏渲染。规避：仅当 `background.gradient` 存在时触发；纯色背景走原路径。
- **PPTX 阴影/圆角保真度**：pptxgenjs 的 shadow/rectRadius 与 CSS 观感不完全一致。规避：接受「近似」，以 PowerPoint 打开的实际效果为准校准参数，不追求像素级对齐。
- **旧数据兼容**：所有新字段可选，未设置即现行为，零迁移。

---

## 9. 一句话总结

差距在**视觉词汇被数据模型锁死**，不在模型审美。首期给 `ShapeElement` 补阴影/圆角/透明度（三者都能进可编辑 PPTX 原生图元）、给背景补渐变（栅格化导出、前景仍可编辑），三渲染器同步；随后用扩好的词汇重做内置模板，把观感上限抬起来。渐变前景 shape 因 pptxgenjs 不支持而首期不做，是唯一被硬约束挡下的取舍。

