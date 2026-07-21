# 商业 PPT 视觉编译器 v2 升级方向

> 日期：2026-07-18  
> 状态：主链路已落地，进入质量可信化与真实交付补强阶段
> 适用范围：Lean Mode 新建商业 PPT  
> 核心目标：在保持一次内容模型调用和确定性编译的前提下，把产出从“整齐的自动排版稿”提升为“具备视觉导演、品牌感和商业叙事完成度的可交付初稿”。

> 进度更新：2026-07-21
> DeckSpec v2、八类 Commercial Scene、本地视觉导演、素材解析、确定性编译和商业质量门已经接入 Lean 新建主链路。当前机器质量分已区分“不适用”的素材维度，输出逐项证据，并把视觉辨识度、信息冲击力和品牌适配明确留给人工复核。后续重点是统一商业沟通契约、品牌人格、焦点素材、原生图表/备注和真实视觉反馈闭环。

---

## 1. 背景与判断

Lean Mode 已验证以下方向成立：

- 一次模型调用可以完成商业叙事和 DeckSpec；
- 本地编译器可以稳定生成合法、可编辑的 Presentation；
- 相比完整 Agent 工作流，链路更短、token 更可控；
- schema、审批、持久化和确定性编译边界可成立。

但当前视觉结果仍停留在：

- 通用蓝色主题；
- 白底卡片、细线、基础图表；
- 页面结构整齐，但缺少视觉主角；
- 多页重复使用相似网格；
- 图片、数据、标题和空间没有形成共同叙事；
- 更接近“汇报线框稿”，而不是商业提案、品牌发布或作品集级 PPT。

因此，当前问题不是继续调整 Prompt，也不是增加 Agent 轮次，而是现有 DeckSpec 和编译器的视觉表达上限不足。

**核心决策：建设 Commercial Visual Compiler v2，以商业场景语法、素材管线和本地视觉导演为主要升级方向。**

---

## 2. 产品目标与非目标

### 2.1 产品目标

Commercial Visual Compiler v2 应具备：

1. 每页有清晰的视觉焦点，而不是把内容装进通用容器。
2. 整套 PPT 具有统一的字体、色彩、图片处理和视觉母题。
3. 页面之间存在节奏变化：强视觉页、信息页、过渡页和结尾页可辨认。
4. 图片、图表、数字和文字围绕同一个页面结论组织。
5. 缩略图状态下仍能识别每页重点和整套叙事节奏。
6. 模型只输出高层语义，不输出坐标和底层元素。
7. 相同 DeckSpec 和素材输入可重复编译出相同结果。
8. 主要文字、图表和形状在 PPTX 中保持可编辑。

### 2.2 非目标

v2 第一阶段不做：

- 让模型自由编写 `x/y/width/height`；
- 恢复多 Agent、多轮排版和自动反复修复；
- 一次建设几十套风格和几十种场景；
- 复制某一份参考 PPT 的像素级外观；
- 用整页图片替代可编辑的 PPT 元素；
- 在底层表达能力不足时优先建设复杂品牌推理；
- 用前端 CSS 美化掩盖 Presentation 数据和编译器能力不足。

---

## 3. 系统职责重新划分

```text
用户需求
   ↓
一次内容模型调用
   ├─ 商业故事
   ├─ 每页结论
   ├─ 内容结构
   └─ 视觉意图
   ↓
DeckSpec v2
   ↓
本地视觉导演
   ├─ 选择商业场景
   ├─ 控制页面节奏
   ├─ 选择浅色/深色/图片背景
   └─ 生成素材需求
   ↓
素材解析管线
   ├─ 搜索与候选过滤
   ├─ 来源与授权记录
   ├─ 本地化
   └─ 裁切与槽位适配
   ↓
确定性视觉编译器
   ├─ 坐标
   ├─ 字体层级
   ├─ 图片处理
   ├─ 图表表达
   └─ 母题与装饰
   ↓
商业质量门
   ↓
预览、审批、应用和导出
```

