# PPT 视觉表达系统与 Layout Grammar 建设计划

> 版本：2026-07-05  
> 状态：建设中（首个骨架已落地）  
> 目标：先增强基础视觉表达能力与 Layout Grammar，让模型能够稳定看见并控制效果；随后再引入 `brand-profile.json` 做内容品牌推导。

> 进度更新：2026-07-05  
> 已完成首个系统骨架与首批高频 Grammar：`cover`、`section`、`process`、`case`、`image-grid` 已支持可执行变体，layout-plan/Design Agent 已接入 `grammarVariant + designTokens`。P0 图片链路已增加 Tavily 图片候选、远程资产本地化、来源元数据和 PPTX 原生 cover/contain 导出。尚未完成 toc/quote 等剩余 handler、结构化 render evaluation 与 brand-profile 推导。

---

## 1. 核心判断

当前系统已经能完成内容草稿、layout-plan、自动排版、缩略图反馈与 PPTX 导出，但视觉结果仍偏「统一主题卡片页」。如果先做 `brand-profile.json`，Agent 也只能把品牌判断压缩到有限的卡片/线条/背景能力里，最终会出现「品牌分析很漂亮，画面仍然普通」的问题。

因此建设顺序应调整为：

```
Visual Vocabulary
    ↓
Layout Grammar
    ↓
Design Tokens
    ↓
Render Evaluation
    ↓
Brand Profile
```

一句话：**先让系统有足够的视觉语言，再让模型根据内容生成品牌。**

---

## 2. 系统定位

本计划要建设的是一个 **Visual Expression System（视觉表达系统）**，不是更多固定模板。

| 层级 | 作用 | 非目标 |
|------|------|--------|
| Visual Vocabulary | 定义系统能画什么：背景、形状、图片、图表、文字、母题 | 不直接决定页面结构 |
| Layout Grammar | 定义内容如何组织：封面、目录、路径、案例、对比、引用 | 不绑定具体模板风格 |
| Design Tokens | 定义当前 deck 的视觉语气：颜色、字体、形状、密度、母题 | 不做完整品牌推理 |
| Render Evaluation | 看缩略图后判断是否真的有效 | 不只做 schema 校验 |
| Brand Profile | 从内容推导品牌气质与设计方向 | 放到基础能力成熟后 |

最终目标是：同一个 `process` grammar，可以渲染成商务时间轴、纸本阅读路径、科技节点链路或教育课程路线，而不是永远一排卡片。

---

## 2.1 当前完成情况

| 状态 | 内容 | 对应文件 / 说明 |
|------|------|-----------------|
| 已完成 | `DesignTokensV1` schema 与解析工具 | `src/shared/design-tokens.ts` |
| 已完成 | `layout-plan` 支持 deck/page 级 `designTokens` 与 `grammarVariant` | `src/shared/layout-plan.ts` |
| 已完成 | `PresentationCommand.update-slide-layout` 可携带 tokens / variant | `src/shared/commands.ts` |
| 已完成 | Slide / Presentation 增加 `designTokens`、Slide 增加 `grammarVariant` | `src/shared/presentation.ts` |
| 已完成 | 元素增加 `provenance` 来源字段：layout / user / agent / asset | `src/shared/presentation.ts` |
| 已完成 | 重排保护用户 shape，避免用户手工矩形被吞 | `src/shared/layout-shape-utils.ts` |
| 已完成 | `update-slide-layout` undo 改为恢复整页状态 | `restore-slide` command |
| 已完成 | `VISUAL_TOKENS` 扩展 spacing / motif 基础 token | `src/shared/visual-tokens.ts` |
| 已完成 | Layout Grammar handler 接口与 registry | `src/shared/layout-grammar.ts` |
| 已完成 | `cover` grammar handler 试点 | `centered` / `editorial-hero` / `signal-dark` |
| 已完成 | motif primitives v1 | bookmark / arc / margin-note / path-line |
| 已完成 | 同一 cover 内容在 3 套 tokens 下产生不同结构与气质 | 单元测试覆盖 |
| 已完成 | 图片候选搜索与本地化资产闭环 | Tavily `include_images` → `assets/images/` → 来源/授权元数据 → PPTX |
| 已验证 | 单元测试通过 | `npm test`：56 files / 348 tests |
| 未完成 | `layout-slots` 与 handler 单一来源彻底合并 | 仍需后续处理 |
| 部分完成 | 多 layout grammar handler | `section` / `process` / `case` / `image-grid` 已完成；`toc` / `quote` 等待后续 |
| 已完成 | Agent skill 输出 grammar + tokens | `ppt-design-layout` 已接入合法变体表与 designTokens |
| 未完成 | 结构化视觉评分与 render feedback 指标 | P3 后续 |
| 未完成 | `brand-profile.json` 推导 | P4 后续 |

