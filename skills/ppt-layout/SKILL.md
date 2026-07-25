---
name: ppt-layout
description: 严格执行 LayoutPlan v2，并以选定 design direction 重排图片、文字和数据元素
when_to_use: slides/layout-plan.json 已通过验收，需要生成并提交原子命令提案时
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

# Layout Executor（ppt-master-design-v2）

## 唯一职责

读取、校验并执行 `slides/layout-plan.json`。设计方向、页面 audience move、节奏、layout、grammar 和图片槽位都已锁定；Executor 不重新设计。

## 工作流

1. `ReadPresentationSnapshot` 与 `ListSlides`，确认当前 slideId/顺序仍与 plan 一致。
2. 调用 `ExecuteLayoutPlan({"path":"slides/layout-plan.json"})`。
3. 工具必须完成：
   - 校验 communication contract、设计方向与逐页意图
   - 应用所选 direction 的 DesignSystem v2
   - 将图片增强先纳入目标页，再用同一 grammarVariant 做最终布局
   - 生成一个可审查的 command proposal
4. 有 error 时修复或退回 Design Agent 重做 plan；不得从聊天记忆手写另一套布局。
5. 预览命令，确认图像、文本和数据元素没有丢失，再 `SubmitCommands`。
6. 加载 `deck-review` 做渲染后检查。

## 执行边界

- plan 是设计与执行之间的锁，不得擅自换 visual style、argument mode 或 color scheme。
- 不改标题和正文，不增删页。
- 不手填 x/y 绕过 grammar。
- 图片插入后的最终坐标必须来自该页实际 grammar handler，不能使用通用估算槽位。
- 页面级 design override 只用于 plan 已声明的背景/密度变化。
- 图表、表格与 icon 必须针对已有元素或明确数据执行；不得从文字臆造数值。

## 失败处理

- snapshot 不一致：停止，重生成 plan。
- 图片无法取得：改为 plan 声明的非图片 fallback 构图；不能保留空白图片框。
- 风格能力超出当前原生渲染器：退回 Design Agent 选择可执行方向，不静默降级成圆角卡片模板。

