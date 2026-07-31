---
name: ppt-workflow
description: 以完整页面 SVG 为唯一视觉事实源，完成从沟通契约、设计锁定、逐页规划、P01 校验到整套提交的新建 PPT 工作流
when_to_use: 用户要从零新建、批量生成或一条龙完成整套 PPT 时
stages:
  - discover
  - author
  - design
allowed-tools:
  - BeginPptCapability
  - ReadFile
  - WriteFile
  - PreviewSvgPage
  - SubmitSvgDeck
---

# SVG-native 端到端工作流

## 权威来源

新建流程只认 `slides/svg/P<NN>.svg` 为页面视觉作者源。设计规格和逐页计划描述意图，不能在预览或提交时补出任何可见对象。图片可以作为 workspace 资源被 SVG 显式引用；除此之外，页面的背景、标题、正文、页码、图表、图示和装饰都必须已经存在于 SVG 中。

预览与提交必须消费同一份 SVG。禁止把旧 Presentation element IR、固定 layout、layout handler、自动页眉/页码或其他 chrome 作为新建流程的一部分；不要调用 `PreviewCommands`、`SubmitCommands` 或 `ExecuteLayoutPlan`。无需兼容旧生成路线。

## 固定顺序

1. 若本 Query 尚未声明 PPT 工作，先调用一次 `BeginPptCapability({"capability":"create", ...})`。恢复同一 waiting-user Query 时沿用该 request；新的跨请求继续操作会获得新的 QueryId，但推进同一 PptJob。
2. 建立沟通契约：`audience`、`objective`、`desiredOutcome`、deck-wide `coreMessage`、`deliveryContext`、`afterUse`。只有缺少会改变内容事实或交付目标的信息时才询问。
3. 应用 `ppt-design`，先锁定唯一的 `argumentMode`、`visualStyle`、`readingMode` 和 `imageLanguage`，同时锁定语义色彩与字体角色。将结果写入 `design/design-spec.json`。
4. 应用 `ppt-design-layout`，为每页冻结 `finalCopy`、`coreMessage`、`audienceMove`、`rhythm`、`layoutIntent` 和素材引用，按顺序写入 `slides/page-plan.json`。
5. 应用 `ppt-build`。先用 `WriteFile` 只写 `slides/svg/P01.svg`。
6. 立即用 `PreviewSvgPage({"path":"slides/svg/P01.svg"})` 校验并真实渲染 P01。若有越界、缺字、素材失败、视觉层级或 SVG 兼容问题，修改同一个文件并重新预览；P01 未通过前禁止生成 P02。
7. P01 通过后，逐页用 `WriteFile` 写 `P02.svg`、`P03.svg`……；每次只改当前页，不让后处理器重新布局。
8. 全部写完后进入最终视觉门禁：按页调用 `PreviewSvgPage`，确保每个新建或改动 SVG 的当前内容与素材都成功产出 PNG。任何修订都会使旧凭据失效，必须重新预览该页。
9. 最后只调用一次 `SubmitSvgDeck`，显式传入 `"designSpecPath":"design/design-spec.json"`、`"pagePlanPath":"slides/page-plan.json"` 及有序 SVG 页面。`communication`、`designSystem`、每页 `id/path/narrative` 必须原样来自这两个锁文件；提交工具会重新读取并核对，再校验与内联 workspace 相对图片。任何锁漂移或页面失败都不视为完成。

## 作者文件

- `design/design-spec.json`：沟通契约和 deck-wide 设计锁。
- `slides/page-plan.json`：有序逐页内容与构图意图。
- `slides/svg/P01.svg`、`P02.svg`……：唯一视觉作者源。
- `assets/**`：SVG 显式引用的本地图片或其他资源。

设计规格和页面计划可以重建；一旦开始写 SVG，任何可见修改都必须直接修改对应 SVG，不能只改计划后期待提交工具代为更新。

## 页面硬约束

- 画布固定为 `1280 × 720`，根节点使用 `viewBox="0 0 1280 720"`。
- SVG 必须是完整页面构图，不是供模板或 layout handler 填槽的片段。
- 禁止自动 chrome；若要标题、页码、章节标、品牌条或背景，必须在每页 SVG 中明确绘制。
- 禁止把全套内容默认做成等宽圆角卡片网格；卡片仅在语义确实需要分组时使用。
- 图片 `href` 使用 workspace 相对路径，例如 `assets/images/hero.jpg`；禁止远程 URL。提交时由 `SubmitSvgDeck` 内联同一字节。
- 除显式引用的本地图片外，SVG 自包含：不依赖外部 CSS、脚本或运行时布局。

## 完成条件

只有在 P01 闸门通过、全部新建或改动 SVG 的当前版本均通过真实 PNG 门禁、页面与 `slides/page-plan.json` 一一对应、最终 `SubmitSvgDeck` 成功后，才能宣告新建 deck 完成。用户只要内容草稿时可以停在 `slides/page-plan.json`，但不得生成或提交占位页面。
