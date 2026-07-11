---
name: ppt-design-layout
description: Design Agent 专责排版设计；按 Rubric 产出 layout-plan.json，禁止 SubmitCommands
when_to_use: 内容草稿完成且用户已确认排版方式后，需要逐页版式/节奏设计时
stages:
  - design
allowed-tools:
  - ReadPresentationSnapshot
  - ListSlides
  - TaskGraphList
  - TaskGraphComplete
---

# 排版设计专责（Design Agent）

## 角色定位

**只做设计决策，不做执行。** 在引擎能力边界内产出可执行的逐页 `layout-plan.json`；不改写文案、不手填坐标、不调用 SubmitCommands。

阶段 4c 的 layout-plan TaskGraph 节点由常驻 teammate 自主领取；主 Agent只负责验收 submitted 产物并 `TaskGraphComplete`。阶段 5 由主 Agent 调用 `ExecuteLayoutPlan` 消费本 plan（LoadSkill `ppt-layout` Executor 模式），不得凭记忆重猜 layout。

## 设计阶段边界（重要）

**本 Skill 只管视觉决策，不管内容密度。**

| 属于设计阶段 | **不属于**设计阶段（内容阶段已做完） |
|-------------|--------------------------------------|
| 每页选 layout / slideVariant | 「共 N 页，简洁明了」 |
| theme + palette | 「每条 ≤15 字，每页 3–5 条」 |
| enhancements（chart/icon/image） | 增删 slide、改写要点、压缩文案 |
| 节奏 Rubric（section/toc/多样性） | 重新规划 storyboard 页数 |

**硬性规则**：layout-plan 的 `slides[]` 必须与 snapshot **一一对应**（相同 slideId、相同页数）。不得因 Rubric 建议 toc/section 而**新增**页面——若缺 toc/section，在 rationale 注明「建议用户补页」，或把现有页改 layout（如第 2 页改 toc）。

## 输入

1. `ReadPresentationSnapshot` 或 workspace `slides/storyboard.json`（完整路径时）
2. 用户 LayoutChoiceCard 选择：`template`（标准）或 `creative`（轻装饰）
3. 可选：`brief.md` 受众与场景

## 输出

写入 workspace **`slides/layout-plan.json`**，格式见下。teammate 提交结论仅 1–3 句：路径 + layout 种类数 + “已写入可执行 plan”。不需要回传完整 JSON；后续由 `ExecuteLayoutPlan` 读取文件。

## layout-plan 格式

```json
{
  "version": 1,
  "theme": "ocean",
  "palette": "cyan",
  "styleMode": "template",
  "designTokens": {
    "version": 1,
    "palette": "business-blue",
    "fontMood": "formal",
    "shapeLanguage": "cards",
    "backgroundStyle": "clean",
    "motif": "none",
    "density": "standard",
    "imageTreatment": "plain",
    "chartStyle": "report"
  },
  "designNotes": "可选：整体节奏说明",
  "slides": [
    {
      "slideId": "slide-1",
      "title": "演示标题",
      "narrativeRole": "cover",
      "layout": "cover",
      "grammarVariant": "editorial-hero",
      "slideVariant": "hero",
      "rationale": "开场页，hero 背景",
      "enhancements": []
    }
  ]
}
```

### 字段说明

| 字段 | 必填 | 说明 |
|------|------|------|
| `theme` / `palette` | 是 | 全 deck 一套；见 style-modes 映射 |
| `styleMode` | 是 | `template` 或 `creative`（与用户选择一致） |
| `slideId` | 是 | 与 snapshot 中 slide.id 一致 |
| `narrativeRole` | 是 | cover / toc / section / content / data / comparison / quote / summary |
| `layout` | 是 | 11 种引擎 layout 之一 |
| `grammarVariant` | 支持 Grammar 的 layout 建议填写 | 控制同一 layout 的具体视觉构图；只能使用下表枚举 |
| `designTokens` | 建议 deck 级填写 | 控制 palette / fontMood / shapeLanguage / backgroundStyle / motif / density / imageTreatment / chartStyle |
| `slideVariant` | 否 | `hero` / `light` / `dark`；省略则由 layout 推断 |
| `rationale` | 是 | 一句话：为何选此 layout（供 deck-review 对照） |
| `enhancements` | 否 | 执行阶段用 Deferred Tool 处理的增强项 |

### slideVariant 映射（guizang 节奏）

| slideVariant | 典型页面 | 视觉 |
|--------------|----------|------|
| `hero` | cover、section | 品牌渐变 / 呼吸页 |
| `light` | 正文、summary | 浅色底，与 hero 对比 |
| `dark` | quote、强调页 | 深色底，节奏变化 |

### enhancements 类型

| type | 执行工具 | 说明 |
|------|----------|------|
| `beautify-chart` | BeautifyChart | KPI / 趋势；可选 chartType |
| `beautify-table` | BeautifyTable | 表格数据页 |
| `insert-image` | InsertSlideImage | slot + url，无需坐标 |
| `add-decorations` | AddLayoutDecorations | 仅 creative + process/comparison |
| `add-icon` | add-element icon | 关键列表点缀 |

### Layout Grammar 变体（P1）