---

## 3. 系统应接入的能力

### 3.1 视觉词汇能力

需要先补齐或标准化这些基础表达：

| 能力 | 当前状态 | 建议 | 进度 |
|------|----------|------|------|
| 背景 | 已有 `slideVariant`、渐变导出 | 增加背景风格 token：paper / grid / gradient / clean / dark | 已有 token schema 与 cover 映射；背景渲染细化待做 |
| 形状 | 已有圆角、阴影、透明度 | 增加 motif 用形状：书签、侧栏、章节角标、色块带、弧线、路径线 | 部分完成：bookmark / arc / margin-note / path-line |
| 图片 | 已有 imageSlot / objectFit、Tavily 图片候选、本地缓存与来源元数据 | 增加焦点裁切和 imageTreatment：masked、framed、duotone、captioned | P0 搜索/本地化/导出已完成；视觉 treatment 仍为部分完成 |
| 图表 | bar / h-bar / timeline / kpi-tower | 增加 chartStyle：minimal、dashboard、editorial、report；支持单位、标签、重点值 | 部分完成：schema 字段已加；渲染细化待做 |
| 图标 | 24 个内置 | 先扩到高频业务/教育/科技/阅读 icon；后续接 Lucide 子集 | 未开始 |
| 字体 | serif / sans / mono | 增加 fontMood：formal、editorial、technical、warm、minimal | 已完成 schema；cover 已接入 fontMood |
| 装饰 | 当前偏序号圆、线条 | 增加 motifSystem：每套 deck 一个可复用视觉母题 | 部分完成：motif-system v1 |

### 3.2 Layout Grammar 能力

Layout 不应继续等于固定模板，而应成为结构语法：

| Grammar | 结构语义 | 可变视觉表达 | 进度 |
|---------|----------|--------------|------|
| cover | title + subtitle + hero visual + motif | 大图、色块、侧栏、书签、曲线、留白 | 已完成试点 |
| toc | chapter list + index motif | 编号目录、路径目录、卡片目录、边注目录 | 未开始 |
| section | chapter marker + transition | 居中、编辑式分栏、章节色带 | 已完成 v1 |
| concept | parallel points | 卡片、便签、图标列表、分栏、浮动块 | 未开始 grammar 化 |
| process | path + nodes + annotations | 卡片、时间线、路径、阶梯 | 已完成 v1 |
| case | narrative + metric + evidence | 左右分栏、KPI 聚焦、大图证据 | 已完成 v1 |
| comparison | left/right semantic groups | 对照表、天平、分割线、冲突/解决结构 | 未开始 grammar 化 |
| quote | quote + source + atmosphere | 大留白、书页引用、深色强调、注释框 | 未开始 |
| image-grid | media + captions | 网格、主图说明、胶片带、证据墙 | 已完成 v1 |
| summary | takeaways + next action | 结论栏、行动清单、复盘页 | 未开始 grammar 化 |

### 3.3 模型接入能力

模型不应直接手填坐标，而应控制以下高层参数：

```json
{
  "layout": "process",
  "grammarVariant": "path",
  "designTokens": {
    "palette": "warm-paper",
    "fontMood": "editorial",
    "shapeLanguage": "annotation",
    "backgroundStyle": "paper",
    "motif": "bookmark",
    "density": "calm",
    "imageTreatment": "framed",
    "chartStyle": "minimal"
  }
}
```

也就是说，Agent 先学会输出 **layout + grammarVariant + designTokens**，再做品牌推导。

---

## 4. 接入当前工程的方式

### 4.1 现有接入点

