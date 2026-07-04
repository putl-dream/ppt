# PPT 样式表达能力与能力建设方案

> 版本：2026-07-04  
> 状态：P0–P2 引擎已实现；**Design Agent（Phase E）已落地**（见 [ppt-capability-status-plan.md](./ppt-capability-status-plan.md)）
> 关联：`skills/ppt-layout/`、参考模板 `Documents/PPT/layout/`、[guizang-ppt-skill](https://github.com/op7418/guizang-ppt-skill)

## 1. 背景与目标

Agent PPT 采用 **Presentation JSON + SubmitCommands** 两阶段建稿（内容草稿 → 视觉排版）。Skill 层已整合本地商务模板与 guizang 的叙事/版式/质检思路，但**样式最终由引擎与工具链决定**。

**目标**：在保持「简洁可用」的前提下，逐步补齐样式表达缺口，使 Agent 能稳定产出接近参考 PPT（简约商务、商务汇报）水平的演示，而非仅「统一色系的卡片 bullet 页」。

**非目标（本阶段）**：

- 复刻 guizang 的 HTML/WebGL/动效全栈
- 支持 22+ 瑞士 HTML 版式的像素级等价
- 多人协作编辑、复杂动画时间轴

---

## 2. 当前能力评估

### 2.1 已具备

| 维度 | 能力 | 实现 |
|------|------|------|
| 全局配色 | 5 theme × 4 palette | `set-theme` → `getThemePaletteColors` |
| 版式结构 | **11 种 layout** | `update-slide-layout` → `applyLayout` |
| 文本 | fontSize、bold、color、align、textRole、fontFamily | text element / `update-text-style` |
| 形状 | rectangle、circle、arrow、line | shape element（P0-5 渲染对齐） |
| 图片 | url、borderRadius、imageSlot、objectFit | InsertSlideImage 入槽 |
| 数据元素 | chart / table / icon | P2 元素 + BeautifyChart/Table |
| 页背景 | backgroundVariant + slideVariant | light/dark/hero 页级节奏 |
| 页眉 | slide.title + accent 线 | 渲染层 chrome |
| 导出 | PPTX + HTML + JSON | `deck-export-service.ts` |
| Agent 流程 | 两阶段 + Design Agent + Executor | `ppt-workflow`、`ppt-design-layout`、`ppt-layout` |

**11 种 layout**：`cover` `section` `concept` `comparison` `process` `architecture` `case` `summary` `toc` `quote` `image-grid`

**5 种 theme**：`nordic` `midnight` `ocean` `sunset` `purple`

### 2.2 能力边界（真实上限）

当前稳定产出：**统一主题的商务卡片风 PPT**——语义 layout + 主题 + 卡片风 + chart/table/icon 点缀；Design Agent 按 Rubric 选版式与节奏。

`applyLayout` 负责全部自动排版；Agent 在排版阶段应依赖 layout-plan → set-theme + update-slide-layout + update-slide-variant，而非手画坐标。

### 2.3 剩余缺口

| 参考 / guizang 能力 | 现状 | 严重度 |
|---------------------|------|--------|
| 像素级等价参考 `.pptx` 模板 | 语义 layout，非像素级 | 低（非目标） |
| 22+ 瑞士 HTML 版式 | 11 种语义 layout | 低（非目标） |
| PreviewSlide 缩略图 | ✅ 640×360 PNG base64（Electron） |
| Chart PPTX 原生图表 | SVG rasterize 为图片 | 低 |
| Icon 全量 Lucide | 24 内置 | 低 |
| HTML guizang 桥接 | 自研简单模板 | 低 |
| 入场动效 | 不支持 | 低（非目标） |

### 2.4 Skill 与引擎对齐（Phase A 已完成）

```
┌─────────────────────────────────────────┐
│ guizang / 参考 PPT 视觉目标              │  ← Skill 语义映射 + Rubric
├─────────────────────────────────────────┤
│ Design Agent → layout-plan → Executor   │  ← Phase E 流程
├─────────────────────────────────────────┤
│ 11 layout + P2 元素 + slideVariant      │  ← 当前引擎上限
└─────────────────────────────────────────┘
```

**结论**：引擎 P0–P2 与 Skill 已同步；下一优先级为 Phase C（PreviewSlide 缩略图）以支持设计验收。

---

## 3. 分阶段建设计划

### 阶段 P0 — 让现有 8 layout 真正可用（优先）

> 目标：Agent 选的 layout 在视觉层能落地；图文页、数据页不再「只有文字凑合」。  
> 预估：1–2 个迭代

| # | 能力 | 类型 | 说明 | 主要改动 |
|---|------|------|------|----------|
| P0-1 | **Layout 内置图片槽** | 引擎 | `case`/`concept` 等 layout 预留 image 区域；无图时用占位或跳过 | `src/shared/layout.ts`、`presentation.ts`（可选 `slot` 元数据） |
| P0-2 | **文本样式角色** | 模型 | `textRole: kicker \| body \| metric \| caption` 或 `fontFamily` | `presentation.ts`、`applyLayout` 按 role 设字号/字重；theme 驱动字体 |
| P0-3 | **按页背景变体** | 引擎 | cover/section 与正文页背景差异化 | `Slide.backgroundVariant?: 'default' \| 'hero' \| 'muted'` + 渲染层 |
| P0-4 | **BeautifyChart / BeautifyTable 实现** | 工具 | 替换空 stub；或先支持「表格 → concept 卡片组」降级 | `beautify-chart.ts`、`beautify-table.ts` |
| P0-5 | **Shape 渲染对齐** | 渲染 | arrow/line 在 Canvas/PPTMirror 与 PPTX 导出一致 | `CanvasArea.tsx`、`PPTMirror.tsx` |

**P0 验收标准**：

- [x] `case` 页可展示「左文 + 右图或右数字」，有图时 image 落入槽位
- [x] cover/section 与 concept 页背景可区分
- [x] theme 切换后标题/正文字体分工可见（至少 nordic 衬线 vs ocean 无衬线）
- [x] `BeautifyChart` 对 `case`/metric 页返回可执行 commands（非空数组）
- [x] deck-review checklist P0 项可在排版后通过

---

### 阶段 P1 — 接近参考商务 PPT

> 目标：覆盖简约商务 / 商务汇报模板中的高频页型（目录、图文、数据）。  
> 预估：2–3 个迭代

| # | 能力 | 类型 | 说明 | 主要改动 |
|---|------|------|------|----------|
| P1-1 | **扩展 layout** | 引擎 | 新增 `toc`（目录）、`quote`（金句）、`image-grid`（2–4 图） | `layout.ts`、`commands.ts`、skill layout-catalog |
| P1-2 | **AddLayoutDecorations** | 工具 | 按 layout 自动添加序号圆、分隔线、步骤箭头（creative 模式） | 新 deferred tool + `ppt-beautify` 衔接 |
| P1-3 | **InsertSlideImage** | 工具 | 绑定 layout 槽位 + 比例约束（16:9、4:3 等） | 新 deferred tool；校验 `LayoutPolicy` 安全区 |
| P1-4 | **ApplyTypography** | 工具 | 按 theme + textRole 批量 `update-text-style` | 新 deferred tool |
| P1-5 | **PreviewSlide / 缩略图反馈** | 工具 | Agent 排版后可「看到」结果再修 | 截图 API 或 renderer 缩略图 IPC |

**P1 验收标准**：

- [x] 10 页商务 deck 可含：cover、toc(concept/toc)、section×2、case、process、comparison、summary
- [x] 参考模板「76% / 89%」类 KPI 页视觉可辨认
- [x] Agent 可通过 InsertSlideImage 将图片放入正确槽位，无需手填 x/y
- [x] storyboard 中 guizang 节奏规则（无连续 3 页同 layout）可自动校验

---

### 阶段 P2 — 进阶样式与 guizang 部分能力

> 目标：数据可视化、页级节奏、可选 HTML 导出。  
> 预估：3+ 迭代，按需求取舍

| # | 能力 | 类型 | 说明 | 状态 |
|---|------|------|------|------|
| P2-1 | **Slide variant** | 模型 | 每页 `light` / `dark` / `hero`（映射 guizang 主题节奏） | ✅ |
| P2-2 | **Chart 元素** | 模型 | bar、h-bar、timeline、kpi-tower；数据 JSON 绑定 | ✅ |
| P2-3 | **Icon 元素** | 模型 | Lucide name → SVG 或内置 shape 集 | ✅ |
| P2-4 | **Table 元素** | 模型 | 行列 + 主题色斑马线 | ✅ |
| P2-5 | **HTML 导出通道**（可选） | 导出 | 与 guizang template 桥接，服务「网页 PPT」场景 | ✅ |
| P2-6 | **布局注册表** | 引擎 | 可扩展 layout 插件（类似 guizang S01–S22 登记），避免硬编码 monolith | ✅ |

---

## 4. 数据模型演进草案

### 4.1 TextElement 扩展（P0-2）

```typescript
// 草案 — 实施时以 zod schema 为准
textRole?: "kicker" | "body" | "metric" | "caption";
fontFamily?: "serif" | "sans" | "mono"; // 或由 theme 推导，role 优先
```

### 4.2 Slide 扩展（P0-3 / P2-1）

```typescript
backgroundVariant?: "default" | "hero" | "muted" | "dark";
```

### 4.3 Image 槽位（P0-1）

```typescript
// layout 应用后写入 element metadata
imageSlot?: "hero" | "side" | "grid-0" | "grid-1" | ...;
objectFit?: "cover" | "contain";
```

### 4.4 新 element 类型（P2）

```typescript
type: "chart" | "table" | "icon";
// chart: { chartType, data, theme }
// table: { rows, columns, headerRow }
// icon: { name, size, color }
```

### 4.5 新 PresentationCommand（汇总）

| Command | 阶段 |
|---------|------|
| `set-slide-background` | P0-3 |
| `update-text-role` / 扩展 `update-text-style` | P0-2 |
| `insert-image-into-slot` | P1-3 |
| `add-layout-decorations` | P1-2 |
| `update-slide-variant` | P2-1 |

---

## 5. Agent 工具演进草案

| 工具名 | 阶段 | 职责 |
|--------|------|------|
| `ApplyThemeStyle` | 已有 | 保持；P0 后可联动 typography |
| `AutoLayoutSlide` | 已有 | 保持 |
| `SelectStyleStrategy` | 已有 | P0 后返回 fontStack + background 建议 |
| `BeautifyChart` | P0 | 实现：metric 强化 / 简易 bar |
| `BeautifyTable` | P0 | 实现：表格 → 卡片组或 table element |
| `InsertSlideImage` | P1 | 槽位 + 比例 |
| `AddLayoutDecorations` | P1 | creative 模式装饰 |
| `ApplyTypography` | P1 | 全 deck 字体角色 |
| `PreviewSlide` | P1 | 视觉反馈 |
| `ValidateDeckLayout` | P1 | 程序化 checklist（节奏、多样性） |

---

## 6. 与 Skill 的协同

| Skill | 计划更新时机 |
|-------|--------------|
| `ppt-layout/layout-catalog.md` | P1 新 layout 登记 |
| `ppt-layout/style-modes.md` | P0 字体/背景映射更新 |
| `ppt-layout/checklist.md` | 每阶段补充可自动化检查项 |
| `ppt-beautify` | P1 接入新 deferred tools |
| `ppt-build` | P0 内容草稿阶段可标注 `textRole`、图片占位 |

**原则**：Skill 只描述**已有引擎能力**；每完成一阶段 Pn，再更新 Skill，避免「文档超前于实现」。

---

## 7. 实施顺序建议

```
P0-1 图片槽 + P0-2 文本角色     ← 最高 ROI，先做
    ↓
P0-3 页背景变体 + P0-5 Shape 渲染
    ↓
P0-4 BeautifyChart/Table 最小实现
    ↓
P1-1 扩展 layout（toc / quote / image-grid）
    ↓
P1-2 ~ P1-5 工具链 + Preview
    ↓
P2 按产品需求选型
```

**建议首个 PR 范围**：P0-1 + P0-2 + 对应单元测试（`tests/layout.test.ts`）+ `layout-catalog.md` 更新。

---

## 8. 风险与约束

| 风险 | 缓解 |
|------|------|
| layout 膨胀难维护 | P2 引入 layout 注册表；P1 新增不超过 3 种 |
| 图片路径/导出失败 | InsertSlideImage 统一校验；PPTX 导出已有 path/data 分支 |
| Agent 仍手画坐标 | Skill + validator 禁止内容阶段以外手动 x/y |
| **主 Agent 兼设计+执行，版式单调** | 引入 **Design Agent** + layout-plan；见 status-plan §1.1–E |
| 与 guizang 预期落差 | 文档明确「语义映射 ≠ 视觉等价」；HTML 导出放 P2 可选 |
| 破坏现有 deck | 新字段均可选；`applyLayout` 向后兼容 |

---

## 9. 参考

- 本地模板：`Documents/PPT/layout/`（简约商务.pptx、商务汇报.pptx）
- 设计思路：[guizang-ppt-skill](https://github.com/op7418/guizang-ppt-skill)
- 引擎实现：`src/shared/layout.ts`、`src/shared/presentation.ts`
- Agent Skill：`skills/ppt-layout/`

---

## 11. Agent 排版设计专责（Phase E · 已完成）

> 详见 [ppt-capability-status-plan.md](./ppt-capability-status-plan.md) §1.1–§1.2、Phase E。

**已落地**：

1. `skills/ppt-design-layout/SKILL.md` — Design Agent 专责 Skill（Rubric + layout-plan 格式）
2. `src/shared/layout-plan.ts` — layout-plan 解析、Rubric 校验、Executor 命令生成
3. `ppt-workflow` 阶段 4c Design + 5 Execute 分离
4. `sub-system-prompt.ts` — Design Task 禁止 SubmitCommands
5. `ppt-layout` Executor 模式 — 严格按 plan 执行
6. `deck-review` — Rubric A–E 验收
7. `tests/fixtures/layout-plan-tech-evolution.json` — 示例 redesign fixture

**与现有 Skill 关系**：

| Skill | 定位 |
|-------|------|
| `ppt-design` | theme 速查；deck 级 theme 写入 layout-plan |
| `ppt-design-layout` | Design Agent 专责：Rubric + layout-plan 格式 |
| `ppt-layout` | **Executor**：按 plan 批量 SubmitCommands |
| `deck-review` | 验收 Rubric + ValidateDeckLayout |

---

## 12. 变更记录

| 日期 | 说明 |
|------|------|
| 2026-07-04 | 初版：能力评估 + P0/P1/P2 方案 |
| 2026-07-04 | P0 验收通过；P1 实现 toc/quote/image-grid + 5 个 deferred tools |
| 2026-07-04 | P2 实现：slide variant、chart/table/icon 元素、HTML 导出、layout 注册表 |
| 2026-07-04 | Phase E Design Agent 落地；§2 能力评估刷新；Phase B 导出/html |
