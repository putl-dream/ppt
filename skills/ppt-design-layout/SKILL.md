---
name: ppt-design-layout
description: Design Agent 专责排版设计；读取 snapshot/storyboard，按 Rubric 产出 layout-plan.json，禁止 SubmitCommands
when_to_use: 内容草稿完成且用户已确认排版方式后，需要逐页版式/节奏/视觉层级设计决策时（阶段 4c）
allowed-tools:
  - ReadPresentationSnapshot
  - ListSlides
  - Task
---

# 排版设计专责（Design Agent）

## 角色定位

**只做设计决策，不做执行。** 在引擎能力边界内产出可执行的逐页 `layout-plan.json`；不改写文案、不手填坐标、不调用 SubmitCommands。

主 Agent 在阶段 4c 委派 Task 给本子 Agent；阶段 5 由主 Agent 按 plan 执行（LoadSkill `ppt-layout` Executor 模式）。

## 输入

1. `ReadPresentationSnapshot` 或 workspace `slides/storyboard.json`（完整路径时）
2. 用户 LayoutChoiceCard 选择：`template`（标准）或 `creative`（轻装饰）
3. 可选：`brief.md` 受众与场景

## 输出

写入 workspace **`slides/layout-plan.json`**，格式见下。Task 结论仅 1–3 句：路径 + layout 种类数 + 关键设计决策。

## layout-plan 格式

```json
{
  "version": 1,
  "theme": "ocean",
  "palette": "cyan",
  "styleMode": "template",
  "designNotes": "可选：整体节奏说明",
  "slides": [
    {
      "slideId": "slide-1",
      "title": "演示标题",
      "narrativeRole": "cover",
      "layout": "cover",
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

## 设计 Rubric（必过 A + B，强烈建议 C）

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

### E. 反模式（出现即 redesign）

| 反模式 | 应改为 |
|--------|--------|
| 趋势页用 concept 四栏 | process 或 case + chart |
| cover 后无 section/toc | 第 2 页 toc；大章前 section |
| 案例页两栏文字 | case + beautify-chart |
| 全程同色同构 | slideVariant 交替 |

## Task 委派模板（主 Agent 使用）

```
LoadSkill ppt-design-layout，然后 Task：
「读取当前 presentation snapshot（或 slides/storyboard.json）。
按 ppt-design-layout Rubric 为每页选定 layout、slideVariant、enhancements。
用户选择排版方式：{template|creative}。
写入 slides/layout-plan.json。
禁止 SubmitCommands；只输出 layout-plan + 1 句设计摘要。」
```

## 禁止事项

- ❌ SubmitCommands / update-slide-layout / set-theme
- ❌ 改写 slide.title 或 body text
- ❌ 手填 x/y 坐标
- ❌ 长篇分析（结论 ≤3 句）

## 验收自检（写入 plan 前）

1. layout 种类：7 页 deck ≥3，10 页 ≥5
2. 无连续 3 页同 layout
3. 含 KPI 的 deck 至少 1 页 case 或 beautify-chart
4. 7 页+ 商务 deck 含 toc
5. slideVariant 至少 2 种（5 页+ deck）

## 延伸阅读

- 版式映射：[../ppt-layout/layout-catalog.md](../ppt-layout/layout-catalog.md)
- 风格模式：[../ppt-layout/style-modes.md](../ppt-layout/style-modes.md)
- 设计原则：[../ppt-layout/design-principles.md](../ppt-layout/design-principles.md)
- 示例 plan：`tests/fixtures/layout-plan-tech-evolution.json`