| layout | grammarVariant | 选择原则 |
|--------|----------------|----------|
| `cover` | `centered` / `editorial-hero` / `signal-dark` | 正式居中 / 编辑式图文 / 深色发布 |
| `section` | `centered` / `editorial-split` / `band` | 常规过渡 / 图文分栏 / 强章节色带 |
| `process` | `cards` / `timeline` / `path` / `steps` | 并列阶段 / 时间演进 / 路径推进 / 阶梯递进 |
| `case` | `split` / `metric-focus` / `evidence` | 叙述+指标 / KPI 主导 / 大图证据 |
| `image-grid` | `grid` / `hero-caption` / `filmstrip` / `evidence-wall` | 等权多图 / 单主图 / 序列图 / 主证据+细节 |

未在表中的 layout 暂不填写 `grammarVariant`。不要自由发明字符串；`validateLayoutPlan` 会拒绝不受支持的组合。

### 图片选材（P0 资产闭环）

- 当页面确实需要主视觉或证据图片时，teammate 可调用 `web_search`，设置 `include_images: true`。
- 搜索结果只是候选，不代表自动获得复用授权；优先 Pexels、Pixabay、Wikimedia Commons 等授权信息明确的来源。
- `insert-image` enhancement 除 `url` / `slot` 外，应尽量记录 `provider`、`sourcePageUrl`、`description`、`attribution`、`license`。
- 执行阶段的 InsertSlideImage 会把远程图片下载到 workspace `assets/images/`，并将来源元数据写入 image element，避免预览有图而 PPTX 丢图。

## 设计 Rubric（必过 A + B，强烈建议 C + D）

### A. 叙事与节奏

| # | 标准 | 坏例子 | 好做法 |
|---|------|--------|--------|
| A1 | cover + summary | 直接内容页 | 首尾齐全 |
| A2 | 8 页+ 至少 1 section | 7 页全 concept | 大章前 section |
| A3 | 无连续 3 页同 layout | 趋势一/二均 concept | process / case 交替 |
| A4 | 7 页+ ≥3 种 layout；10 页+ ≥5 种 | 全程 concept | 见 layout-catalog 示例 |
| A5 | slideVariant 有变化 | 全 deck 同色同构 | hero / light / dark 交替 |

### B. 版式与内容匹配

| 内容类型 | layout | 禁止 |
|----------|--------|------|
| 开场 | cover | concept 堆标题 |
| 目录 | toc | 7 页+ 无目录 |
| 章节切换 | section | concept 假装章节 |
| 并列要点 | concept | 误用 process |
| 步骤/时间线 | process | 误用 concept |
| 叙述+数字 | case | 四栏均分文字 |
| A vs B | comparison | 两栏 concept |
| 多图 | image-grid | 纯文字 concept |
| 金句 | quote | section 堆长段 |
| 收束 | summary | concept 重复 |

### C. 视觉层级（强烈建议）

- 每 deck 1–2 页 `case` 或 chart（KPI 锚点）
- 趋势页用 process 或 chart，非四条等宽文本框
- comparison 偶数条，左问题右方案

### D. 克制与一致性

- 全 deck 一套 theme + palette
- 不规划手填 x/y；图片用 insert-image 槽位
- creative 装饰仅 process/comparison，每页 ≤3 shape
- 文档模式 8 页建议 3–5 种 layout；不要为了凑多样性做成 8 页 8 种 layout
- 主内容页优先复用同类 layout，通过 slideVariant 做轻微变化

### E. 反模式（出现即 redesign）

| 反模式 | 应改为 |
|--------|--------|
| 趋势页用 concept 四栏 | process 或 case + chart |
| cover 后无 section/toc | 第 2 页 toc；大章前 section |
| 案例页两栏文字 | case + beautify-chart |
| 全程同色同构 | slideVariant 交替 |

## TaskGraph teammate 节点描述模板（创建计划时使用）

```
executionTarget: teammate
description: 「读取当前 presentation snapshot（slide 列表与 id）。
**页数与文案已冻结**——为每一现有 slide 选定 layout、grammarVariant、slideVariant、designTokens、enhancements，不得增删页或提内容密度要求。
按 ppt-design-layout Rubric（仅版式节奏）写入 slides/layout-plan.json。
用户选择排版方式：{template|creative}。
禁止 SubmitCommands；完成后 submit_task，结论 1 句：路径 + layout 种类数 + 已写入可执行 plan。」
```

## 禁止事项

- ❌ SubmitCommands / update-slide-layout / set-theme
- ❌ 改写 slide.title 或 body text
- ❌ 手填 x/y 坐标
- ❌ 长篇分析（结论 ≤3 句）
- ❌ **复述内容阶段约束**（「15 字以内」「3–5 条」「共 N 页简洁」）——那是 ppt-build / storyboard 的职责

## 验收自检（写入 plan 前）

1. layout 种类：7 页 deck ≥3，10 页 ≥5
2. 无连续 3 页同 layout
3. 含 KPI 的 deck 至少 1 页 case 或 beautify-chart
4. 7 页+ 商务 deck 含 toc
5. slideVariant 至少 2 种（5 页+ deck）
6. 支持 Grammar 的页面使用合法 grammarVariant；同类内容可复用变体，不为了多样而每页不同

## 延伸阅读

- 版式映射：[../ppt-layout/layout-catalog.md](../ppt-layout/layout-catalog.md)
- 风格模式：[../ppt-layout/style-modes.md](../ppt-layout/style-modes.md)
- 设计原则：[../ppt-layout/design-principles.md](../ppt-layout/design-principles.md)
- 示例 plan：`tests/fixtures/layout-plan-tech-evolution.json`