| 当前文件 / 模块 | 角色 | 改造方向 | 进度 |
|-----------------|------|----------|------|
| `src/shared/presentation.ts` | 数据模型 | 增加可选 design token / element provenance 字段 | 已完成 |
| `src/shared/visual-tokens.ts` | 基础视觉 token | 扩展为视觉词汇单一来源 | 部分完成 |
| `src/shared/layout.ts` | 集中式排版 | 拆成 layout grammar handlers | 部分完成：cover 已接入 |
| `src/shared/layout-slots.ts` | 图片槽位 | 与 layout handler 合并为单一来源 | 未完成 |
| `src/shared/layout-registry.ts` | layout 元数据 | 升级为 grammar registry | 部分完成：新增独立 grammar registry |
| `src/shared/layout-plan.ts` | Design Agent 输出 | 增加 `designTokens` 与 `grammarVariant` | 已完成 |
| `src/shared/slide-background.ts` | 背景 | 由 tokens 决定背景风格 | 部分完成：cover backgroundVariant 映射 |
| `src/shared/chart-utils.ts` | 图表 SVG | 接入 chartStyle 与主题 token | 未完成 |
| `src/main/agent/runtime/render-feedback-loop.ts` | 缩略图反馈 | 增加可量化视觉评分 | 未完成 |
| `src/main/deck/validators/*` | 规则校验 | 增加视觉表达与可编辑性校验 | 未完成 |
| `skills/ppt-design-layout` | 设计决策 | 让模型输出 grammar + tokens | 未完成 |
| `skills/ppt-layout` | 执行 | 按 grammar plan 执行，不 freestyle | 未完成 |

### 4.2 建议新增模块

| 新模块 | 职责 | 进度 |
|--------|------|------|
| `src/shared/design-tokens.ts` | 定义 DesignTokensV1 schema | 已完成 |
| `src/shared/layout-grammar.ts` | 定义 grammar handler 接口、slot、content unit contract | 已完成基础接口 |
| `src/shared/layout-handlers/` | 每个 layout 独立 handler | 部分完成：`cover.ts` |
| `src/shared/motif-system.ts` | bookmark、arc、grid、annotation 等母题生成 | 部分完成：bookmark / arc / margin-note / path-line |
| `src/shared/visual-expression.ts` | 将 grammar + tokens 编译为 slide elements | 未开始 |
| `src/shared/visual-evaluation.ts` | 结构化视觉评分，不依赖模型主观判断 | 未开始 |
| `tests/fixtures/visual-expression/` | 多风格同内容对照 fixture | 未开始；当前用单元测试覆盖 |

---

## 5. 数据契约草案

### 5.1 DesignTokensV1

```ts
type DesignTokensV1 = {
  version: 1;
  palette: "business-blue" | "warm-paper" | "mono-report" | "tech-dark" | "soft-academic";
  fontMood: "formal" | "editorial" | "technical" | "warm" | "minimal";
  shapeLanguage: "cards" | "annotation" | "geometric" | "path" | "editorial";
  backgroundStyle: "clean" | "paper" | "grid" | "gradient" | "dark";
  motif: "none" | "bookmark" | "chapter-number" | "arc" | "path-line" | "margin-note";
  density: "calm" | "standard" | "dense";
  imageTreatment: "plain" | "framed" | "masked" | "captioned";
  chartStyle: "minimal" | "report" | "dashboard" | "editorial";
};
```

第一阶段不需要从内容自动推导这些字段，可由模型在 design 阶段直接选择。

### 5.2 LayoutPlan 扩展

```json
{
  "version": 1,
  "theme": "nordic",
  "palette": "cyan",
  "designTokens": {
    "palette": "warm-paper",
    "fontMood": "editorial",
    "shapeLanguage": "annotation",
    "backgroundStyle": "paper",
    "motif": "bookmark",
    "density": "calm",
    "imageTreatment": "framed",
    "chartStyle": "minimal"
  },
  "slides": [
    {
      "slideId": "slide-1",
      "title": "阅读笔记",
      "narrativeRole": "cover",
      "layout": "cover",
      "grammarVariant": "editorial-hero",
      "slideVariant": "hero",
      "rationale": "用纸本封面和书签母题匹配阅读主题"
    }
  ]
}
```

### 5.3 Element Provenance

为避免重排吃掉用户内容，建议给元素增加可选来源：

```ts
provenance?: "layout" | "user" | "agent" | "asset";
```

重排时只清理 `provenance: "layout"` 的元素；用户手工矩形、图片、注释不应被误删。

---

## 6. Agent 工作流接入

### 6.1 短期工作流

```
author：生成内容草稿
  ↓
design：输出 layout-plan + designTokens + grammarVariant
  ↓
style：grammar handler 编译成 elements
  ↓
render feedback：缩略图 + 视觉评分
  ↓
style fix：模型微调 tokens / grammarVariant
```