| 层级 | 负责 | 不负责 |
|------|------|--------|
| 内容模型 | 商业叙事、页面结论、视觉意图 | 坐标、字体尺寸、图片裁切 |
| DeckSpec v2 | 保存内容与视觉语义 | 保存渲染后的元素树 |
| 视觉导演 | 场景选择、节奏、素材策略 | 生成商业事实 |
| 素材管线 | 图片候选、本地化、授权信息、裁切 | 决定商业故事 |
| 视觉编译器 | 将场景和内容编译为 Presentation | 自主修改页面语义 |
| 质量门 | 阻止明显不合格结果 | 用主观模型反复重做整套 PPT |
| Renderer | 忠实显示和编辑 Presentation | 再解释一次设计意图 |

---

## 4. DeckSpec v2：增加视觉语义，不增加坐标

### 4.1 页面视觉契约

在现有 Lean SlideSpec 的内容语义之上增加：

```ts
type CommercialVisualIntentV2 = {
  role:
    | "hero"
    | "overview"
    | "evidence"
    | "comparison"
    | "process"
    | "gallery"
    | "statement";

  composition:
    | "full-bleed"
    | "split"
    | "editorial-grid"
    | "image-collage"
    | "metric-story"
    | "minimal-statement";

  imageMode: "required" | "optional" | "none";

  /** 描述所需视觉内容，不包含具体 URL。 */
  assetBrief: string;

  /** 页面最需要被看见的 1–3 个内容片段。 */
  emphasis: string[];
};
```

模型可以提出 `composition`，但本地视觉导演有权根据相邻页面、素材可用性和内容密度进行覆盖。

### 4.2 约束

- 不允许坐标、字号、颜色值和阴影参数进入 DeckSpec。
- `assetBrief` 只描述视觉需求，不允许模型伪造图片来源。
- `emphasis` 必须引用当前页面已有内容。
- `imageMode=required` 时必须有可用素材或明确降级到无图场景。
- 每页只允许一个主要视觉角色。
- v2 继续使用紧凑枚举，避免重新扩大模型决策面和输出 token。

### 4.3 与现有字段的关系

```text
kind / purpose       → 页面为什么存在、内容属于什么类型
visual.role          → 页面在视觉叙事中的职责
visual.composition   → 建议采用何种商业构图
designPreset/tokens  → 整套 PPT 的视觉语气
Commercial Scene    → 最终可执行的页面结构
```

---

## 5. Commercial Scene Pack

Commercial Scene 不是传统的静态 PPT 模板，而是带内容约束、素材槽位和可执行规则的商业构图。

### 5.1 Scene Contract

```ts
type CommercialSceneDefinition = {
  id: string;
  supportedRoles: CommercialVisualIntentV2["role"][];
  supportedPurposes: LeanSlidePurpose[];
  contentConstraints: {
    minItems?: number;
    maxItems?: number;
    supportsChart?: boolean;
    supportsMetric?: boolean;
  };
  assetSlots: Array<{
    id: string;
    aspectRatio: number;
    treatment: "cover" | "contain" | "masked" | "framed";
    required: boolean;
  }>;
  variants: string[];
  compile(input: CommercialSceneCompileInput): Slide;
};
```

### 5.2 第一套主题包

第一阶段只建设一套 `editorial-business` 商业主题包，包含八个场景：

| Scene | 主要用途 | 关键视觉 |
|-------|----------|----------|
| `cinematic-cover` | 封面 | 全幅或大比例主图、强标题、少量元信息 |
| `numbered-overview` | 目录/总览 | 大数字索引、章节节奏、编辑式网格 |
| `hero-narrative` | 核心观点 | 主图与一句结论形成视觉中心 |
| `split-case` | 案例/方案 | 图文分屏、证据与结论并置 |
| `dual-evidence` | 对比 | 双图、双指标或前后对照 |
| `metric-landscape` | 数据证明 | 横幅图片、主指标、次级解释 |
| `project-gallery` | 多案例/成果 | 一主两辅图片、caption 和事实摘要 |
| `minimal-epilogue` | 结尾 | 极简结论、行动项、品牌母题回收 |

