# PPT 样式能力现状与后续计划

> 版本：2026-07-04  
> 状态：**P0–P2 引擎最小化实现已完成**；**Agent 排版设计角色缺失**是当前主要瓶颈  
> 关联：[ppt-style-capability-plan.md](./ppt-style-capability-plan.md)（原始分阶段方案）

---

## 1. 执行摘要

原始方案 P0 / P1 / P2 的**引擎与 Agent Deferred Tools 已基本落地**，可支撑 Agent 稳定产出「统一主题的商务卡片风 PPT」（约 10 页：cover、toc、section、case、process、comparison、summary 等）。

当前实现定位为 **最小可用（MVP）**：核心数据模型、layout 引擎、渲染、PPTX 导出、Agent 工具链已通，但与参考模板 / guizang 的视觉等价、Skill 文档同步、部分 UI 入口、截图预览等仍有差距。

**与 §1 目标的对应关系**：

| 目标 | 现状 |
|------|------|
| 接近参考商务 PPT（简约商务、商务汇报） | ✅ 语义 layout + 主题 + 卡片风，可交付 |
| 像素级等价参考 `.pptx` 模板 | ❌ 未达成 |
| guizang HTML/WebGL 全栈 | ❌ 非目标；仅基础 HTML 导出 |
| 22+ 瑞士版式 | ❌ 非目标；11 种语义 layout |
| **排版设计有专责 Agent** | ❌ **未达成——当前最大体验瓶颈** |

### 1.1 核心瓶颈：排版设计无专责 Agent

#### 现象

引擎与工具链（P0–P2）已具备多种 layout、主题、chart/table/icon 等能力，但**主 Agent 在视觉阶段仍独自承担「选版式 + 定风格 + 执行排版 + 自检」**，常出现：

| 症状 | 典型表现 |
|------|----------|
| **思考过多、产出平庸** | 大量推理步骤，最终 deck 仍像「统一色系的 bullet 卡片页」 |
| **版式单调** | 连续多页 `concept` 四栏卡片，趋势页、案例页、总结页结构雷同 |
| **节奏缺失** | 无 `section` 章节呼吸页；cover 后直接堆内容页 |
| **版式与内容错配** | 并列趋势用 concept，而非 process；数据亮点无 `case` / chart |
| **视觉层级扁平** | 所有要点等权矩形框，无 KPI 锚点、无对比结构、无 icon/chart 点缀 |
| **主题只用、不会** | 全程同一 theme + 同一背景，未用 slideVariant 做 light/dark/hero 交替 |

**根因**：不是引擎能力不足，而是 **缺少独立的「排版设计」决策层**。主 Agent 系统 prompt 偏全流程通用助手；设计原则散落在 `skills/ppt-layout/design-principles.md`，**未形成可执行的专责角色与验收 Rubric**。主 Agent 在排版阶段容易「边想边做」，难以稳定产出接近参考模板的设计。

**用户案例（2025 技术演进与商业落地，7 页）**：cover → section 过渡页 → 趋势一/二（均为 concept 四栏）→ 机遇挑战（两栏文字）→ 行业案例（两栏文字）→ 总结（四横条）。问题：无 toc、无 section 大章分隔、趋势页应 process/case、案例页缺 KPI 结构、全程同色同构——**引擎能做得更好，但 Agent 未做设计决策**。

#### 当前 Agent 分工（问题所在）

```
┌─────────────────────────────────────────────────────────────┐
│ 主 Agent                                                     │
│  内容草稿 → 选 theme → 批量 update-slide-layout → 自检       │
│  ↑ 设计决策与执行混在一起；无独立 design pass                  │
└─────────────────────────────────────────────────────────────┘
         │ LoadSkill ppt-layout / ppt-design（被动、碎片化）
         ▼
┌─────────────────────────────────────────────────────────────┐
│ ppt-design   → 仅 set-theme，无版式/节奏/层级设计              │
│ ppt-layout   → 执行排版命令，假设 layout 已选对              │
│ ppt-beautify → 事后修补，非设计阶段                          │
│ deck-review  → 质检报告，不参与设计决策                      │
└─────────────────────────────────────────────────────────────┘
```

`ppt-workflow` 阶段 5 由主 Agent 直接 LoadSkill `ppt-layout` 并 SubmitCommands，**没有「先出设计方案、再执行」的 Design Agent 步骤**。