### 6.2 中期工作流

```
author：内容草稿 + content units
  ↓
design：layout grammar plan + designTokens
  ↓
fit pass：必要时把长段转为视觉单元
  ↓
style：执行 grammar
  ↓
evaluation：缩略图评分 + 规则校验
```

### 6.3 长期工作流

```
content / brief
  ↓
brand-profile.json：内容品牌气质
  ↓
design-system.json：品牌转 designTokens
  ↓
layout-plan.json：逐页 grammar
  ↓
render → evaluate → fix
```

---

## 7. 渲染反馈升级

当前缩略图反馈已经接入，但提示仍偏通用。建议增加结构化评分：

| 指标 | 目的 | 计算方式 |
|------|------|----------|
| layout repetition | 避免连续页面太像 | 连续页 layout / grammarVariant / shape distribution |
| visual anchor | 判断是否有主视觉 | 最大非背景元素面积、KPI 字号、图片面积 |
| density | 判断是否拥挤 | text count、估算行数、元素数 |
| hierarchy | 判断层级是否清晰 | 字号层级、标题/正文占比 |
| motif consistency | 判断品牌统一 | motif 元素出现频率和位置变化 |
| editable fidelity | 判断 PPTX 可编辑性 | 前景是否为原生 shape/text/table，而不是全图 |

反馈给模型时不要只说“看看缩略图”，而是给出：

```json
{
  "slideId": "slide-4",
  "score": 72,
  "issues": [
    "visual_anchor_missing",
    "too_many_card_like_blocks"
  ],
  "fixHints": [
    "switch grammarVariant to path",
    "increase motif scale on section pages"
  ]
}
```

---

## 8. 分阶段路线

### P0 — 统一基础契约

目标：让现有能力更可靠，为 Grammar 化做准备。

1. [ ] `layout-slots` 与 `layout.ts` 坐标统一，槽位由 handler 单一来源导出。（进行中：cover handler 已独立，slot 单一来源未完成）
2. [x] 增加 `provenance`，重排只清理 layout 生成物。
3. [x] `update-slide-layout` 的 inverse 恢复 layout / background / variant，不只恢复 elements。
4. [x] 将 `VISUAL_TOKENS` 扩展为 radii / elevation / spacing / motif 基础 token。
5. [x] 增加三渲染器一致性测试：PPTMirror、HTML thumbnail、PPTX exporter。（统一由 `ResolvedDesignSystem` 解析）

验收：现有 deck 重排不吞用户元素；图片槽位与实际排版一致；导出和预览不漂移。

### P1 — Visual Vocabulary v1

目标：系统真的能画出更多风格。

1. [x] 增加 DesignTokensV1 schema。
2. [ ] 增加 motif primitives：bookmark、chapter-number、margin-note、path-line、arc。（部分完成：bookmark / margin-note / path-line / arc）
3. [x] 增加 backgroundStyle：paper、grid、clean、gradient、dark。（编辑器 / HTML / PPTX 已接入，grid 在 PPTX 中保持原生线条）
4. [ ] 增加 imageTreatment：framed、captioned、masked。（plain / framed / masked 三端已接入；captioned 当前采用 framed 视觉，等待独立 caption 内容模型）
5. [x] 升级 chartStyle：KPI、h-bar、timeline 支持标签、重点值与 minimal / report / dashboard / editorial 默认样式。

验收：同一页内容在 3 套 tokens 下，缩略图应有明显不同气质。

### 当前实施批次 — Unified Design System

目标：旧 `theme/palette` 与新 `designTokens` 只在一个地方合并，所有渲染器消费同一个确定结果。

1. [x] 新增 `ResolvedDesignSystem`：统一颜色、字体、背景、密度、图片与图表默认值。
2. [x] 页级 `light/dark` 同步调整背景、文字、卡片与描边，不再只换底色。
3. [x] PPTMirror 与全屏/只读预览接入。
4. [x] HTML thumbnail / deck HTML 接入。
5. [x] PPTX exporter 接入，并覆盖 gradient / grid / image treatment / chart style。
6. [x] `update-slide-variant` 重新编译布局颜色，inverse 改为完整恢复 slide。
7. [x] 增加解析与三端导出契约测试。

完成后的变化：同一页在编辑器、缩略图和导出文件中不再各自解释主题；新增视觉 token 只需扩展解析层及对应原语，而不需要在三条渲染路径重复维护主题 switch。

