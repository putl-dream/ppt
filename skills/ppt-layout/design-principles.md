# 设计原则与 Rubric（guizang 适配）

来源：[guizang-ppt-skill](https://github.com/op7418/guizang-ppt-skill)。本项目用 `applyLayout` + 固定 theme + layout-plan 设计流程。

**好设计 = 满足下方 Rubric A–D + 通过 ValidateDeckLayout。**

Design Agent（`ppt-design-layout`）与 deck-review 共用本 Rubric。

---

## A. 叙事与节奏（必过）

| # | 标准 | 坏例子 | 好做法 |
|---|------|--------|--------|
| A1 | 有 **cover + summary** | 直接内容页开始/结束 | 首尾齐全 |
| A2 | 8 页+ 至少 **1 个 section** | 7 页全为 concept 卡片 | 每大章前 section 呼吸 |
| A3 | **无连续 3 页同 layout** | 趋势一/二均为 concept 四栏 | 交替 process / concept / case |
| A4 | 7 页+ ≥3 种 layout；10 页+ ≥5 种 | 全程 concept + summary | 见 layout-catalog 示例 deck |
| A5 | **slideVariant 有变化** | 全 deck 同一深色底 | cover/section→hero；正文→light；quote→dark |

## B. 版式与内容匹配（必过）

| 内容类型 | 应选 layout | 禁止 |
|----------|-------------|------|
| 开场标题 | `cover` | concept 堆标题 |
| 章节目录 | `toc` | 7 页+ 商务 deck 无目录 |
| 章节切换 | `section` | 用 concept 假装章节 |
| 并列要点（无顺序） | `concept` | 误用 process |
| 步骤 / 时间线 / 阶段 | `process` | 误用 concept 横排 |
| 叙述 + 关键数字 | `case` | 四栏 concept 均分文字 |
| 机遇 vs 挑战 / A vs B | `comparison` | 两栏 concept 文字框 |
| 多图展示 | `image-grid` | 纯文字 concept |
| 金句 / 引言 | `quote` | section 堆长段 |
| 收束 / Q&A | `summary` | concept 重复 |

## C. 视觉层级（强烈建议）

| # | 标准 | 引擎手段 |
|---|------|----------|
| C1 | 每 deck **1–2 个 KPI 锚点页** | `case` + metric / BeautifyChart → kpi-tower |
| C2 | 数据趋势页有**图形表达** | chart（bar / timeline），非四条等宽文本框 |
| C3 | 对比页**左右语义清晰** | comparison 偶数条，左问题右方案 |
| C4 | 关键列表有**序号或 icon** | toc 序号圆；可选 icon 元素 |
| C5 | 标题只在 **slide.title** | 画布无 fontSize≥36 重复标题 |

## D. 克制与一致性（必过）

| # | 标准 | 适用阶段 |
|---|------|----------|
| D1 | 全 deck **一套 theme + palette** | 设计 + 执行 |
| D2 | 单条 ≤15 字，单页 ≤5 条 | **内容草稿 / deck-review**（设计阶段不管） |
| D3 | creative 装饰仅 process/comparison，每页 shape ≤3 | 执行 |
| D4 | 不手填 x/y；依赖 layout + InsertSlideImage 槽位 | 设计 + 执行 |

## E. 反模式清单（出现即需 redesign）

| 反模式 | 问题 | 应改为 |
|--------|------|--------|
| **Concept 滥用** | 趋势一/二均为四栏 concept | 阶段感→`process`；数字感→`case` + chart |
| **无 section** | cover 后直连内容 | 大章前加 `section` |
| **案例页无 KPI** | 行业案例两栏文字 | `case`：左叙述 + 右 metric/chart |
| **总结无层级** | summary 与 concept 同构 | `summary` + 左 accent 竖条 |
| **全程同色同构** | 每页同一深色+矩形框 | slideVariant：hero / light / dark 交替 |
| **无 toc** | 多页商务 deck 无目录 | 第 2 页 `toc` |

---

## 通用（两种风格共享）

1. **克制优于炫技** — 装饰只在 creative 模式的 process/comparison 上少量追加
2. **结构优于装饰** — 靠 layout 枚举 + 字号层级，不靠手画坐标堆叠
3. **内容层级由位置定义** — `slide.title` 在页眉；画布只放 body
4. **节奏靠章节页** — `section` 与内容页交替，避免视觉疲劳
5. **术语统一** — 同一概念全文一种说法
6. **少即是多** — 单条 ≤15 字，单页 ≤5 条

## 风格 A · 电子杂志（template + nordic/sunset）

1. 标题只在 `slide.title`，画布不放 fontSize≥36 文本
2. 第一条 body 可作 kicker，与 title 语义不重复
3. 并列观点用 `concept` 卡片
4. 数字结论用 `case` 右栏 accent 色放大
5. 章节用 `section` 居中

## 风格 B · 瑞士/数据（template + ocean/midnight）

1. **单一 accent** — 一份 deck 一套 palette
2. **极致对比** — `case` 右栏数字是视觉锚点
3. **网格至上** — 只用 `update-slide-layout`，禁止手动 x/y
4. **数据专用版式** — KPI 用 `case` + chart；流程用 `process`
5. **演示可读** — body fontSize 18–22，Agent 不压更小

## 与 guizang 的差异（Agent 须知）

| guizang | 本项目 |
|---------|--------|
| 单文件 HTML + WebGL | Presentation JSON + layout-plan + SubmitCommands |
| 10/22 种 HTML 骨架 | 11 种 layout 枚举 |
| 主题 light/dark/hero | slideVariant + cover/section 呼吸页 |
| 图片槽位 + GPT 配图 | InsertSlideImage 入槽 |
| validate-swiss-deck.mjs | `deck-review` + ValidateDeckLayout |

HTML 专属规则（SVG 文字、WebGL、Motion 动效）**不适用**；等价检查见 [checklist.md](checklist.md)。