#### 目标态：Design Agent 专责排版设计

```
内容草稿完成 + 用户确认排版方式
        ↓
┌───────────────────┐
│  Design Agent     │  ← 新增专责角色（Task 委派）
│  输入：snapshot   │
│  输出：layout-plan│  每页 layout / variant / 元素类型 / 节奏
└─────────┬─────────┘
          ↓
┌───────────────────┐
│  Layout Executor  │  ← 主 Agent 或轻量子 Agent
│  只执行 plan      │  set-theme + update-slide-layout + Beautify*
└─────────┬─────────┘
          ↓
┌───────────────────┐
│  deck-review      │  对照 Rubric 验收
└───────────────────┘
```

**Design Agent 不做**：改写文案、手填坐标、长篇分析。  
**Design Agent 只做**：在引擎能力边界内，产出可执行的**逐页设计决策表**。

---

### 1.2 什么是「好的排版设计」（Agent 设计 Rubric）

以下标准供 Design Agent 与 deck-review 共用。**好设计 = 满足 Rubric + 通过 ValidateDeckLayout**。

#### A. 叙事与节奏（必过）

| # | 标准 | 坏例子 | 好做法 |
|---|------|--------|--------|
| A1 | 有 **cover + summary** | 直接内容页开始/结束 | 首尾齐全 |
| A2 | 8 页+ 至少 **1 个 section** | 7 页全为 concept 卡片 | 每大章前 section 呼吸 |
| A3 | **无连续 3 页同 layout** | 趋势一/趋势二均为 concept 四栏 | 交替 process / concept / case |
| A4 | 10 页+ 至少 **5 种 layout** | 全程 concept + summary | 见 layout-catalog 示例 deck |
| A5 | **slideVariant 有变化** | 全 deck 同一深色底 | cover/section→hero；正文→default；quote→muted |

#### B. 版式与内容匹配（必过）

| 内容类型 | 应选 layout | 禁止 |
|----------|-------------|------|
| 开场标题 | `cover` | concept 堆标题 |
| 章节目录 | `toc` 或 `concept` | 7 页+ 商务 deck 无目录 |
| 章节切换 | `section` | 用 concept 假装章节 |
| 并列要点（无顺序） | `concept` | 误用 process |
| 步骤 / 时间线 / 阶段 | `process` | 误用 concept 横排 |
| 叙述 + 关键数字 | `case` | 四栏 concept 均分文字 |
| 机遇 vs 挑战 / A vs B | `comparison` | 两栏 concept 文字框 |
| 多图展示 | `image-grid` | 纯文字 concept |
| 金句 / 引言 | `quote` | section 堆长段 |
| 收束 / Q&A | `summary` | concept 重复 |

#### C. 视觉层级（强烈建议）

| # | 标准 | 引擎手段 |
|---|------|----------|
| C1 | 每 deck **1–2 个 KPI 锚点页** | `case` + metric / BeautifyChart → kpi-tower |
| C2 | 数据趋势页有**图形表达** | chart（bar / timeline），非四条等宽文本框 |
| C3 | 对比页**左右语义清晰** | comparison 偶数条，左问题右方案 |
| C4 | 关键列表有**序号或 icon** | toc 序号圆；可选 icon 元素 |
| C5 | 标题只在 **slide.title** | 画布无 fontSize≥36 重复标题 |

#### D. 克制与一致性（必过）

| # | 标准 |
|---|------|
| D1 | 全 deck **一套 theme + palette** |
| D2 | 单条 ≤15 字，单页 ≤5 条 |
| D3 | creative 装饰仅 process/comparison，每页 shape ≤3 |
| D4 | 不手填 x/y；依赖 layout + InsertSlideImage 槽位 |

#### E. 反模式清单（出现即需 redesign）

| 反模式 | 问题 | 应改为 |
|--------|------|--------|
| **Concept 滥用** | 趋势一/二均为四栏 concept | 阶段感→`process`；数字感→`case` + chart |
| **无 section** | cover 后直连内容 | 大章前加 `section` |
| **案例页无 KPI** | 行业案例两栏文字 | `case`：左叙述 + 右 metric/chart |
| **总结无层级** | summary 与 concept 同构 | `summary` + 左 accent 竖条 |
| **全程同色同构** | 每页同一深色+矩形框 | slideVariant：hero / default / muted 交替 |
| **无 toc** | 多页商务 deck 无目录 | 第 2 页 `toc` |