### P2 — Layout Grammar v1

目标：把 layout 从固定模板改造成可变语法。

优先改造 6 个高频 grammar：

1. [x] `cover`
2. [ ] `toc`
3. [x] `section`
4. [x] `process`
5. [x] `case`
6. [ ] `quote`

扩展完成：`image-grid` grammar v1。

每个 grammar handler 需要声明：

```ts
{
  id: "process",
  supportedVariants: ["cards", "path", "timeline", "steps"],
  contentSlots: [...],
  visualSlots: [...],
  apply(input: { slide, tokens, variant, theme, palette }): Slide
}
```

验收：模型只改 `grammarVariant` 和 `designTokens`，不手填坐标，也能改变页面观感。

### P3 — Agent 接入

目标：让模型开始使用系统。

1. [x] `layout-plan.ts` 支持 `designTokens` / `grammarVariant`。
2. [x] 更新 `ppt-design-layout`：Design Agent 输出 grammar + tokens。
3. [x] 更新 `ppt-layout`：Executor 按 plan 调用 grammar handler。
4. [ ] Render feedback 回传视觉评分。
5. [ ] deck-review 增加视觉表达项：母题一致、锚点、密度、页面差异度。

验收：模型能在不依赖固定模板名的情况下，按内容选择视觉方向并通过缩略图反馈修正。

### P4 — Brand Profile

目标：在底层可表达后，再做内容品牌推导。

1. [ ] 新增 `brand-profile.json`：领域、受众、语气、情绪、视觉隐喻、禁忌风格。
2. [ ] 新增 `brand-profile -> designTokens` 映射。
3. [ ] 让 Agent 从内容自动推导品牌，再生成 layout-plan。
4. [ ] 增加用户可控项：更商务 / 更学术 / 更温暖 / 更科技 / 更克制。

验收：同一主题不同品牌方向能生成明显不同的 deck；用户可以通过自然语言调整品牌气质。

---

## 9. 首个 PR 建议

建议第一个 PR 不做品牌推导，只做基础系统骨架：

1. [x] 新增 `src/shared/design-tokens.ts`
2. [x] 新增 `src/shared/layout-grammar.ts`
3. [x] 给 `layout-plan.ts` 增加可选 `designTokens` / `grammarVariant`
4. [x] 把 `cover` 或 `section` 作为第一个 grammar handler 试点
5. [ ] 修复 slot 单一来源问题
6. [ ] 增加 fixture：同一 cover 内容，用 `business-blue` / `warm-paper` / `tech-dark` 三种 tokens 渲染。（已用单元测试验证三风格，fixture 待补）

这个 PR 的目标是证明：**不换模板，只换 tokens + grammar variant，页面观感能显著变化。**

当前状态：目标已通过 `cover` grammar 单元测试初步证明；正式 fixture 与截图验收仍待补齐。

---

## 10. 风险与约束

| 风险 | 说明 | 缓解 |
|------|------|------|
| 过度抽象 | Grammar 系统可能变成大而空的 schema | 每次只改 1–2 个高频 layout，用缩略图验收 |
| PPTX 可编辑性下降 | 复杂视觉容易想用整图 | 前景坚持 text/shape/table/chart 原生优先，背景可栅格化 |
| 模型控制面过大 | tokens 太多会让模型犹豫 | 第一版限制枚举，少量字段即可 |
| 三渲染器漂移 | 预览、HTML、PPTX 不一致 | 每个视觉字段必须覆盖三路径测试 |
| 品牌推导过早 | 分析有了，效果没有 | P4 前不强推 brand-profile |

---

## 11. 验收标准

阶段性验收不看代码是否“优雅”，看缩略图是否真的变好：

1. 同一内容可生成至少 3 种明显不同视觉气质。
2. 扫缩略图能区分 cover / toc / section / data / quote，而不是一排同构卡片。
3. 每套 deck 有一个稳定母题，且不是简单重复同一 shape。
4. 主要前景元素在 PPTX 中仍可编辑。
5. 模型不需要手填坐标即可完成 80% 视觉变化。
6. Render feedback 能指出具体失败原因，而不是泛泛说“不够好看”。

---

## 12. 一句话路线

先把系统从「固定 layout 模板」升级为「可组合视觉语法」，让模型能通过 tokens 和 grammar 控制真实画面；等底层表达足够丰富，再让 `brand-profile.json` 从内容中自动推导品牌气质。
