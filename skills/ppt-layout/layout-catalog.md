# 内容 → 版式映射

Agent 在 storyboard 或排版阶段为每页选择 `layout` 时使用本表。设计思路融合 [guizang-ppt-skill](https://github.com/op7418/guizang-ppt-skill)（见 `style-modes.md`）。

## 决策流程

```
这页要做什么？
├─ 开场/封底 ────────────── cover
├─ 章节切换 ────────────── section
├─ 并列要点（无顺序）──── concept
├─ A vs B / 前后对比 ───── comparison（偶数条）
├─ 步骤 / 时间线 ───────── process（2–4 步）
├─ 分层 / 架构 ─────────── architecture
├─ 故事 + 关键数字 ─────── case（恰好 2 条）
├─ 目录 / 议程 ─────────── toc（3–8 项）
├─ 金句 / 引言 ─────────── quote（1–2 条）
├─ 多图展示 ────────────── image-grid（2–4 图）
└─ 收束 / 行动项 ───────── summary
```

## 详细映射

| 用户意图 / 内容形态 | layout | body 元素准备 |
|---------------------|--------|---------------|
| 演示标题、人名、日期 | cover | 0–1 条副标题 text |
| 「第一部分」「背景介绍」 | section | 0–1 条引导语 |
| 3–4 个并列优势/功能 | concept | 每条要点独立 text |
| 目录 3–5 项（无层级） | concept 或 **toc** | toc 带序号；concept 为卡片风 |
| 方案 A vs 方案 B | comparison | 左列 0,2,4… 右列 1,3,5… |
| 实施步骤、里程碑年份 | process | 每步一条，2–4 步 |
| 技术栈分层、组织架构 | architecture | 每层一条，2–4 层 |
| 案例描述 + 转化率/增长率 | case | 第 1 条叙述，第 2 条数字；可选 1 张图片落入 `side` 槽 |
| 目录 3–8 项（带序号） | toc | 每项一条；自动编号圆 |
| 金句 / 引言 / 座右铭 | quote | 第 1 条金句，第 2 条可选署名 |
| 产品图 / 截图网格 | image-grid | 2–4 张 image；可选 caption text |
| 总结、下一步、Q&A 提纲 | summary | 3–5 条 |

## 反模式（避免）

| 错误 | 正确做法 |
|------|----------|
| 5 个步骤用 concept | 改用 process |
| 3 个指标并排用 case | case 仅 2 条；第 3 个另起一页 concept |
| 把标题写进画布 text | 只写 slide.title |
| 多条要点塞进一个 text | 每条独立 element |
| comparison 只有 3 条 | 补第 4 条或改 concept |
| 封面堆 5 条 bullet | cover 最多 1 条副标题 |

## 按页型示例（简约商务）

| 页 | 标题示例 | layout | 要点示例 |
|----|----------|--------|----------|
| 1 | 年中工作汇报 | cover | 部门名称 |
| 2 | 目录 | **toc** | 上半年情况 / 问题方案 / 下半年计划 |
| 3 | 上半年工作情况 | section | — |
| 4 | 核心成果 | concept | 成果一 / 成果二 / 成果三 |
| 5 | 增长趋势 | process | 2022 / 2023 / 2024 |
| 6 | 关键指标 | case | 项目说明 / 76% |
| 7 | 问题与方案 | comparison | 问题A / 方案A / 问题B / 方案B |
| 8 | 总结 | summary | 要点一 / 要点二 / 要点三 |

## 按页型示例（商务汇报）

| 页 | 标题示例 | layout | 要点示例 |
|----|----------|--------|----------|
| 1 | 个人竞聘汇报 | cover | 心所至 梦必达 |
| 2 | 目录 | concept | 个人情况 / 工作成果 / 岗位认知 / 未来规划 |
| 3 | 个人情况介绍 | section | — |
| 4 | 自我介绍 | concept | 精炼自我介绍要点（可拆多条） |
| 5 | 工作成果展示 | section | — |
| 6 | 成果数据 | case | 成果概述 / 89% |
| 7 | 未来工作规划 | section | — |
| 8 | 行动计划 | process | Q1 / Q2 / Q3 / Q4 |
| 9 | 结语 | summary | 感谢 / 期待 / 联系方式 |

## 图片槽位（P0）

`applyLayout` 会自动将 slide 中的 `image` 元素放入预留区域，并写入 `imageSlot` 元数据。Agent 在内容阶段添加图片即可，无需手填坐标。

| layout | 槽位名 | 位置 | 说明 |
|--------|--------|------|------|
| `cover` | `hero` | 页底横幅 | 单张主视觉；无图则跳过 |
| `case` | `side` | 右栏卡片内 | 有图时优先于 metric 数字 |
| `concept` | `grid-0` … `grid-3` | 各卡片底部 | 按列索引分配，与 body 文本一一对应 |
| `image-grid` | `grid-0` … `grid-3` | 2×2 或自适应网格 | 2–4 图；可用 InsertSlideImage |
| `toc` | — | 无图片槽 | 纯文本 + 序号圆 |

图片字段：`objectFit` 默认 `cover`，可设为 `contain`。Agent 用 **InsertSlideImage** 插入，无需手填 x/y。

## P1 工具

| 工具 | 用途 |
|------|------|
| InsertSlideImage | 图片入槽（side/hero/grid-N） |
| AddLayoutDecorations | creative 模式装饰 |
| ApplyTypography | 全 deck 字体角色同步 |
| PreviewSlide | 排版后视觉摘要 |
| ValidateDeckLayout | 节奏/多样性自动校验 |

## 文本角色（P0）

排版后 `applyLayout` 为 text 元素写入 `textRole` 与 `fontFamily`（可被 `update-text-style` 覆盖）。

| textRole | 典型用途 | 字体策略 |
|----------|----------|----------|
| `kicker` | 章节引导、卡片首条 | sans；midnight 主题为 mono |
| `body` | 正文要点 | sans |
| `metric` | KPI 大数字（case 右栏） | sans；midnight 为 mono |
| `caption` | 页脚注释、来源 | sans / mono |

封面/章节大标题使用 `fontFamily`（nordic/sunset → serif，ocean 等 → sans），不设 textRole。

## 背景变体（P0-3）

| layout | 自动 backgroundVariant |
|--------|------------------------|
| cover、section | `hero` |
| 其余 | `default` |

命令：`{"type":"set-slide-background","slideId":"...","backgroundVariant":"muted"}`

## P2 元素类型（chart / table / icon）

排版阶段可通过 `add-element` 或 Beautify* 工具添加数据可视化元素。

| 元素 | chartType / 字段 | 典型 layout | 工具 |
|------|------------------|-------------|------|
| chart | bar, h-bar, timeline, kpi-tower | case, process | BeautifyChart |
| table | rows, headerRow, zebraStripe | concept, summary | BeautifyTable |
| icon | name（24 内置 Lucide 兼容名） | toc, concept | add-element |

**BeautifyChart**（P2）：将 case 页 metric 文本或 KPI 数据转为 chart 元素（SVG 渲染，PPTX 导出为图片）。

**BeautifyTable**（P2）：将 `|` 分隔文本或结构化数据转为 table 元素。

**slideVariant 命令**：

```json
{"type":"update-slide-variant","slideId":"slide-1","slideVariant":"hero"}
```

layout-plan.enhancements 中 `beautify-chart` / `beautify-table` / `add-icon` 由 Executor 经 ExecuteExtraTool 执行。
