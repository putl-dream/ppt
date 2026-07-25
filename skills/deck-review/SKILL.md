---
name: deck-review
description: 依据设计意图、硬性渲染规则和软性构图规则审查整套演示，并区分可自动修复与需重新设计的问题
when_to_use: layout-plan 执行后、整套换肤后、导出前或用户要求视觉审查时
stages:
  - style
  - export
---

# Deck 视觉审查（ppt-master-design-v2）

## 前提

先取得 `ReadPresentationSnapshot`、LayoutPlan v2、逐页缩略图和自动检查结果。没有渲染结果时，不把结构分数冒充视觉验收。

审查按以下顺序进行：

1. 硬性渲染错误
2. 设计意图是否兑现
3. 软性构图问题
4. 跨页节奏与一致性

## 硬性规则：命中即修

| 规则 | 问题 | 修复方向 |
|---|---|---|
| H1 | 元素越过 1280×720 画布 | 重排或缩放到画布内 |
| H2 | 文本溢出容器 | 调整布局、换行或在字号下限内缩小 |
| H3 | 两个正文/标题元素发生非语义重叠 | 打开间距或重排 |
| H4 | 小字对比度 <4.5；24px+ 对比度 <3.0；复杂图片上文字无 scrim | 调整语义色、位置或 scrim |
| H5 | 页眉、页码、来源等锚定元素缺失或被遮挡 | 恢复锚点 |
| H6 | 图片为空、损坏、严重变形或错误裁切主体 | 修复资产、objectFit 或 crop |
| H7 | layout-plan 声明的核心证据/图片/数据元素缺失 | 从 plan 恢复 |
| H8 | 图片仍是远程临时 URL，或 restricted license 被使用 | 本地化或替换 |

如果问题来自 deck-wide 颜色、字体或 visual style，不做单页补丁；标为设计系统级问题，一次性修复。

## 设计意图检查

逐页对照：

- `audienceMove` 是否真的由页面表达出来
- `layoutIntent` 指定的焦点是否是视觉最突出的元素
- `rhythm` 是否兑现
  - anchor：有清晰单一锚点
  - dense：高密度但仍可扫描
  - breathing：留白充分、元素克制
- 选择的 visual style 是否不只是换色，而是体现在形状、边框、阴影、留白、字体、背景、图片处理与构图
- argument mode 是否体现在标题语气和页面推进方式

## 软性规则：明显不好才改

| 规则 | 触发 |
|---|---|
| S1 | 同一文本块行距过紧或过空 |
| S2 | 本应共线的元素偏移 >4px |
| S3 | 同行卡片/图像间距不均 |
| S4 | 视觉重心明显偏离 layoutIntent |
| S5 | 一页出现过多无语义 accent、阴影或装饰 |
| S6 | 图片与 caption 距离过大，或图片与论点无关 |
| S7 | breathing 页出现卡片网格或过量正文 |
| S8 | 同类页面无理由地改变字体、圆角、边框或色彩语义 |

软修复以克制为原则；一次只改一个原因，不为追求分数引入新问题。

## 跨页检查

- 一套 deck 只有一个 argument mode、visual style、color scheme、reading mode。
- 5 页以上至少两种 rhythm。
- 不连续 3 页使用相同 layout + grammarVariant + rhythm。
- narrative / showcase 通常每 3–5 页有 breathing beat。
- anchor 页比例合理；不能每页都“重点”。
- 图片、图表和数字锚点分布服务叙事，不是平均撒满。
- safe / shifted / bold 只存在于设计候选阶段；执行后的 deck 只能有一个选定方向。

## 自动化

依次使用：

1. `ValidateDeckLayout`
2. `PreviewSlide`（逐页真实缩略图）
3. `DetectOverflowText`
4. `DetectRepeatedTitles`
5. `AnalyzeDeckConsistency`
6. visual asset audit

自动分数低于 70 需要解释，低于 55 通常是严重问题；但最终判断必须结合页面意图。

## 输出

```markdown
## 审查摘要
- 设计方向：argumentMode / visualStyle / colorScheme / readingMode
- 节奏：anchor N / dense N / breathing N
- 严重：N | 设计偏差：N | 建议：N

## 必须修复
1. [页码][规则] 证据 → 最小修复

## 设计偏差
1. [页码] plan 意图与实际呈现的差异

## 建议
1. ...

## 通过项
- ...
```

用户未授权修改时只报告；确认后才提交命令。

