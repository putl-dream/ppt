---
name: ppt-edit
description: 直接修改已有 SVG-native deck 的页面作者源，包括改文案、图片、图形、构图和页面顺序
when_to_use: deck 已存在，用户要求修改某页、替换图片、调整构图、增删页或重排页面时
stages:
  - author
  - edit
allowed-tools:
  - ListSlides
  - ReadCurrentSlide
  - ReadFile
  - WriteFile
  - PreviewSvgPage
  - SubmitSvgDeck
---

# SVG 作者源编辑

## 目标

只修改用户指定的页面 SVG，保持其他页面源文件不变。`slides/svg/P<NN>.svg` 是页面唯一视觉事实源；标题、页码、背景、正文、图表和装饰都在该 SVG 内，不存在 element 或自动 layout 层。

## 先读后改

1. 用 `ListSlides` 取得全部页面的稳定 id、顺序、`svgSourcePath` 与 `svgSha256`。
2. 目标是当前页时调用 `ReadCurrentSlide`，确认其真实 `visualSource.sourcePath`；其他页使用 `ListSlides.svgSourcePath`。不要凭页码猜路径。
3. 用 `ReadFile` 读取该路径的完整 SVG。必须基于完整源文件编辑，不得根据缩略图重建页面。
4. 明确修改边界：哪些页、哪些文案或视觉对象、是否改变页序。未在范围内的页面保持字节不变。

## 编辑原则

- 改标题、页码、背景或品牌条时，直接改 SVG 中对应节点。
- 改文案时同步检查换行、文字框宽度和附近元素，不能只替换字符串后忽略溢出。
- 替换图片时使用 workspace 相对 `href`，例如 `assets/images/new-hero.jpg`；禁止绝对路径和远程 URL。提交工具会内联该本地资源。
- 调整构图时自由修改 SVG 几何和分组，不调用固定 layout、grammar 或自动 chrome。
- 新增页面时写出完整 `1280 × 720` SVG；删除或重排页面时，在最终提交的有序 sourcePath 列表中反映结果。删除页面属于显著结构变更，范围不明确时先确认。
- 不把整页默认改成等宽圆角卡片；保留并强化原有视觉语言，除非用户明确要求重做。

## 工作流

1. 用 `WriteFile` 将完整、合法的 SVG 写回同一 `visualSource.sourcePath`；不要写片段或第二份视觉模型。
2. 对每个新增或修改页调用 `PreviewSvgPage`。检查文本截断、越界、重叠、图片、对比度和页面意图；未修改且 hash 与当前已提交页面一致的作者源可以直接复用。
3. 若预览失败，继续修改同一个 SVG 并重新预览；预览工具不能替代源文件修复。
4. 所有修改页通过后，调用一次 `SubmitSvgDeck`，传入 deck 的全部有序页面，而不是只提交改动页。显式传入 `"designSpecPath":"design/design-spec.json"` 与 `"pagePlanPath":"slides/page-plan.json"`；`communication`、`designSystem`、每页 `id/path/narrative` 必须与这两个锁文件完全一致。
5. 提交失败时根据错误修复源 SVG 或素材，再重新提交；不要切换到旧提交流程。

## 同步

若结构性改动改变了内容意图或页序，同步更新 `slides/page-plan.json`；页面 SVG 仍是可见结果的唯一作者源。纯视觉微调不必反写布局参数。

## 禁止

- 不使用 `SubmitCommands`、`PreviewCommands`、element id、layout handler 或自动排版。
- 不只看已提交预览就覆盖源文件；始终先读取完整 `visualSource.sourcePath`。
- 不让提交或导出阶段补标题、页码、背景或其他自动 chrome。
