# 参考模板拆解

来源：`Documents/PPT/layout/` 下两份 1ppt 商务模板。Agent 不读取这些文件；本文档将可复用模式编码为排版规则。

## 简约商务（22 页）

**气质**：清爽、留白、浅青 + 深灰，适合部门汇报与年中总结。

**主色**

| 角色 | 色值 | 映射 theme |
|------|------|------------|
| 主色/强调 | `#0485A8` `#79C9E2` | ocean + cyan |
| 深色文字 | `#2C3139` | ocean.title |
| 辅助深蓝 | `#224477` | cardStroke 系 |

**结构节奏**

1. 封面：主标题 + 副标题 + LOGO 区（→ `cover`，副标题 1 条 text）
2. 目录：编号 01/02/03 + 章节名（→ 首屏 `concept` 3–4 卡，或口头目录）
3. 章节分隔：重复骨架「章节名 + MORE>>>」（→ `section`）
4. 内容页型：
   - 五格编号 01–05 → `concept`（5 条要点）
   - 年份时间轴 2016–2020 → `process`（每步一年）
   - KPI 76% 大数字 → `case`（左说明 + 右数字）
   - 三栏/四栏并列 → `concept`
   - 六步编号流程 → `process`
5. 收尾：感谢/总结 → `summary` 或 `cover` 变体

**可借鉴、不照搬**

- 每章前固定 `section` 强化节奏
- 数字结论放大放右栏（`case` 右栏 fontSize 32 accent 色）
- 避免每页超过 5 个信息块

## 商务汇报（25 页）

**气质**：黑白灰 + 少量蓝橙点缀，适合竞聘与个人工作汇报。

**主色**

| 角色 | 色值 | 映射 theme |
|------|------|------------|
| 背景/分隔 | `#E6E6E6` `#FFFFFF` | nordic |
| 正文 | `#000000` `#808080` | nordic.title / body |
| 强调蓝 | `#2786F8` | nordic + cyan accent |
| 强调橙 | `#ED761A` | sunset + orange（仅点缀） |

**结构节奏**

1. 封面：标语 + 主标题 + 英文副文（→ `cover`）
2. 目录 CONTENTS：01. 02. 03. 04. 四段式（→ `concept` 四卡）
3. 章节页：大号序号 01 + 章节标题（→ `section`）
4. 内容页型：
   - 长段引言/自述 → 单页 1–2 条 `concept` 或拆成 `summary` 首条
   - 三/四宫格卡片 → `concept`
   - 时间轴 20XX → `process`
   - 双栏 01/02 对照 → `comparison`
   - 89% 指标 → `case`
   - 编号列表 01–04 → `process` 或 `summary`
5. 封底重复封面信息 → `cover` 或 `summary`

**文案原则（模板原文强调）**

- 「文字需概括精炼，言简意赅」
- 「正文简单明了，不必繁琐」
- 与引擎约束一致：单条 ≤15 字

## 与引擎的对应关系

参考模板中的复杂 shape/图片装饰，当前由 `applyLayout`（`src/shared/layout.ts`）用**卡片矩形 + accent 条/箭头**实现。Agent 应：

1. 用 `layout` 枚举表达页面结构，而非手画坐标
2. 标准模式依赖 `update-slide-layout` 一键排版
3. 创意模式仅在 process/comparison 上追加少量 shape

## 主题速查

| 模板 | 推荐 set-theme |
|------|----------------|
| 简约商务 | `{"theme":"ocean","palette":"cyan"}` |
| 商务汇报 | `{"theme":"nordic","palette":"cyan"}` |
