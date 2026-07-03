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
| 7 | 主题统一 | 全 deck 同一 theme/palette |

## P1 · 节奏与版式

| # | 检查项 | 标准 |
|---|--------|------|
| 8 | layout 匹配内容 | 对照 [layout-catalog.md](layout-catalog.md) |
| 9 | 无连续 3 页同 layout | 见 [narrative-arc.md](narrative-arc.md) |
| 10 | 8 页+ 有 section | 至少 1 个章节分隔 |
| 11 | 版式多样性 | 10 页+ 至少 5 种 layout |
| 12 | title/body 不语义重复 | 见 narrative-arc chrome/kicker 表 |
| 13 | 有 cover + summary | 完整 deck 首尾齐全 |

## P2 · 文案与密度

| # | 检查项 | 标准 |
|---|--------|------|
| 14 | 单条字数 | 中文 ≤15 字 |
| 15 | 单页条数 | ≤5 条 |
| 16 | 叙事完整 | 含 Hook 与 Takeaway（cover + summary） |
| 17 | 数据页真实 | `case` 右栏是数字/结论，非空泛形容词 |

## P3 · 创意模式额外项

| # | 检查项 | 标准 |
|---|--------|------|
| 18 | 装饰克制 | 每页 shape ≤3（不含 layout 卡片） |
| 19 | 装饰范围 | 仅 process/comparison |
| 20 | 不盖内容 | shape 不遮挡 text |

## 快速命令序列

```
ReadPresentationSnapshot → 对照本清单 → 问题页 SubmitCommands 修复 → deck-review
```

## 不过清单时的修复策略

| 问题 | 修复 |
|------|------|
| layout 错 | `update-slide-layout` 改 layout（不改 text） |
| 标题重复 | 删画布重复 text |
| 要点合并 | 拆成多个 text element（内容草稿阶段） |
| 缺 section | `add-slide` section 页（需用户确认改结构） |
| 未排版 | 批量 `update-slide-layout` + `set-theme` |
