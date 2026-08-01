---
name: ppt-build
description: 根据锁定的设计规格和逐页计划，逐页编写完整 1280×720 SVG，经 P01 预览闸门后提交 SVG-native deck
when_to_use: 沟通契约、设计语言和每页最终文案均已锁定，需要生成并提交新建 PPT 时
stages:
  - author
  - design
allowed-tools:
  - BeginPptCapability
  - ReadFile
  - WriteFile
  - PreviewSvgPage
  - SubmitSvgDeck
---

# Deck 构建 — SVG-native Executor

## 目标

本技能必须运行在本 Query 已声明的 `create` capability 内；若尚未声明，先调用一次 `BeginPptCapability`。

读取 `design/design-spec.json` 与 `slides/page-plan.json`，把每页直接写成 `slides/svg/P<NN>.svg`。SVG 是页面的唯一视觉事实源；预览和提交都读取这些原文件，不再生成 Presentation commands，也不经过固定 layout 或自动排版。

## 开始前

1. 用 `ReadFile` 读取设计规格、页面计划和当前页所引用的素材清单；`hasMore=true` 时沿 `nextOffset` 和同一 `expected_version` 续读，直到取得完整文件。
2. 确认设计规格已经锁定 `argumentMode`、`visualStyle`、`readingMode`、`imageLanguage`、颜色角色与字体角色。
3. 确认每页都有最终的 `finalCopy`、`coreMessage`、`audienceMove`、`rhythm`、`layoutIntent`。
4. 保持页面 id 与文件名一一对应：`P01` → `slides/svg/P01.svg`。
5. 若计划或素材仍不完整，先补齐作者文件；不要用占位 SVG 掩盖缺口。

## SVG 页面契约

每个文件必须满足：

- 根元素为 `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">`。
- 完整绘制背景、标题、正文、页码、图表、图示、图片框、品牌标记与装饰；不存在提交后再补的自动 chrome。
- 使用原生 SVG 几何、`<text>/<tspan>`、`<image>`、`<defs>`、渐变、clipPath 等可转换结构。禁止 `<script>`、`<foreignObject>`、外部 CSS、运行时脚本和远程 URL。
- 除本地图片外自包含。图片 `href` 必须是 workspace 相对路径，例如 `assets/images/market-map.png`；不得写绝对路径。`PreviewSvgPage` 与 `SubmitSvgDeck` 必须解析同一资源，最终由提交工具内联。
- 所有可见对象都位于 `viewBox` 内；避免靠浏览器默认字体、HTML 换行或未声明样式得到偶然效果。
- 文案以页面计划的 `finalCopy` 为准。不要为了塞入页面擅自删改事实；容量不够时重构构图或按计划拆页。

## 页面级构图

每页先落实 `coreMessage` 和 `audienceMove`，再按 `rhythm` 与 `layoutIntent` 组织焦点、阅读顺序、比例、留白和图文关系。不要从 layout 枚举中选壳，也不要复用固定坐标模板。

- `anchor`：用章节命题、关键数字或核心视觉建立记忆点。
- `dense`：用清楚的网格、路径或证据层级承载近读信息。
- `breathing`：用大图、单句、单一数字或留白制造转折。

同一 deck 保持设计语言一致，但页面轮廓、焦点位置、密度和图片关系应随论证变化。禁止把每页都做成三卡、四卡或 2×2 圆角容器；卡片只在并列实体确有边界时使用。

## P01 闸门

1. 先只生成 P01。用一次 `WriteFile` 写完整 `slides/svg/P01.svg`，不要拆成多个临时片段。
2. 立即调用 `PreviewSvgPage({"path":"slides/svg/P01.svg"})`，让模型直接查看该 SVG 的真实 PNG。
3. 同时检查：SVG 合法性、资源可解析、文本未截断、对象未越界、对比度与层级、风格兑现、封面是否形成足够强的第一印象。
4. 失败时直接修订 P01 并重新预览。P01 未通过前不得批量生成其余页面。
5. P01 通过后，将它视为 deck-wide 视觉校准样本；其余页面继承设计语言，不复制其具体构图。

## 逐页生成

按 `slides/page-plan.json` 的顺序逐页工作：

1. 用 `ReadFile` 取得当前页计划与必要素材信息；分页结果必须读到 `hasMore=false`。
2. 只为当前页设计完整构图。
3. 用 `WriteFile` 写入对应 SVG。
4. P01 之外先完成剩余作者源，不调用后处理器重新布局。
5. 全部页面写完后按页调用 `PreviewSvgPage`，逐张查看真实 PNG；文字密集、图片裁剪、复杂图表或强效果页面尤其仔细。
6. 修复必须回写同一 SVG 并重新预览；禁止用提交阶段的 fallback 隐藏问题。

## 最终提交

提交前核对：

- 所有页面文件存在，编号连续并与页面计划顺序一致。
- 每页都是完整 1280×720 SVG，含自己的标题、页码和背景。
- 所有图片均为可读取的 workspace 相对路径，且没有远程依赖。
- 每个新建或改动页面的当前 SVG/素材哈希都有成功 PNG 预览，且没有仍未处理的阻断问题。
- deck 内至少有有意义的节奏变化，且没有全套卡片化。

只调用一次 `SubmitSvgDeck`，提交按顺序排列的 SVG 源文件及必要的 deck 元数据。参数必须显式包含 `"designSpecPath":"design/design-spec.json"` 和 `"pagePlanPath":"slides/page-plan.json"`；`communication` 原样使用设计规格的 `communicationContract`，`designSystem` 原样使用 `presentationDesignSystem`。每页提交项必须携带 page plan 中同序的 `id`、`path`，且 `narrative.role` 对应 `narrativeRole`，其余 narrative 字段也逐字来自 page plan。提交工具会重新读取两个锁文件并拒绝任何轴、页序、id、path 或 narrative 漂移。不得在提交前转换为旧 elements，也不得并行调用旧提交路线。

若 `SubmitSvgDeck` 因 SVG 或素材错误拒绝提交，修复作者 SVG/素材后再次提交；不要把失败报告为完成。

作者源是完整页面 SVG；提交路径仅为 `SubmitSvgDeck`。不把 element schema、layout/grammarVariant 或自动页眉当作本技能的中间层。

## 协作边界

本技能由主 Agent 直接执行。不要为逐页写 SVG、`PreviewSvgPage` 或 `SubmitSvgDeck` 而 `spawn_teammate`、创建 teammate Task，或把页面作者工作拆给子 Agent；一致性与 P01 预览闸门在 Lead 上下文内更便宜。

## 退出的旧路线

新建 deck 不调用 `SubmitCommands`、`PreviewCommands`、`ApplyDesignSystem`、`ExecuteLayoutPlan`、`AutoLayoutSlide` 或任何 layout handler。旧 `slide.title` 自动页眉、元素 schema、layout/grammarVariant 和设计 token 应用都不属于本技能。