**验收一句话**：扫一眼缩略图，应能区分「封面 / 章节 / 数据页 / 对比页 / 总结」，而不是「每页都像同一模板填不同字」。

---

## 2. 分阶段实现对照

### 2.1 P0 — 全部达标 ✅

| # | 能力 | 实现 | 测试 |
|---|------|------|------|
| P0-1 | Layout 内置图片槽 | `layout.ts`、`imageSlot`/`objectFit` | `tests/layout.test.ts` |
| P0-2 | 文本样式角色 | `textRole`、`fontFamily`；theme 驱动字体 | `tests/layout.test.ts` |
| P0-3 | 按页背景变体 | `backgroundVariant` + `set-slide-background` | `tests/slide-background.test.ts` |
| P0-4 | BeautifyChart / BeautifyTable | 返回可执行 commands（P2 后升级为 chart/table 元素） | `tests/beautify-tools.test.ts` |
| P0-5 | Shape 渲染对齐 | `ShapeElementView.tsx`、`ppt-exporter.ts` | `tests/ppt-exporter.test.ts` |

**P0 验收**：文档 5 条标准均已满足。

---

### 2.2 P1 — 基本达标，1 项有落差 ⚠️

| # | 能力 | 状态 | 说明 |
|---|------|------|------|
| P1-1 | 扩展 layout（toc / quote / image-grid） | ✅ | `tests/p1-layout.test.ts` |
| P1-2 | AddLayoutDecorations | ✅ | `add-layout-decorations.ts` |
| P1-3 | InsertSlideImage | ✅ | 槽位 + 比例；无需手填 x/y |
| P1-4 | ApplyTypography | ✅ | 批量 `update-text-style` |
| P1-5 | PreviewSlide | ⚠️ | **结构化 JSON 摘要**，非截图 / 缩略图 IPC |

**P1 验收**：10 页商务 deck、KPI 页、InsertSlideImage 入槽、ValidateDeckLayout 节奏校验 — 均可达成。

**落差**：Agent 无法「看到」真实像素级缩略图，只能读 layout / 槽位 / 元素坐标摘要。

---

### 2.2 P2 — 引擎已建，部分为最小实现 ⚠️

| # | 能力 | 文档 | 实际 | 差距 |
|---|------|------|------|------|
| P2-1 | Slide variant | ✅ | `slideVariant` + `update-slide-variant` | 无专用 Agent 工具；Skill 未文档化 |
| P2-2 | Chart 元素 | ✅ | bar / h-bar / timeline / kpi-tower + SVG | PPTX 导出为 SVG 位图；视觉偏简易 |
| P2-3 | Icon 元素 | ✅ | 24 个内置 Lucide 兼容图标 | 非完整 Lucide；UI 不能手动添加 |
| P2-4 | Table 元素 | ✅ | 行列 + 斑马纹 + PPTX 表格 | 基本达标 |
| P2-5 | HTML 导出 | ✅ | `exportToHtml()` + `.html` 分支 | 基础 HTML，非 guizang 桥接；UI / ExportPptx 未暴露 |
| P2-6 | Layout 注册表 | ✅ | `layout-registry.ts` 元数据 | handler 仍在 `layout.ts` 单体，未真正插件化 |

---

## 3. 数据模型与命令 — 草案 vs 实现

### 3.1 已实现 ✅

```typescript
// TextElement (P0-2)
textRole?: "kicker" | "body" | "metric" | "caption";
fontFamily?: "serif" | "sans" | "mono";

// Slide (P0-3 / P2-1)
backgroundVariant?: "default" | "hero" | "muted";
slideVariant?: "light" | "dark" | "hero";

// ImageElement (P0-1)
imageSlot?: string;
objectFit?: "cover" | "contain";

// 新元素类型 (P2)
type: "chart" | "table" | "icon";
```

### 3.2 未按草案独立实现的命令

| 草案 Command | 实际路径 |
|--------------|----------|
| `insert-image-into-slot` | 由 **InsertSlideImage** 工具生成 `add-element` / `update-element` |
| `add-layout-decorations` | 由 **AddLayoutDecorations** 工具生成 shape commands |
| `update-text-role` | 合并进 `update-text-style` |

### 3.3 草案与实现的差异