### 5.3 Scene 必须声明的内容

每个 Scene 必须明确：

- 内容适用条件；
- 图片数量和比例；
- 无图降级 Scene；
- 标题最大长度；
- 正文和数据容量；
- 支持的明暗背景；
- 可用的字体层级；
- 三端渲染规则；
- 对应的质量检查项。

第一阶段不追求 Scene 数量，优先确保这八个场景在缩略图中具有明显差异。

---

## 6. 素材管线

商业 PPT 不能继续依赖空白卡片和装饰矩形。高质量图片、图表和数据证据必须成为正式编译输入。

### 6.1 处理流程

```text
assetBrief
   ↓
生成搜索查询
   ↓
获取图片候选
   ↓
过滤尺寸、比例、格式和重复项
   ↓
记录 sourcePage / sourceUrl / license
   ↓
下载并本地化
   ↓
计算焦点与安全裁切区域
   ↓
匹配 Scene asset slot
   ↓
写入 Presentation
```

### 6.2 硬约束

- 远程图片必须本地化后才能进入 Presentation。
- 图片必须保存来源页面和授权状态。
- 未知授权只能警告，不得宣称可商用。
- 图片尺寸不足时不得强制放大到全幅。
- 不符合比例时优先裁切，无法安全裁切时更换候选。
- 无可用素材时使用明确的无图降级 Scene，不保留空图片框。
- v2 第一阶段不自动调用图片生成模型。

### 6.3 复用现有能力

优先复用：

- `SearchSlideImages`
- 远程图片安全下载与本地化
- 图片来源和授权元数据
- `imageSlot` / `objectFit`
- PPTX、HTML、编辑器三端图片渲染

需要新增的是 Scene 级素材需求、候选评分和焦点裁切，而不是重新建设下载器。

---

## 7. 本地视觉导演

视觉导演使用确定性规则选择 Scene 和页面节奏，不增加模型调用。

### 7.1 Scene 选择输入

- `kind`
- `purpose`
- `visual.role`
- `visual.composition`
- 内容项数量
- 是否包含 metric/chart
- 素材是否可用
- 前后页面 Scene
- deck 级设计系统

### 7.2 页面节奏规则

- 连续两页不得使用完全相同的 Scene。
- 8 页 PPT 至少使用 5 种 Scene。
- 每 2–3 页至少出现一页强视觉页。
- 数据页优先使用 `metric-landscape` 或明确的数据 Scene。
- 案例和成果页在有合法素材时必须使用图片。
- 封面和结尾必须复用同一母题或视觉线索。
- 全套 PPT 不得全部使用浅色白底。
- 深色、浅色和图片背景的切换必须服务章节节奏。
- 不允许连续三页使用同构卡片。

### 7.3 确定性选择

Scene 选择采用可解释评分，而不是随机：

```text
score =
  purposeMatch
  + roleMatch
  + contentFit
  + assetFit
  + deckRhythmBonus
  - repetitionPenalty
  - densityPenalty
```

相同输入、相同素材候选和相同设计系统必须得到相同 Scene。

---

## 8. 确定性视觉编译器

编译器负责把 Scene、内容、素材和设计系统转换为现有 Presentation。

### 8.1 编译职责

- 生成稳定 slide/element ID；
- 根据 Scene 创建内容槽和素材槽；
- 解析字体层级、颜色和背景；
- 进行图片裁切和 treatment；
- 将重点信息映射为主标题、大数字或视觉锚点；
- 添加 caption、来源和必要的商业注释；
- 保证编辑器、HTML 和 PPTX 结果一致；
- 输出 PresentationCommand，继续经过 CommitGate 和用户审批。

### 8.2 编译原则

- Scene handler 是坐标和结构的单一事实源。
- Renderer 不再二次决定版式。
- 装饰必须属于主题母题，不能逐页随机添加。
- 复杂背景可以栅格化，前景文字、图表和关键形状保持原生可编辑。
- 空内容不生成空卡片；内容不足时重新选择 Scene。
- 图片缺失不保留灰色占位框。

