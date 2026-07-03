---
name: ppt-layout
description: 第二阶段视觉排版；用户在选择卡确认后执行 set-theme 与 update-slide-layout
when_to_use: 用户已确认排版方式（标准排版或创意装饰），需要对内容草稿应用视觉层时
allowed-tools:
  - ReadPresentationSnapshot
  - ListSlides
  - PreviewCommands
  - SubmitCommands
  - SearchExtraTools
  - ExecuteExtraTool
---

# 排版阶段（第二阶段）

## 前置

用户已在 LayoutChoiceCard 选择排版方式。本阶段**只处理视觉层**，不改写要点文案。

## 标准排版（template）

1. ReadPresentationSnapshot + ListSlides
2. SubmitCommands 一批提交：
   - `set-theme`（theme/palette 按用户选择）
   - 对每个内容页 `update-slide-layout`（layout 取 slide 已有值，缺省 summary）
3. 禁止在画布放标题；禁止手动坐标堆叠
4. 可选 LoadSkill `deck-review` 做简要质检

## 创意装饰（creative）

1. LoadSkill `ppt-beautify`
2. 先执行标准排版（set-theme + update-slide-layout）
3. 再为 process/comparison 页添加 shape 装饰（arrow、line、circle 序号）
4. 禁止重复 slide.title

## 禁止

- 不在本阶段重建内容草稿（不 remove-slide、不改要点 text）
- 不跳过 update-slide-layout

## 衔接

排版完成后客户端展示 DeckPreviewCard。