- 草案 `backgroundVariant` 含 `"dark"` → 实际用 `slideVariant: "dark"` 表达
- ExportPptx 工具仅支持 `pptx` / `pdf`（pdf 仍不支持），**不含 html**

---

## 4. Agent 工具注册状态

| 工具 | 阶段 | 注册 | 备注 |
|------|------|------|------|
| ApplyThemeStyle | 已有 | ✅ | |
| AutoLayoutSlide | 已有 | ✅ | |
| SelectStyleStrategy | 已有 | ✅ | |
| BeautifyChart | P0→P2 | ✅ | P2 后：文本 KPI → chart 元素 |
| BeautifyTable | P0→P2 | ✅ | P2 后：`\|` 分隔文本 → table 元素 |
| InsertSlideImage | P1 | ✅ | |
| AddLayoutDecorations | P1 | ✅ | |
| ApplyTypography | P1 | ✅ | |
| PreviewSlide | P1 | ✅ | 结构化摘要，非截图 |
| ValidateDeckLayout | P1 | ✅ | |
| ExportPptx | 已有 | ✅ | 仅 pptx；不含 html |

**缺失（可选）**：`UpdateSlideVariant` 专用工具（当前需手写 `update-slide-variant` command）。

---

## 5. Skill 与文档同步状态 ⚠️

文档原则（原方案 §6）：**Skill 只描述已有引擎能力**。

| 资产 | 状态 | 问题 |
|------|------|------|
| `skills/ppt-layout/layout-catalog.md` | ✅ P0/P1 | 缺 P2 chart/table/icon/slideVariant |
| `skills/ppt-layout/style-modes.md` | ⚠️ | 第 31 行仍写「concept 暂无 image 槽位」——已过时 |
| `skills/ppt-layout/checklist.md` | ⚠️ | 「P2」指文案密度，与引擎 P2 无关 |
| `skills/ppt-beautify/SKILL.md` | ⚠️ | 未描述 chart/table/icon 元素能力 |
| `skills/deck-review/SKILL.md` | ⚠️ | 未含 P2 元素类型审查项 |
| `docs/ppt-style-capability-plan.md` | ⚠️ | 顶部仍标「规划」；§2 能力评估未刷新 |

**影响**：Agent 可能不知道可使用 chart / table / icon / slideVariant，引擎能力调用不稳定。

---

## 6. 原缺口（§2.3）修复情况

| 原缺口 | 严重度 | 现状 |
|--------|--------|------|
| 衬线标题 + 无衬线正文 + 等宽 meta | 高 | ✅ P0-2 |
| 每页 light/dark/hero 背景节奏 | 中 | ✅ P2-1 |
| 左文右图、图片网格、主视觉图 | 高 | ✅ P0-1 + P1 image-grid |
| KPI 塔、横条图、可视化时间轴 | 高 | ✅ P2-2（简化 SVG） |
| 表格 | 中 | ✅ P2-4 |
| 图标（Lucide 等） | 中 | ⚠️ 24 内置，非全量 |
| 目录页、编号徽章、装饰线 | 中 | ✅ P1 toc + AddLayoutDecorations |
| arrow/line shape 视觉 | 低 | ✅ P0-5 |
| 22+ 瑞士 / 10 杂志 HTML 版式 | 中 | ❌ 11 种语义 layout（非目标） |
| 入场动效 | 低 | ❌ 不支持（非目标） |

---

## 7. 当前可稳定交付的能力

以下场景 **Agent + 引擎已可闭环**：

1. **10 页商务 deck**：cover → toc → section×N → concept / case / process / comparison → summary  
2. **KPI 页**：`case` layout + metric 文本，或 BeautifyChart 转 kpi-tower chart  
3. **图文页**：InsertSlideImage 入槽（side / hero / grid-N），无需坐标  
4. **主题与页级节奏**：5 theme × 4 palette；`backgroundVariant`；`slideVariant` light/dark/hero  
5. **数据元素**：chart / table / icon 经 `add-element` 或 Beautify* 工具  
6. **程序化质检**：ValidateDeckLayout、deck-review + checklist P0/P1  
7. **导出**：PPTX（含 chart/table/icon）；JSON；HTML（`DeckExportService` 指定 `.html` 路径）

---

## 8. 已知限制（最小实现边界）

