---
name: ppt-design
description: 基于沟通目标生成并锁定 argument mode × visual style × color scheme × reading mode 的完整设计方向
when_to_use: 新建整套演示、重做视觉系统、或 layout-plan 尚未锁定设计方向时
stages:
  - design
  - style
allowed-tools:
  - ReadPresentationSnapshot
  - AskUser
  - SearchExtraTools
  - ExecuteExtraTool
  - ApplyDesignSystem
  - SubmitCommands
---

# PPT 设计决策（ppt-master-design-v2）

## 目标

先决定这套演示如何说服受众，再决定它如何呈现。设计事实源由五个独立轴组成：

1. `argumentMode`：论证骨架
2. `visualStyle`：形状、构图、留白、字体气质与质感
3. `colorScheme`：独立的语义色彩身份
4. `readingMode`：近读 / 混合 / 投影
5. 图像语言：与 visual style 配对的 image rendering

不要再从旧的 business / editorial / technical / academic / report 五预设中挑一个“一键主题”；它们无法表达完整设计意图。

## 设计顺序

### 1. 建立沟通契约

从 brief、用户原话和 snapshot 得到：

- audience：谁看
- objective：为何演示
- desiredOutcome：看完后要理解、相信或执行什么
- coreMessage：整套唯一核心信息
- deliveryContext：现场演讲、会议材料、异步阅读等
- afterUse：会后决策、留档、培训复用等

缺少会显著改变设计的事实时只问一次；已有事实不重复询问。

### 2. 独立选择 argument mode

| mode | 论证方式 | 典型用途 |
|---|---|---|
| `pyramid` | 结论先行，MECE 证据支撑 | 高管决策、战略、分析 |
| `narrative` | 情境 → 张力 → 转折 → 解决 | 融资、案例、品牌故事 |
| `instructional` | 前置知识 → 分解 → 示例 → 练习 | 培训、教程、解释型内容 |
| `showcase` | 大图/大数字主导，情绪节奏 | 发布、品牌揭晓、活动 |
| `briefing` | 中性、完整、便于检索 | 状态同步、会议包、交接 |

用户给定页面顺序时，mode 只影响标题语气、页面内部层级和讲述节奏，不擅自重排。

### 3. 独立选择 visual style

通过 `SearchExtraTools` 精确发现 `ResolveDesignPlan`，再用 `ExecuteExtraTool` 调用。工具返回候选设计计划，不修改 deck。

- 用户明确命名风格或品牌方向：直接生成一个 `locked` direction，不重新给选择题。
- 用户未指定：必须生成 `safe / shifted / bold` 三个完整方向。三者要有明显视觉距离，不能只是同一蓝色主题换名字。
- visual style 不携带固定色值；同一风格可与不同 color scheme 组合。

可用 visual style：

`swiss-minimal`、`soft-rounded`、`glassmorphism`、`dark-tech`、`blueprint`、`editorial`、`photo-editorial`、`data-journalism`、`brutalist`、`memphis`、`zine`、`vintage-poster`、`paper-cut`、`sketch-notes`、`ink-notes`、`chalkboard`、`ink-wash`、`pixel-art`。

### 4. 确认并锁定

全套新建或整套换肤时，把三个方向用一行性格标签 + 一行实际效果说明展示给用户。候选阶段使用 `recommendedDirectionId`，不得伪造用户选择；用户确认后，由交互链把完整沟通契约、全部候选、`selectedDirectionId` 和确认时间写入 `slides/layout-choice.json`。

本 skill 不写 `slides/layout-plan.json`。只有 `ppt-design-layout` 拥有该文件，并把已确认选择复制为 LayoutPlan v2 的顶层设计事实源。

轻量单页编辑不重开方向选择，沿用现有 design system。

## 视觉执行原则

- 一套 deck 只锁一个 argument mode 和一个 visual style。
- 色彩按语义角色使用；正文对背景对比度至少 4.5:1。
- 标题体现风格性格，正文优先可读；reading mode 决定正文基线，而不是任意缩字塞内容。
- 图像 rendering 与 visual style 配对；长文、数字与关键标签保持原生可编辑，不烘焙进图片。
- 页面通过 `anchor / dense / breathing` 建立节奏，禁止全篇同构卡片网格。
- page override 只处理确有叙事意义的背景/密度变化，不创建第二套主题。

## 衔接

方向确认并生成 `slides/layout-choice.json` 后加载 `ppt-design-layout`，逐页写入 `audienceMove`、`rhythm`、`layoutIntent`、layout/grammar 与可执行图片增强；执行阶段只消费锁定结果，不重新猜设计。
