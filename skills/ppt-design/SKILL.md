---
name: ppt-design
description: 为 SVG-native 新建 deck 建立沟通契约，并在页面构图前锁定 argument mode、visual style、reading mode、image language、色彩和字体
when_to_use: 新建整套 PPT，或尚未建立 deck-wide 设计事实源时
stages:
  - discover
  - design
  - style
allowed-tools:
  - ReadFile
  - WriteFile
  - GetDesignReference
---

# SVG-native 设计锁

## 目标

在写任何页面 SVG 前，先决定这套演示如何推动受众，再锁定一套可执行的视觉语言。将唯一 deck-wide 设计事实写入 `design/design-spec.json`；不要创建旧 Design System commands，也不要直接生成可见页面对象。

## 1. 建立沟通契约

从用户原话、brief、outline 和已有 workspace 文件中确定：

- `audience`：谁看。
- `objective`：为什么需要这套演示。
- `desiredOutcome`：受众看完后需要理解、相信、决定或执行什么。
- `coreMessage`：整套演示唯一核心判断。
- `deliveryContext`：现场讲述、会议讨论、异步近读或其他场景。
- `afterUse`：会后决策、留档、传播或培训复用。

已有事实不要重复询问。仅当缺失信息会改变内容事实或交付目标时才暂停；不要询问“标准还是创意”“要不要卡片”等内部设计选项。

## 2. 先锁定四个设计轴

### Argument mode

选择唯一的 deck-wide 论证方式：

| `argumentMode` | 论证方式 | 适用目标 |
|---|---|---|
| `pyramid` | 结论先行，MECE 证据支撑 | 高管决策、战略、分析 |
| `narrative` | 情境 → 张力 → 转折 → 解决 | 融资、案例、品牌故事 |
| `instructional` | 前置知识 → 分解 → 示例 → 练习 | 培训、教程、解释型内容 |
| `showcase` | 大图/大数字主导，情绪节奏 | 发布、品牌揭晓、活动 |
| `briefing` | 中性、完整、便于检索 | 状态同步、会议包、交接 |

用户已经给定顺序或事实结构时，不为迁就 mode 擅自重排或改写事实。

### Visual style

选择唯一风格并写出具体 `visualStyleBehavior`，至少说明构图重心、几何语言、留白、层级、线条/质感和应避免的视觉习惯。风格不能只是一枚名称或一组颜色。

可用起点：

`swiss-minimal`、`soft-rounded`、`glassmorphism`、`dark-tech`、`blueprint`、`editorial`、`photo-editorial`、`data-journalism`、`brutalist`、`memphis`、`zine`、`vintage-poster`、`paper-cut`、`sketch-notes`、`ink-notes`、`chalkboard`、`ink-wash`、`pixel-art`。

用户明确指定时直接锁定；未指定时根据沟通契约自主选择一个最合适的方向。除非用户明确要求比较方案，不展示 safe/shifted/bold 选择题。

### Reading mode

锁定 `text`（近读）、`balanced`（均衡）或 `presentation`（投影）。该值必须与 `SubmitSvgDeck.designSystem.readingMode` 完全一致；它决定信息密度、正文基线、留白与讲者依赖，不能在执行时靠任意缩字改变。

### Image language

即使决定不用图片，也要显式锁定。至少记录：

- `usage`：`none`、`selective` 或 `image-led`。
- `rendering`：照片、拼贴、线稿、3D、信息图插画等一致的渲染家族。
- `motif`：跨页重复的视觉母题。
- `framing`：满版、裁切、边到边、独立对象等规则。
- `tone`：光线、颗粒、材质、情绪和与页面颜色的关系。
- `textPolicy`：默认 `none`，不要让生成图片承担精确标题、数字或数据标签。

### 读取完整执行参考

四轴确定后立即调用一次 `GetDesignReference`，传入精确的 `argumentMode`、`visualStyle` 和 `readingMode`。将返回的论证骨架、标题语气、构图、shape/elevation/whitespace/typography/background/texture、image language 和 `avoid` 约束写入设计规格。风格名称本身不算设计锁；SVG 作者必须拿到这些行为细节。

## 3. 锁定配套视觉事实

- 定义语义色彩角色：`background`、`surface`、`primaryText`、`secondaryText`、`accent`、`signal`，使用明确 HEX；正文对背景对比度至少 4.5:1。
- 定义 `title`、`body`、`emphasis`、`code/data` 字体角色和大致字号层级；选择预览与提交环境可用的字体。
- 定义页面边距、常用对齐线、圆角/直角倾向、描边、阴影与纹理纪律。
- 定义 `anchor`、`dense`、`breathing` 三种页面节奏如何在本风格中呈现。
- 明确禁止项，至少包括自动 chrome、固定 layout、全套卡片网格和仅换色不换构图。

## 4. 写入设计规格

用 `WriteFile` 写 `design/design-spec.json`。最低结构：

```json
{
  "version": 1,
  "canvas": {"width": 1280, "height": 720},
  "communicationContract": {},
  "presentationDesignSystem": {
    "version": 2,
    "argumentMode": "pyramid",
    "visualStyle": "swiss-minimal",
    "colorScheme": "business-blue",
    "readingMode": "balanced"
  },
  "argumentMode": "pyramid",
  "visualStyle": {"id": "swiss-minimal", "reference": {}},
  "readingMode": "balanced",
  "imageLanguage": {},
  "colors": {},
  "typography": {},
  "geometry": {},
  "rhythmBehavior": {},
  "forbidden": []
}
```

字段值必须具体、内部一致，不能把待决定项留给 SVG Executor。该文件不含可见对象，也不授权预览或提交工具补对象。

完成后由 `ppt-design-layout` 读取同一文件，为每页冻结最终文案和构图意图。后续不得无故重新选择 mode 或 style；若用户改变沟通目标，先更新设计规格，再继续页面规划。