| 限制 | 说明 |
|------|------|
| 视觉精度 | 卡片风 + 语义 layout，非参考模板像素级 |
| Chart 导出 | SVG  rasterize 为图片，非 PPTX 原生图表 |
| Icon 覆盖 | 24 个内置名，非 npm lucide 全库 |
| Layout 注册表 | 仅元数据；`applyLayout` 仍为 ~670 行单体 |
| PreviewSlide | JSON 摘要，Agent 不能「看」缩略图 |
| HTML 导出 | 自研简单模板，非 guizang 桥接 |
| UI 入口 | 画布仅 text/image/shape 手动添加；chart/table/icon 仅 Agent 路径 |
| ExportPptx 工具 | 不支持 html；pdf 未实现 |
| Skill 滞后 | P2 能力未写入 Agent Skill，调用依赖模型自行推断 |
| **无 Design Agent** | 主 Agent 兼设计+执行，易过度思考且版式单调 |
| **设计 Rubric 未落地** | 原则在 design-principles.md，未绑定 Task/Skill/验收 |

---

## 9. 后续计划（建议优先级）

> **最高优先级**：Phase E（Design Agent）解决「引擎够用、设计不理想」的主矛盾；Phase A 与之并行推进 Skill/Rubric 落地。

### Phase E — Design Agent 专责排版设计（最高优先级，1–2 迭代）

> 目标：将「什么是好设计」从主 Agent 推理中剥离，形成**先设计、后执行**的固定流程。

| # | 任务 | 产出 | 说明 |
|---|------|------|------|
| E-1 | 新建 `skills/ppt-design-layout/SKILL.md` | Design Agent 专责 Skill | 内含 §1.2 Rubric、layout-plan 输出格式、禁止事项 |
| E-2 | 定义 `layout-plan` 产物 | `slides/layout-plan.json` 或扩展 storyboard | 每页：`layout`、`slideVariant`、`theme`（deck 级）、`enhancements`（chart/icon/InsertSlideImage） |
| E-3 | 升级 `ppt-workflow` | 阶段 4c Design + 5 Execute 分离 | 主 Agent Task 委派 Design Agent；自身只做 Executor |
| E-4 | Design 专用子 Agent prompt | `sub-system-prompt` 或 Task description 模板 | **禁止** SubmitCommands；**只** 输出 layout-plan + 简短设计说明 |
| E-5 | Layout Executor  checklist | 嵌入 `ppt-layout` | 严格按 plan 执行；不得擅自改 layout |
| E-6 | deck-review 对齐 Rubric | `deck-review/SKILL.md` | 增加 §1.2 A–E 检查项；与 ValidateDeckLayout 合并报告 |
| E-7 | 示例 layout-plan | 文档 + 测试 fixture | 含「技术演进」类 deck 的 redesign 对照（concept 滥用→process/case/toc） |

**layout-plan 单页字段（草案）**：

```json
{
  "slideId": "...",
  "title": "趋势一：大模型规模化",
  "narrativeRole": "content",
  "layout": "process",
  "slideVariant": "default",
  "rationale": "四条为演进阶段，非并列概念",
  "enhancements": []
}
```

**验收**：

1. 同一内容草稿，经 Design Agent 后 layout 种类 ≥3（7 页 deck ≥3）
2. 含 KPI/案例的 deck 至少 1 页 `case` 或 chart
3. 主 Agent 排版阶段模型调用步骤数下降（设计决策不再重复推理）
4. deck-review Rubric A1–A5 通过率提升

---

### Phase A — 文档与 Skill 同步（高 ROI，1 迭代）

> 目标：让 Agent 稳定调用已有引擎能力，避免「实现了但用不了」。

| # | 任务 | 产出 |
|---|------|------|
| A-1 | 更新 `layout-catalog.md` | 增加 P2：chart/table/icon、slideVariant 用法与示例 commands |
| A-2 | 修正 `style-modes.md` | 删除过时「无 image 槽位」；补充 slideVariant 与 guizang 节奏映射 |
| A-3 | 更新 `ppt-beautify/SKILL.md` | BeautifyChart/Table 新行为（转元素而非仅改样式） |
| A-4 | 更新 `checklist.md` | 区分「文案 P2」与「引擎 P2」；增加 chart/table 检查项 |
| A-5 | 刷新 `ppt-style-capability-plan.md` | 状态改为「P0–P2 引擎已实现」；§2 能力评估对齐现状 |
| A-6 | 更新 `deck-review/SKILL.md` | 增加 P2 元素类型与 slideVariant 审查 |
| A-7 | 将 §1.2 Rubric 写入 `design-principles.md` | 与 Design Agent Skill 单一来源 |

