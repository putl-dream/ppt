---
name: ppt-design
description: 选择并应用独立 DesignSystemV1 设计系统
when_to_use: 需要确定视觉语言、应用或调整整套设计系统时
stages:
  - design
  - style
allowed-tools:
  - ReadPresentationSnapshot
  - SearchExtraTools
  - ExecuteExtraTool
  - SubmitCommands
---

# 设计系统

## 目标

从受众、叙事和内容类型确定 `DesignSystemV1`，再提交 `set-design-system`。设计系统是视觉事实源；布局、预览、HTML 与 PPTX 只消费解析后的 `ResolvedSlideStyle`。

## 内置设计预设

| 场景 | preset | 关键视觉语言 |
|------|------|------|
| 简约商务 / 部门汇报 | business | 商务蓝、正式、卡片、报告图表 |
| 人文 / 品牌故事 | editorial | 暖纸、编辑式、留白、注释母题 |
| 技术方案 / 工程发布 | technical | 科技暗色、几何、仪表盘图表 |
| 学术 / 研究报告 | academic | 柔和绿、网格、标注、证据导向 |
| 正式报告 / 竞聘 | report | 黑白报告、高密度、克制 |

详细色板与 guizang 预设对照见 `ppt-layout/style-modes.md` 与 reference-templates.md。

## 工作流

1. 优先用 `SelectStyleStrategy` 获取 preset 与完整 `designSystem`；未明确时使用 business。
2. 用 `ApplyDesignSystem` 生成命令，或直接 SubmitCommands：

```json
{"id":"cmd-design","type":"set-design-system","designSystem":{"version":1,"tokens":{"palette":"business-blue","fontMood":"formal","shapeLanguage":"cards","backgroundStyle":"clean","motif":"none","density":"standard","imageTreatment":"plain","chartStyle":"report"}}}
```

3. 若需项目化留存，写 `design/system.json`，内容必须通过 `DesignSystemV1` schema。

## 衔接

设计系统确定后进入 layout-plan；页面特殊节奏只用 `designOverride`，不要创建第二套主题体系。
