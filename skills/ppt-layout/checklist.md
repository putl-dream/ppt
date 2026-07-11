# 排版质检清单

生成或排版完成后逐项自检。P0 必须全部通过再交付。

## P0 · 必过

| # | 检查项 | 做法 |
|---|--------|------|
| 1 | 每页有 layout | `ListSlides` 确认；缺省补 `summary` |
| 2 | 标题不重复 | 画布 text ≠ `slide.title`；无 fontSize≥36 画布标题 |
| 3 | 要点独立 | 每条 bullet 独立 text element |
| 4 | comparison 合法 | 偶数条 body；左右列均非空 |
| 5 | case 合法 | 恰好 2 条 body |
| 6 | 已排版 | 内容页有 card 矩形（`update-slide-layout` 已执行） |
| 7 | 设计统一 | 全 deck 同一 DesignSystemV1；页面 override 克制 |

## P1 · 节奏与版式

| # | 检查项 | 标准 |
|---|--------|------|
| 8 | layout 匹配内容 | 对照 [layout-catalog.md](layout-catalog.md) |
| 9 | 无连续 3 页同 layout | 见 [narrative-arc.md](narrative-arc.md) |
| 10 | 8 页+ 有 section | 至少 1 个章节分隔 |
| 11 | 版式多样性 | 7 页+ ≥3 种；10 页+ ≥5 种 layout |
| 12 | title/body 不语义重复 | 见 narrative-arc chrome/kicker 表 |
| 13 | 有 cover + summary | 完整 deck 首尾齐全 |
| 14 | layout-plan 一致 | Executor 模式：实际 layout 与 plan 一致 |

## P2-copy · 文案与密度

> 注：此处 P2 指**文案密度**，与引擎 P2（chart/table/icon）不同。

| # | 检查项 | 标准 |
|---|--------|------|
| 15 | 单条字数 | 中文 ≤15 字 |
| 16 | 单页条数 | ≤5 条 |
| 17 | 叙事完整 | 含 Hook 与 Takeaway（cover + summary） |
| 18 | 数据页真实 | `case` 右栏是数字/结论，非空泛形容词 |

## P2-engine · 数据元素（引擎 P2）

| # | 检查项 | 标准 |
|---|--------|------|
| 19 | chart 元素 | KPI 页有 kpi-tower/bar；数据绑定非空 |
| 20 | table 元素 | headerRow + 斑马纹可读 |
| 21 | icon 元素 | name 在内置 24 图标内 |
| 22 | slideVariant | 5 页+ deck 至少 2 种 variant |

## P3 · 创意模式额外项

| # | 检查项 | 标准 |
|---|--------|------|
| 23 | 装饰克制 | 每页 shape ≤3（不含 layout 卡片） |
| 24 | 装饰范围 | 仅 process/comparison |
| 25 | 不盖内容 | shape 不遮挡 text |

## 快速命令序列

```
ReadPresentationSnapshot → ValidateDeckLayout → 对照本清单 → deck-review
```

## 不过清单时的修复策略

| 问题 | 修复 |
|------|------|
| layout 错 | 回到 layout-plan redesign，或 `update-slide-layout` |
| 标题重复 | 删画布重复 text |
| 要点合并 | 拆成多个 text element（内容草稿阶段） |
| 缺 section/toc | redesign layout-plan 后重新执行 |
| 未排版 | 按 layout-plan 批量 `set-design-system` + `update-slide-layout` |
| 缺 chart/KPI | BeautifyChart 或 layout-plan enhancement |