**验收**：LoadSkill `ppt-design-layout` + `ppt-layout` 后，Agent 可正确选用 chart/table/icon/slideVariant，并按 Rubric 选 layout。

---

### Phase B — 工具与导出打通（中 ROI，1 迭代）

| # | 任务 | 说明 |
|---|------|------|
| B-1 | ExportPptx 支持 `html` format | 或新增 ExportHtml deferred tool |
| B-2 | 可选：`UpdateSlideVariant` 工具 | 简化 Agent 调用页级节奏 |
| B-3 | UI 导出对话框 | 支持 `.html` 选项（若产品需要网页 PPT） |

**验收**：Agent 或用户可一键导出 HTML，无需手写文件路径。

---

### Phase C — 预览与体验补强（按需，1–2 迭代）

| # | 任务 | 说明 |
|---|------|------|
| C-1 | PreviewSlide 缩略图 | 截图 API 或 renderer IPC 返回 base64 PNG |
| C-2 | UI 添加 chart/table/icon | 画布工具栏扩展元素类型 |
| C-3 | Icon 扩展 | 接入 lucide 子集或按需动态 SVG |

**验收**：P1-5 原文「排版后可看到结果」可真正满足。

---

### Phase D — 引擎深化（按产品需求，2+ 迭代）

| # | 任务 | 说明 |
|---|------|------|
| D-1 | Layout handler 插件化 | 将 `layout.ts` 分支拆为 per-layout 模块 + 可注册 apply |
| D-2 | Chart 质量 | 更精细 SVG / 可选 PPTX 原生 chart |
| D-3 | HTML guizang 桥接 | 与 guizang template 对齐的导出通道 |
| D-4 | 新 layout | 仅在注册表机制成熟后扩展，控制 ≤3 种/迭代 |

---

## 10. 建议实施顺序

```
Phase E（Design Agent）   ← 最高优先级，解决设计不理想主矛盾
    ‖ 并行
Phase A（Skill + Rubric 落地）
    ↓
Phase B（导出/工具打通）
    ↓
Phase C（PreviewSlide 缩略图 — 设计验收关键依赖）
    ↓
Phase D（引擎深化）
```

**说明**：Phase C 的缩略图对 Design Agent 验收尤为重要——当前 PreviewSlide 仅 JSON 摘要，Design Agent 无法「看见」是否仍是一排雷同卡片；C-1 应优先于 D。

**不建议现在做**：22+ 版式、WebGL 动效、多人协作 — 与原方案非目标一致。

---

## 11. 关键文件索引

| 用途 | 路径 |
|------|------|
| 原始分阶段方案 | `docs/ppt-style-capability-plan.md` |
| 本文档（现状 + 后续） | `docs/ppt-capability-status-plan.md` |
| 数据模型 | `src/shared/presentation.ts` |
| Layout 引擎 | `src/shared/layout.ts` |
| Layout 注册表 | `src/shared/layout-registry.ts`、`layout-register-builtin.ts` |
| 页级 variant | `src/shared/slide-variant.ts` |
| Chart / Icon 工具 | `src/shared/chart-utils.ts`、`icon-registry.ts` |
| HTML 导出 | `src/shared/html-exporter.ts` |
| PPTX 导出 | `src/main/ppt-exporter.ts` |
| Agent 工具 | `src/main/agent/tools/deferred/` |
| P0 测试 | `tests/layout.test.ts`、`tests/slide-background.test.ts` |
| P1 测试 | `tests/p1-layout.test.ts` |
| P2 测试 | `tests/p2-capabilities.test.ts` |
| Skill | `skills/ppt-layout/`、`skills/ppt-beautify/` |
| Design Agent（待建） | `skills/ppt-design-layout/`（Phase E） |
| 工作流 | `skills/ppt-workflow/SKILL.md` |
| 设计 Rubric | 本文档 §1.2；落地目标 `design-principles.md` |

---

## 12. 变更记录

| 日期 | 说明 |
|------|------|
| 2026-07-04 | 初版：P0–P2 最小实现现状梳理 + Phase A–D 后续计划 |
| 2026-07-04 | 补充 §1.1–1.2：Design Agent 瓶颈、好设计 Rubric、Phase E 计划 |