---

## 9. 商业质量门

质量门分为硬失败和评分项。

### 9.1 硬失败

- 元素越界或关键遮挡；
- 空卡片、空图片槽或空比较栏；
- 标题不可见或正文小于可读阈值；
- `imageMode=required` 但无素材且没有降级；
- metric/chart 缺少来源；
- 不存在的 sourceRef；
- 远程图片未本地化；
- 非法 Scene 与内容组合；
- 预览和 PPTX 结构不一致。

### 9.2 视觉评分

```ts
type CommercialVisualScore = {
  hierarchy: number;
  composition: number;
  assetQuality: number;
  variety: number;
  rhythm: number;
  brandConsistency: number;
  editability: number;
};
```

第一阶段使用本地可计算指标：

- Scene 多样性；
- 标题、正文和主指标的字号层级差；
- 图片分辨率和槽位匹配度；
- 页面主要视觉区域占比；
- 空白区域是否失衡；
- 相邻页面结构重复度；
- 明暗背景节奏；
- 元素数量和文字密度；
- 来源覆盖率。

模型视觉复审可以作为后续能力，但不能成为 v2 的必要依赖。

---

## 10. Lean Mode v2 工作流

Lean Mode 继续保持一次内容模型调用：

```text
1 次模型调用：生成 DeckSpec v2
        ↓
0 次内容模型调用：视觉导演
        ↓
0 次内容模型调用：素材搜索、过滤和本地化
        ↓
0 次内容模型调用：确定性编译
        ↓
0 次内容模型调用：质量门
        ↓
用户预览和批准
```

说明：

- 图片搜索属于外部素材请求，不计入内容模型调用。
- 第一阶段不做模型驱动的自动返工。
- 质量门失败时返回明确原因，不静默触发第二次生成。
- Pro/Agent Mode 继续处理研究、附件、已有 PPT 修改和复杂多轮任务。

---

## 11. 实施顺序

### Phase 0：建立商业视觉基准

1. 固定一份 8 页真实商业 DeckSpec fixture。
2. 保存当前 Lean 输出作为 baseline。
3. 选择一组商业参考，只提炼设计语法，不做像素复制。
4. 建立整套缩略图 contact sheet。
5. 定义人工评分表和自动质量指标。

交付物：

- `tests/fixtures/commercial-visual/`
- baseline 截图；
- 参考构图清单；
- 商业视觉评分表。

### Phase 1：DeckSpec v2 与 Scene Pack 骨架

1. 增加 `CommercialVisualIntentV2`。
2. 增加 Commercial Scene registry。
3. 实现 `editorial-business` 的八个 Scene。
4. 先使用受控占位素材，验证构图能力。
5. 保持现有 Presentation、CommandBus 和 CommitGate 边界。

验收重点：不接真实素材时，缩略图也应明显摆脱同构白卡片。

### Phase 2：素材解析闭环

1. 将 `assetBrief` 转为图片查询。
2. 建立候选评分、比例过滤和去重。
3. 增加焦点裁切和 Scene slot 适配。
4. 建立无图降级规则。
5. 强化来源、授权和导出校验。

验收重点：图片服务于页面观点，不是随机装饰。

### Phase 3：视觉导演与商业质量门

1. 实现场景匹配评分。
2. 实现相邻页重复惩罚和 deck 节奏规则。
3. 增加硬失败校验。
4. 增加结构化商业视觉评分。
5. 将评分与失败原因展示在预览阶段。

验收重点：同一套内容不会生成连续同构页，失败原因可定位到具体页面和规则。

### Phase 4：主题包与品牌扩展

第一套主题包稳定后，再增加：

- `executive-report`
- `technology-launch`
- `premium-proposal`

最后再接入 `brand-profile -> theme pack / design tokens` 推导。

---

## 12. 第一阶段验收标准

以同一份 8 页商业汇报为基准：

