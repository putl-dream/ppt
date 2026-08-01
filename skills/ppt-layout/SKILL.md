---
name: ppt-layout
description: 为 SVG-native 页面提供自由构图执行准则，并把实际逐页 SVG 创作委托给 ppt-build
when_to_use: 页面计划已经冻结，需要把 layout intent 转成自由构图原则或准备进入 SVG 页面生成时
stages:
  - author
  - design
  - style
allowed-tools:
  - BeginPptCapability
  - ReadFile
  - WriteFile
---

# 自由构图执行说明

## 目标

本技能必须运行在本 Query 已声明的 `create` capability 内；若尚未声明，先调用一次 `BeginPptCapability`。

把 `slides/page-plan.json` 的页面意图翻译为可直接绘制的页面级构图判断。新建 deck 的实际 SVG 写入、P01 校验与提交统一由 `ppt-build` 完成。

## 输入

用 `ReadFile` 读取：

- `design/design-spec.json`：唯一 deck-wide 设计锁。
- `slides/page-plan.json`：逐页 `finalCopy`、`coreMessage`、`audienceMove`、`rhythm`、`layoutIntent` 和素材引用。

设计规格决定整套语言；页面计划决定当前页的内容和沟通任务。二者都不是视觉作者源，不能在预览或提交时补对象。

## 每页自由构图

对每页依次明确：

1. 主焦点：受众第一眼必须看到什么。
2. 阅读路径：横向、纵向、中心辐射、对照或流程如何与论点一致。
3. 空间比例：核心证据、解释、图片与留白各自占多少页面级面积。
4. 对齐与张力：使用哪些主轴、边界、规则线、重叠或裁切建立秩序。
5. 节奏兑现：
   - `anchor` 需要单一强锚点；
   - `dense` 需要可扫描的证据结构；
   - `breathing` 需要真正留白，不能重新塞成卡片网格。
6. 风格兑现：几何、字体、颜色、纹理、图片处理和留白必须共同体现 `visualStyle`，不能只换色。

`layoutIntent` 可以描述几何关系，但不要输出组件槽位、模板名或坐标参数。相似页面可以共享对齐逻辑，不能机械复制同一轮廓。

## 反卡片化

卡片只在确有独立实体、对比边界或交互隐喻时使用。以下不是默认构图：

- 三个等宽圆角矩形承载任意三点。
- 每页都使用相同的 2×2 容器。
- 把流程、架构、证据和大图都降级成卡片列表。
- 用装饰阴影代替信息层级。

优先考虑大字结论、裸文本、规则线、尺度对比、真实图表结构、路径关系、全幅图片和负空间。

## 交付给 `ppt-build`

新建页面时，本技能不写 SVG、不调用预览或提交。确认页面计划足够具体后，应用 `ppt-build`：

- 按页写 `slides/svg/P01.svg`、`P02.svg`……；
- 每页完整包含背景、标题、页码、图表和装饰；
- 先通过该技能定义的 P01 同源预览闸门，再继续其他页；
- 最后按该技能定义的方式提交全部有序页面。

若本技能发现 `layoutIntent` 仍是模板名或过于抽象，可用 `WriteFile` 修订 `slides/page-plan.json` 的自然语言意图，再交给 `ppt-build`。已存在 SVG 的重排由 `ppt-edit` 或 `ppt-beautify` 直接修改作者源。

布局意图写进 `slides/page-plan.json` 与页面 SVG；不要建立与 SVG 并行的 element/layout 模型，也不要让运行时追加自动 chrome。
