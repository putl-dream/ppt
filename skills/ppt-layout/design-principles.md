# 设计原则（guizang 适配）

来源：[guizang-ppt-skill](https://github.com/op7418/guizang-ppt-skill)。本项目用 `applyLayout` + 固定 theme，以下为 Agent 应内化的约束。

## 通用（两种风格共享）

1. **克制优于炫技** — 装饰只在 creative 模式的 process/comparison 上少量追加
2. **结构优于装饰** — 靠 layout 枚举 + 字号层级，不靠手画坐标堆叠
3. **内容层级由位置定义** — `slide.title` 在页眉；画布只放 body；最大字号留给 cover
4. **节奏靠章节页** — `section` 与内容页交替，避免视觉疲劳
5. **术语统一** — 同一概念全文一种说法，不中英混译同一词
6. **少即是多** — 单条 ≤15 字，单页 ≤5 条；塞不下就拆页

## 风格 A · 电子杂志（template + nordic/sunset）

> 违反任一条，「商务感」会退化成普通 bullet 页。

1. 标题只在 `slide.title`，画布不放 fontSize≥36 文本
2. 第一条 body 可作 kicker，与 title 语义不重复
3. 并列观点用 `concept` 卡片，首条可 bold（引擎默认）
4. 数字结论用 `case` 右栏 accent 色放大
5. 章节用 `section` 居中，不在 section 页堆 5 条 bullet

## 风格 B · 瑞士/数据（template + ocean/midnight）

> 违反任一条，画面会从「信息设计」退回「默认 PPT」。

1. **单一 accent** — 一份 deck 一套 palette，不混搭多色高亮
2. **极致对比** — `case` 右栏数字是视觉锚点；concept 卡片间距统一（引擎 24px gap）
3. **网格至上** — 只用 `update-slide-layout`，禁止手动 x/y 微调正文
4. **数据专用版式** — KPI 必须用 `case`；排名列表用 `concept`；流程用 `process`
5. **直角卡片** — 不请求圆角/shadow（引擎矩形卡片即符合）
6. **演示可读** — body fontSize 由引擎设为 18–22；Agent 不压到更小

## 与 guizang 的差异（Agent 须知）

| guizang | 本项目 |
|---------|--------|
| 单文件 HTML + WebGL | Presentation JSON + SubmitCommands |
| 10/22 种 HTML 骨架 | 8 种 layout 枚举 |
| 主题 light/dark/hero | cover/section 作「呼吸页」 |
| 图片槽位 + GPT 配图 | 后期 `add-element` image；storyboard 阶段可标注「待图」 |
| validate-swiss-deck.mjs | `deck-review` + layout-validator |

HTML 专属规则（SVG 文字、WebGL、Motion 动效）**不适用**；等价检查见 [checklist.md](checklist.md)。
