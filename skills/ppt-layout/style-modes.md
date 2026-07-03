# 风格模式（guizang 适配）

设计思路来源：[guizang-ppt-skill](https://github.com/op7418/guizang-ppt-skill)（歸藏）。本项目输出 Presentation JSON，不生成 HTML；以下为两种视觉基调在本引擎中的映射。

## 两种基调

| guizang 风格 | 气质 | 本项目的排版模式 | 推荐 theme |
|--------------|------|------------------|------------|
| **A · 电子杂志** | 衬线感、人文、故事、暖纸色 | `template`（标准排版） | `nordic` / `sunset` |
| **B · 瑞士国际主义** | 无衬线、网格、数据驱动、高对比 | `template` 或 `creative`（轻装饰） | `ocean` / `midnight` |

**选择参考**

| 用户说… | 推荐 |
|---------|------|
| 杂志感 / 人文 / 故事 / 不指定 | A → template + nordic |
| 瑞士风 / 极简 / 网格 / 数据 / KPI | B → template + ocean |
| AI 产品 / 技术 / 工程发布 | B → ocean + cyan |
| 行业观察 / 文化 / 非虚构 | A → nordic 或 sunset |
| 大量 KPI / 路线图 / 流程 | B → process/case 为主 |
| 需要 arrow/序号装饰 | B + `creative` 模式 |

## guizang 版式 → 引擎 layout

| guizang（风格 A） | 引擎 layout | 备注 |
|-------------------|-------------|------|
| 1 开场封面 | `cover` | 副标题 1 条 |
| 2 章节幕封 | `section` | 每大章前 |
| 3 数据大字报 | `case` | 右栏大数字 |
| 4 左文右图 | `case` 或 `concept` | 2 条 body |
| 5 图片网格 | `concept` | 暂无 image 槽位，用要点代替 |
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

## 主题色映射（guizang 预设 → set-theme）

guizang 不允许自定义 hex；本项目用固定 theme/palette，语义对齐如下：

| guizang 预设 | 本项目 |
|--------------|--------|
| 墨水经典 / Monocle | `nordic` + `cyan` |
| 靛蓝瓷 | `ocean` + `cyan` |
| 森林墨 | `nordic` + `green` |
| 牛皮纸 | `sunset` + `orange` |
| 沙丘 | `sunset` + `orange` |
| 瑞士 IKB 蓝 | `ocean` + `cyan` |
| 瑞士柠檬黄/绿/安全橙 | `sunset`/`nordic` + `orange`/`green` |

一份 deck **只用一套 theme**，中途不换色。

## 页背景节奏（P0-3）

`applyLayout` 会自动写入 `backgroundVariant`；也可用 `set-slide-background` 手动覆盖。

| backgroundVariant | 典型页面 | 视觉 |
|-------------------|----------|------|
| `hero` | cover、section | 主题渐变 / 品牌底色 |
| `default` | concept、case、process 等正文页 | 略浅或纯色，与 hero 可区分 |
| `muted` | 密集内容页（可选） | 更柔和的底色 |

nordic 示例：hero `#fbfbfa`，正文 `#ffffff`；ocean 示例：hero 渐变，正文 `#0f172a`。
