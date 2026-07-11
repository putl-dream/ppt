# 风格模式（guizang 适配）

设计思路来源：[guizang-ppt-skill](https://github.com/op7418/guizang-ppt-skill)（歸藏）。本项目输出 Presentation JSON，不生成 HTML；以下为两种视觉基调在本引擎中的映射。

## 两种基调

| guizang 风格 | 气质 | 本项目的排版模式 | 推荐 design preset |
|--------------|------|------------------|------------|
| **A · 电子杂志** | 衬线感、人文、故事、暖纸色 | `template`（标准排版） | `editorial` |
| **B · 瑞士国际主义** | 无衬线、网格、数据驱动、高对比 | `template` 或 `creative`（轻装饰） | `business` / `report` / `technical` |

**选择参考**

| 用户说… | 推荐 |
|---------|------|
| 杂志感 / 人文 / 故事 | A → template + editorial |
| 瑞士风 / 极简 / 网格 / 数据 / KPI | B → template + business/report |
| AI 产品 / 技术 / 工程发布 | B → technical |
| 行业观察 / 文化 / 非虚构 | A → editorial |
| 大量 KPI / 路线图 / 流程 | B → process/case 为主 |
| 需要 arrow/序号装饰 | B + `creative` 模式 |

## guizang 版式 → 引擎 layout

| guizang（风格 A） | 引擎 layout | 备注 |
|-------------------|-------------|------|
| 1 开场封面 | `cover` | 副标题 1 条 |
| 2 章节幕封 | `section` | 每大章前 |
| 3 数据大字报 | `case` | 右栏大数字 |
| 4 左文右图 | `case`（side 槽）或 `image-grid` | 有图时 InsertSlideImage |
| 5 图片网格 | `image-grid` | 2–4 图；grid-0…grid-3 槽位 |
| 6 Pipeline | `process` | 2–4 步 |
| 7 悬念/问题页 | `section` 或 `summary` | 单句收束 |
| 8 大引用 | `concept`（1 条）或 `section` | 金句页 |
| 9 Before/After | `comparison` | 偶数条 |
| 10 图文混排 | `case` | 叙述 + 结论 |

| guizang（风格 B · S 系列） | 引擎 layout |
|------------------------------|-------------|
| S01/S03 封面/论点 | `cover` / `concept` |
| S02/S11 时间线 | `process` |
| S06/S20 KPI 塔/账单 | `case` |
| S07 H-Bar 排名 | `concept`（每项一条） |
| S08 Duo Compare | `comparison` |
| S05/S17 三层架构 | `architecture` |
| S10/S12 收束 | `summary` / `section` |
| S15/S16 矩阵/快讯 | `concept` |
| S22 Image Hero | `case`（叙述 + 数字；图片后期 add-element） |

## 视觉语义映射（guizang → DesignSystemV1）

本项目不再使用 theme/palette 命令，使用可验证的固定 design preset：

| guizang 预设 | 本项目 |
|--------------|--------|
| 墨水经典 / Monocle | `editorial` |
| 靛蓝瓷 / 瑞士 IKB 蓝 | `business` |
| 森林墨 / 研究报告 | `academic` |
| 牛皮纸 / 沙丘 | `editorial` |
| 技术暗色 / 数据大屏 | `technical` |
| 黑白正式报告 | `report` |

一份 deck **只用一套 DesignSystemV1**；页面差异通过 slideVariant、grammarVariant 和少量 designOverride 表达。

## 页背景节奏（P0-3）

`applyLayout` 会根据 ResolvedSlideStyle 生成背景；`backgroundVariant` 仅保留为布局节奏提示，不再存在独立背景命令。

| backgroundVariant | 典型页面 | 视觉 |
|-------------------|----------|------|
| `hero` | cover、section | 主题渐变 / 品牌底色 |
| `default` | concept、case、process 等正文页 | 略浅或纯色，与 hero 可区分 |
| `muted` | 密集内容页（可选） | 更柔和的底色 |

最终颜色与渐变由设计引擎解析，不在 Agent 或渲染器内重复映射。

## 页级 slideVariant（P2-1）

`slideVariant` 覆盖全 deck 背景节奏，映射 guizang light/dark/hero：

| slideVariant | 典型页面 | 视觉 | 命令 |
|--------------|----------|------|------|
| `hero` | cover、section | 品牌渐变 | `update-slide-variant` |
| `light` | 正文、summary | 浅色底 | 同上 |
| `dark` | quote、强调页 | 深色底 | 同上 |

layout-plan 中指定 slideVariant；Executor 阶段批量 `update-slide-variant`。
未指定时：cover/section→hero，quote→light，其余由 backgroundVariant 推断。