1. 至少使用 5 种 Commercial Scene。
2. 不出现连续两页完全相同构图。
3. 至少 4 页具有有效视觉资产或强数据视觉。
4. 不出现空卡片、空图片框和无意义装饰矩形。
5. 每页都有一个明确视觉焦点。
6. 缩略图状态下可区分封面、总览、证据、案例、计划和结尾。
7. 封面与结尾形成视觉呼应。
8. 文字、图表和关键形状保持可编辑。
9. 编辑器、HTML 和 PPTX 三端结构一致。
10. 同一 DeckSpec 重复编译的 Presentation hash 一致。
11. 内容模型调用保持 1 次；仅在 Electron 成功生成 PNG 时，允许额外 1 次有边界的视觉复盘调用。
12. 相比当前 Lean baseline，人工商业视觉评分显著提高。

---

## 13. 与现有文档的关系

本方案不替代已有底层计划，而是增加“商业成品收敛层”：

| 现有文档 | 与本方案的关系 |
|----------|----------------|
| `visual-vocabulary-plan.md` | 提供系统能画什么的基础原语 |
| `visual-expression-system-plan.md` | 提供 Layout Grammar、Design Tokens 和 Render Evaluation 基础 |
| `ppt-style-capability-plan.md` | 记录图片槽、文字角色、页面变体和渲染能力建设 |
| `ppt-layout-state-machine-plan.md` | 约束 layout-plan 和执行链路 |
| `ppt-quality-attention-plan.md` | 解释多阶段 Agent 和注意力损耗问题 |
| 本文档 | 将以上能力收敛为 Lean Mode 的商业视觉产品目标和实施路线 |

已有的 Visual Vocabulary 与 Layout Grammar 是必要基础，但不足以自动形成商业成品。Commercial Scene、视觉导演、素材适配和商业质量门负责把底层能力组织成稳定的产品结果。

---

## 14. 明确禁止的回退方向

实施过程中不要：

- 因质量不足重新增加多轮内容模型修复；
- 让模型直接输出 PresentationElement；
- 让 Renderer 根据文本猜测布局；
- 用更多通用卡片掩盖 Scene 能力不足；
- 在没有素材策略时强制每页插图；
- 同时开发大量主题包；
- 只看单页大图，不检查整套缩略图节奏；
- 只统计 token 和 schema 成功率，不评估商业视觉完成度。

---

## 15. 首个实施切片

首个实现批次只做：

1. 一份固定 8 页商业 fixture；
2. `CommercialVisualIntentV2`；
3. Scene registry；
4. `cinematic-cover`、`numbered-overview`、`hero-narrative`、`split-case`；
5. 受控本地图片 fixture；
6. contact sheet 对比；
7. 确定性和三端渲染测试。

首批四个 Scene 能明显超过当前 Lean baseline 后，再继续实现其余场景和真实素材管线。

---

## 16. 一句话路线

**保留 Lean Mode 的一次内容调用和确定性边界，把升级重点从 Prompt 与通用卡片布局转向 Commercial Scene、素材管线、视觉导演和商业质量门。**

---

## 17. 交付与视觉复盘边界（已实现）

- 商业素材授权状态会写入 Presentation；未知授权默认阻断导出，用户可逐次明确批准，restricted 永远阻断。
- 图片候选综合语义、来源完整度、描述具体度、分辨率和目标比例排序；明确的主体方位进入焦点裁切，未明确时居中。
- bar / h-bar 导出为 PowerPoint 原生图表；Slide 支持 Speaker Notes；postflight 校验 chart part 与 notes part。
- Lean 首版通过确定性质量门后，在 Electron 中最多渲染 6 张 PNG，并最多执行 1 次视觉复盘调用。
- 视觉复盘最多修改 3 个已渲染页面，且只能修改 `visual` 字段；内容、事实、数字、来源、页序和商业目标不可修改。
- 缩略图不可用、复盘响应无效或修订版质量门失败时，保留首个已通过质量门的版本，并记录 `visualReviewStatus`，不重试。
