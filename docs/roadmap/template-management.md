# Presentation 模板管理与自动选择路线图

> 文档类型：活跃提案
> 状态：Proposed，**已选定为清扫收工后的下一产品主线**（尚未成为现行代码事实）
> 最后更新：2026-08-01
>
> 说明：本文件仅为提案；仓库中尚无独立模板领域模块。勿因 roadmap 存在而当作已实现。
> 产品优先级：优先于「PPTX 原生可编辑图表」专项；风险项（凭据/daemon/E2E）另见
> [capability-scorecard.md](../architecture/capability-scorecard.md) 风险 backlog，不阻塞本提案 Phase 1。
> 产品创建路径以 [工作流](../presentation/workflow.md) 的 SVG-native 为准；
> ArtifactRevision / PptJob 以 [Presentation Artifact 与 Job 生命周期](./presentation-lifecycle.md)
> （Implemented）为准。
>
> **与 Layout Grammar 的关系（已对照代码）**：模板方案**零依赖** Grammar。
> Layout Grammar / element-IR 已从产品作者表面下架；产品 STRICT SVG-only
>（`visualSource.kind === "svg"`）。由 `tests/svg-native-tool-surface.test.ts` 锁定
> 作者工具表面；模板交付面只走 design-spec + page-plan + 完整页面 SVG。

## 1. 背景

当前系统已经具备两类相邻能力：

- `src/design-system/` 提供内置视觉风格、配色、阅读模式和 Design System；
- 活路径由 `skills/ppt-design` 让模型选择 `visualStyle` 并写入 `design/design-spec.json`。
  历史三方向频谱（`SPECTRUM_PROFILES` / `ResolveDesignPlan`）已从仓库移除，不作为现行
  推荐实现；其关键词信号思路可迁入本提案的 template catalog matching。

但产品层还没有统一的“模板”领域能力：

- 设置页的“默认设计系统”主要是 Renderer 本地偏好，不是 Agent Mode 每次生成都能读取的
  项目事实；
- 活路径的自动风格选择是模型判断，不是带版本、适用条件、置信度回退的确定性模板解析；
- 系统没有 PPTX/POTX 上传、校验、解析、预览和项目级绑定协议；
- 当前 SVG-native 创建与 PPTX exporter 不会继承上传文件中的 master/layout，因此不能把
  “文件已上传”描述成“已严格套用模板”。

本提案把两个需求拆成互补能力：

1. **模板自动选择**：普通创建任务根据内容在系统内置模板中选择，无法可靠匹配时使用默认模板。
2. **模板上传**：用户有品牌母版、指定字体、页眉页脚或特殊版式要求时，显式导入并选择自定义模板。

## 2. 核心决策

模板解析必须遵守单一且可解释的优先级：

```text
用户显式指定视觉风格或自定义模板
  → 使用显式选择
否则，项目策略为 auto
  → 根据内容匹配内置模板
  → 低于可信阈值时回退默认模板
否则，项目策略为 default
  → 使用项目默认模板
```

优先级可简写为：

```text
explicit custom / explicit built-in > auto-selected built-in > project default > application default
```

关键含义：

- 上传模板是特殊定制入口，不进入普通自动推荐池；
- 自动选择只选择系统能够完整渲染、验证和导出的内置模板；
- 默认模板是自动选择的确定性回退，不是与自动选择并列的一次模型猜测；
- 选择结果必须固化到 `design/design-spec.json`（lifecycle `design_spec`），不能只存在于
  聊天文案或 Renderer `localStorage`。

## 3. “模板”在系统中的含义

现有视觉系统刻意避免让模型选择一套死坐标模板。本提案中的模板不是单页坐标壳，而是
一组可执行的设计约束和能力声明。

产品页面视觉作者源是完整页面 SVG（见 [Visual Expression System](../presentation/visual-system.md)）。
模板选择之后的页面构图只走 page-plan + SVG；**不**经过 Layout Grammar。
Grammar / element-IR 已从产品中移除，与模板协议无关，
不得作为 Phase 1 可执行载荷或验收条件。

### 3.1 内置模板

内置模板是系统维护的 `TemplateDescriptor + DesignSystemV2 + matching / guidance metadata`：

- deck 级视觉语言（锁定的 `DesignSystemV2` / preset）；
- 支持的内容密度、图表、图片和叙事角色偏好；
- SVG-native 构图指引与禁忌（来自 catalog behavior / composition prose，非 grammar variant）；
- 适合的主题、受众和演示场景；
- 版本和预览；
- 是否允许作为项目默认 / auto 回退候选。

页面级构图仍由 `slides/page-plan.json` 的内容与 `layoutIntent`、以及 Agent 写作的
`slides/svg/*.svg` 决定。选择内置模板只锁定 deck 级视觉约束，不会把整套演示退化为
重复卡片或固定坐标复制，也不会把已注销的 Grammar 作者工具重新注册进 Agent 表面。

### 3.2 上传模板

上传模板分为两个诚实的能力等级：

| 等级 | 能力 | 生成与导出语义 |
|---|---|---|
| `design-reference` | 提取配色、字体信息、画布、母版/版式名称和示例页结构，作为设计约束 | 由现有 SVG-native 管线重新生成页面；页面事实源仍是 SVG；不承诺保留原始 master |
| `master-backed` | 保留并复用原 PPTX/POTX 的 master、layout、placeholder、主题和重复元素 | 新页面绑定导入的 layout，导出继续携带原始母版关系 |

MVP 可以先交付 `design-reference`，但 UI 和结果必须明确显示“参考模板”。只有
master/layout/placeholder 和导出链路全部验证通过后，才能标记为 `master-backed`。
`design-reference` 改变的是 Design System / brand constraints / 设计上下文指引，
不改变“页面事实源仍是 SVG”。

## 4. 目标与非目标

### 4.1 目标

- 用户能选择“自动、默认、自定义”三种项目级策略；
- 普通任务能根据内容自动匹配明显不同的内置视觉风格；
- 没有可靠匹配时稳定回退默认模板；
- 自定义模板上传后进入受控项目资源，不依赖原始外部路径长期可用；
- 每次生成可以追溯“使用了哪个模板、哪个版本、为什么选择、是否发生回退”；
- 模板选择写入 `design-spec`，并成为 Agent 的结构化动态上下文；
- Editor、HTML 预览和 PPTX 导出对模板解析结果使用同一 Presentation 事实。

### 4.2 非目标

- 不让模型直接读任意外部文件路径；
- 不把上传文件自动加入所有项目的推荐池；
- 不通过 Prompt 假装实现 master/layout 复用；
- 不允许模板绕过 Presentation schema、质量门、CommitGate 或 PPTX postflight；
- 不把模板选择做成必须让用户比较 safe/shifted/bold 的固定流程；
- 不把已从注册表移除的 Grammar/命令轨作者工具重新暴露给模型；
- 不把 `layout` / `grammarVariant` / Scene 写进模板 descriptor 的可执行字段；
- 不在第一阶段实现 PowerPoint 所有动画、宏、ActiveX、嵌入对象和特殊字体兼容；
- Phase 1–2 不交付 `master-backed`（见 Phase 3）；
- 不把删除 `src/shared/layout-grammar*` 作为模板 Phase 1 的前置（那是独立遗留清理）。

## 5. 领域模型

建议在 `src/shared/` 建立独立模板协议，不把它塞进 `DesignSystemV2`。Design System
描述视觉结果，Template 描述来源、选择、能力和生命周期。

```ts
type TemplateKind = "builtin" | "uploaded";
type TemplateSupportLevel = "native" | "design-reference" | "master-backed";
type TemplatePolicyMode = "auto" | "default" | "custom";

interface TemplateDescriptor {
  id: string;
  revisionId: string;
  kind: TemplateKind;
  supportLevel: TemplateSupportLevel;
  name: string;
  description: string;
  preview?: TemplatePreview;
  designSystem: DesignSystemV2;
  matching: {
    topics: string[];
    audiences: string[];
    deliveryContexts: string[];
    argumentModes: ArgumentMode[];
    readingModes: ReadingMode[];
    density: Array<"calm" | "standard" | "dense">;
    capabilities: Array<"image" | "chart" | "table" | "diagram" | "long-text">;
  };
  /** SVG-native 构图指引；不是 grammar variant allow-list */
  authoringGuidance?: {
    composition: string;
    avoid: string[];
  };
  source?: UploadedTemplateSource;
}

interface ProjectTemplatePolicy {
  mode: TemplatePolicyMode;
  defaultTemplateId: string;
  customTemplateId?: string;
  customTemplateRevisionId?: string;
}

interface ResolvedTemplateSelection {
  templateId: string;
  templateRevisionId: string;
  source: "explicit-custom" | "explicit-builtin" | "auto" | "fallback";
  confidence?: number;
  reasons: string[];
  fallbackReason?: string;
}
```

持久化落点：

| 事实 | 位置 | 说明 |
|---|---|---|
| 应用默认模板 ID | App settings | 仅影响**新项目**初始化；不改已打开项目 |
| 项目策略 | `design/template-policy.json`（建议） | `auto` / `default` / `custom` 与项目默认、自定义引用 |
| 本次解析结果 | `design/design-spec.json` 内 `ResolvedTemplateSelection` | 写入即进入 lifecycle `design_spec` 哈希与下游 stale |
| 上传模板库 | `design/templates/**` | 二进制 + descriptor + inspection；见 §9 |

约束：

- `mode=custom` 必须引用可用、已验证的 uploaded template revision；
- `mode=auto` 不在 policy 文件中保存永久选中模板，而是在生成/更新 `design-spec` 时解析并固化
  `ResolvedTemplateSelection`；
- `defaultTemplateId` 必须始终指向可执行的内置模板；
- selection 引用 immutable revision，不能只引用可能被覆盖的文件名；
- uploaded source 的路径只由 Main/Project 层保存，Renderer 和模型只接触受控 ID、摘要和
  项目内相对路径；
- 勿与已删除的历史 `ConfirmedDesignSelection`（safe/shifted/bold spectrum）混名或
  共用存储命名。

### 5.1 单一事实源：resolver 与 SVG 锁

现行活路径中，模型可在 `ppt-design` 中自由选择 `visualStyle`。模板能力落地后必须收敛为
单一事实源，避免“代码已选模板”与“模型另选风格”双写。

规则：

1. 在写入或提交 `design/design-spec.json` 之前，由确定性 **template resolver** 根据
   `ProjectTemplatePolicy` + 已验证 communication signals 产出 `ResolvedTemplateSelection`。
2. `presentationDesignSystem` / `visualStyle` **必须**与 resolved template 的
   `designSystem` 锁一致（与今日 `SubmitSvgDeck` 对 DS 的 deep-equal 同级）。
3. 模型可以把自然语言归一化为 structured signals（受众、场景、密度偏好等），**不能**
   发明不存在的 template ID，也不能在 `mode=auto|default|custom` 下覆盖已解析的 template
   revision（除非用户本轮显式改选，并记为 `explicit-*`）。
4. 不提供三方向比较 UI；关键词/内容信号只进入本提案的 catalog matching，不复活
   已删除的 spectrum 推荐路径。
5. 内容大纲或页密度在首次锁定 `design-spec` 之后变化时，**不自动重选模板**；除非用户
   修改 project policy、显式要求重选，或 `design-spec` 被删除后重建。

## 6. 内置模板目录

当前 `DESIGN_PRESETS`（约 18 个 `VisualStyle`）可以成为视觉来源，但 **auto 池与项目默认**
不直接等于全部 preset。Phase 1 收敛为少量带 matching 元数据的 builtin template
（约 6–8 个），每个锁定一个 preset/`DesignSystemV2`；其余 style 仍可通过
`explicit-builtin`（用户点名 visual style）选用，但不进入自动评分池。

建议目录职责：

```text
Builtin Template Catalog
  ├─ identity: id / revision / label
  ├─ executable design system（一个锁定的 DesignSystemV2）
  ├─ semantic matching metadata
  ├─ SVG-native authoring guidance（composition / avoid）
  ├─ preview assets
  └─ fallback eligibility（可否作项目默认 / auto 回退）
```

目录是代码事实。模型可以说明和使用选择结果，但不能发明不存在的模板 ID。

Phase 1 auto 池至少覆盖并可测出稳定差异：

- 商务决策与咨询汇报；
- 技术、架构与产品说明；
- 数据、研究和财务报告；
- 教育、课程和培训；
- 品牌、发布和营销叙事；
- 文化、历史与编辑出版；
- 默认通用模板（例如基于 `swiss-minimal`）。

每个模板需要有稳定视觉差异，同时声明不擅长的内容。例如摄影主导模板不能在缺少图片
素材时留下空框；高密度数据模板不应用于舞台式极简发布。

## 7. 自动选择

### 7.1 输入

自动选择读取已经存在或可从当前 Query 提取的结构化事实。

**最小充分输入**（即可调用 resolver）：

- communication contract：受众、目标、核心信息、交付场景、会后用途；
- 用户本轮明确表达的视觉偏好和禁用项；
- brand profile 中的硬约束（若已有）。

**可选增强输入**（有则提高分数区分度，无则不得阻塞选择）：

- brief / outline 中的主题与行业；
- argument mode 和 reading mode；
- 页数、平均文本密度、图表/表格/图片需求。

不得使用：

- 仅凭会话标题；
- UI 主题色；
- 未验证的旧聊天结论；
- 模型自由生成的模板名称。

### 7.2 选择算法

选择应由确定性目录过滤与可解释评分完成。模型可以把自然语言归一化为结构化信号，但最终
候选是否合法、分数如何比较和何时回退由代码决定。

```text
hard filters
  → support level / required capabilities / brand constraints
candidate scoring
  → topic + audience + delivery + argument + reading + density + asset fit
confidence gate
  → select best built-in（仅 auto 池）
  → or fallback to project default
```

建议评分输出而不是只输出一个 ID：

```ts
interface TemplateMatchScore {
  templateId: string;
  score: number;
  matchedSignals: string[];
  penalties: string[];
}
```

首版不需要复杂机器学习。可测试的权重评分比不可解释的单次模型选择更适合作为产品基线：

- 硬能力缺失直接淘汰；
- 明确主题/交付场景获得高权重；
- 受众、阅读模式和内容密度获得中权重；
- 单个弱关键词不能单独越过可信阈值；
- 第一名低于阈值，或前两名差距过小，均使用默认模板；
- 同一结构化输入和同一 catalog revision 必须得到相同结果。

### 7.3 与 SVG-native 创建链的关系

推荐 / 创建链收敛为：

```text
communication contract（+ 可选结构化信号）
  → resolve project template policy（design/template-policy.json）
  → select/resolve TemplateDescriptor（代码 resolver）
  → lock DesignSystemV2 + ResolvedTemplateSelection into design/design-spec.json
  → slides/page-plan.json（内容与 layoutIntent）
  → slides/svg/*.svg（页面视觉作者源）
  → PreviewSvgPage / SubmitSvgDeck
```

用户明确指定视觉风格时，解析为显式内置模板；用户明确选择上传模板时，使用上传模板
的已验证 revision。只有没有显式选择时才执行自动匹配。

产品页模型为 STRICT SVG-only；模板验收不依赖 element-IR / `applyLayout`。

## 8. 默认模板

默认模板分为两层：

1. **应用默认**：安装时始终存在的内置模板，例如 `swiss-minimal` 对应的 builtin id；
2. **项目默认**：项目创建时从用户偏好快照得到，写入 `design/template-policy.json`，之后作为
   项目事实独立保存。

设置页修改应用默认不应悄悄改变已有项目。新项目初始化时复制当前应用默认 ID；项目内可
再次修改。

默认模板承担以下职责：

- `mode=default` 时直接使用；
- `mode=auto` 低置信度时回退；
- 自定义模板失效、被移除或验证失败时提供可恢复路径，但必须显示回退原因；
- catalog 升级时仍能通过 template revision 解释旧项目的生成结果。

## 9. 上传与导入流程

### 9.1 用户流程

```text
选择 .pptx / .potx
  → Main 读取并做边界校验
  → 计算 hash，复制为项目内 immutable source
  → 检查 OOXML 结构和风险项
  → 解析 theme / master / layout / placeholder / sample slides
  → 生成预览与 TemplateDescriptor
  → 用户显式设为当前项目模板（写入 policy，不自动覆盖）
```

导入成功和选择成功是两个不同事件。上传后可以先进入模板库，不自动覆盖当前项目策略。

### 9.2 文件与安全边界

模板是外部二进制输入，必须在 Main 进程处理：

- 仅接受 `.pptx` / `.potx`，并验证 ZIP/OOXML 内容，不能只信扩展名；
- 限制压缩包大小、entry 数量、单 entry 和总解压大小，防止 zip bomb；
- 拒绝宏、ActiveX、可执行嵌入对象和不支持的 package relationship；
- 外部链接、远程图片和字体只记录为风险/缺失，不在导入时自动访问网络；
- 文件名只用于展示，存储使用系统生成 ID 和 content hash；
- 复制到项目后不再依赖原始绝对路径；
- 同 hash 导入应幂等复用，不能生成无限重复副本；
- 删除或替换模板属于显式项目操作，不能由上传同名文件隐式覆盖。

建议项目结构：

```text
design/templates/
  index.json
  <template-id>/
    <revision-id>/
      source.pptx
      descriptor.json
      inspection.json
      preview/
```

与已落地的 lifecycle 关系：

- **`ResolvedTemplateSelection` 写入 `design/design-spec.json`**：Phase 1 即进入
  `design_spec` ArtifactRevision；内容变化经现有 observer 传播
  `page_plan` → `page_svg` → … stale。不必等待单独“lifecycle 整合阶段”。
- **`design/templates/**` 上传库**：路径不与现有 `design-spec` / brand-profile 冲突；
  Phase 2 起至少需要 content hash、schema validation 和原子写。将其提升为独立
  artifact kind、并在模板文件变更时建立到 `design_spec` 的依赖边，属于后续增强
  （见 Phase 4），不阻塞参考模板 MVP。
- 不能仅把外部绝对路径保存到 `localStorage`。

### 9.3 解析产物

`inspection.json` 至少记录：

- OOXML 类型、文件 hash、大小和导入时间；
- slide size 与宽高比；
- theme color scheme；
- major/minor/实际使用字体及缺失风险；
- master、layout 和 placeholder 清单；
- 固定页眉、页脚、Logo、页码和背景元素；
- 示例页数量与可用预览；
- 外部关系、嵌入对象和兼容性 warning；
- 判定的 support level。

解析失败不能留下一个可选择的“成功模板”。部分能力不支持时应返回 warning，并明确当前
只能作为 `design-reference`。

## 10. 真正的母版复用

`master-backed` 是**独立大工程阶段**，不等于解析出颜色和字体，也**不阻塞** Phase 1–2
交付。它与当前“整页 SVG 作者 + 导出派生 Presentation”存在结构性张力，完成它至少需要：

1. Presentation model 能表示 imported master/layout/placeholder 引用；
2. 填槽或编译路径能按 placeholder 语义填充内容，而不是把固定坐标复制成普通元素；
3. 重复元素保留 master → layout → slide 层级；
4. Editor/HTML 能预览继承后的实际页面；
5. PPTX exporter 能保留或重建 OOXML master/layout relationship；
6. postflight 能验证母版、layout、placeholder、主题和媒体引用；
7. 页面内容溢出时可以换 layout 或缩短内容，而不是破坏模板。

在这些条件完成前，系统只承诺“参考模板风格重新生成”，不承诺打开导出的 PPTX 后仍可在
PowerPoint 中切换并编辑原模板母版。

## 11. 状态与上下文边界

模板相关状态分三层：

| 状态 | 归属 | 示例 |
|---|---|---|
| 应用偏好 | Renderer/App settings | 新项目默认模板 ID |
| 项目策略 | `design/template-policy.json` | auto/default/custom、项目默认、自定义模板引用 |
| 本次解析结果 | `design/design-spec.json`（`design_spec` revision） | resolved template revision、理由、分数、回退原因 |

模板选择结果进入动态 System Context，但 Prompt 只解释已经由代码解析的事实：

```text
Template policy: auto
Resolved template: builtin/data-journalism@3
Selection source: auto
Reasons: data-heavy, investor audience, async reading
```

Prompt 不能承担：

- 检查模板 ID 是否存在；
- 决定上传文件是否安全；
- 保证默认回退；
- 保存选择结果；
- 宣称 exporter 已经保留母版。

`SystemPromptContext` 和 cache key 必须包含模型可见的模板 revision/selection 摘要。项目
策略或模板 revision 改变时只失效 dynamic suffix，不改变稳定 system prefix。

## 12. UI 设计

### 12.1 全局设置

“演示文档默认项”负责新项目默认值：

- 默认内置模板；
- 查看内置模板预览；
- 管理已上传模板库（Phase 2+）；
- 不直接改变当前已打开项目的选择。

### 12.2 项目级入口

项目创建/设计区域提供三个互斥选项：

- **自动选择（推荐）**：展示“系统将根据内容选择，无法判断时使用 ××”；
- **使用默认模板**：展示当前项目默认模板；
- **自定义模板**：选择已经导入的模板，或进入上传流程（Phase 2+）。

生成后在预览/设计摘要中显示：

- 模板名称和来源；
- 自动选择理由或回退原因；
- support level；
- “参考模板”或“母版模板”状态；
- 更换模板会使哪些下游 artifact stale（至少 `design_spec` 及依赖它的
  `page_plan` / `page_svg` / preview / proposal 链）。

只有用户明确要求比较模板时才展示多候选对比。普通创建任务直接使用推荐结果，避免增加
一次无意义确认。不默认展示 safe/shifted/bold 三方向选择。

## 13. 与现有架构的集成点

### Shared

- 新增 template descriptor、policy、inspection 和 selection schema；
- catalog 与 resolver 使用纯函数，便于确定性测试；
- 扩展 `svgDeckDesignSpecSchema` / `design/design-spec.json`，持久化
  `ResolvedTemplateSelection`（不要引入不存在的 `DeckDesignPlan` 类型名）。

### Main / Project

- 新增 native file picker 和 template import service（Phase 2）；
- 负责 OOXML 校验、受控复制、hash、inspection 和 preview；
- 项目级 `template-policy.json` 与 template index 原子持久化；
- 不通过通用文本编辑器修改二进制模板。

### Agent Runtime

- RunFactory 从项目事实构建 template dynamic context；
- 自动选择由领域 resolver 执行，模型只提供已验证的 communication signals；
- resolved selection 进入 prompt cache key 和 `design-spec`；
- `ppt-design` / Submit 锁与 §5.1 一致；
- 模板变更不修改 Query Loop，也不成为新的硬编码 Prompt stage。

### Presentation / Export

- `design-reference` 转换为 Design System、brand constraints 和 SVG 作者指引；
  页面仍经 PreviewSvgPage / SubmitSvgDeck；
- `master-backed` 需要独立 imported-deck 模型与 exporter（Phase 3）；
- 两种路径最终都经过 Presentation validation、CommitGate、preview 和 postflight。

## 14. 失败与回退

| 场景 | 行为 |
|---|---|
| 自动选择无可靠结果 | 使用项目默认，记录 `fallbackReason=low-confidence` |
| 自动候选不支持必需图表/图片能力 | 淘汰候选，继续评分或回退 |
| 上传文件不是有效 OOXML | 导入失败，不创建 template revision |
| 上传模板含不支持对象 | 根据风险拒绝，或降级为 `design-reference` 并显示 warning |
| 自定义模板文件损坏/丢失 | 阻止声称使用自定义模板；允许用户重新导入或确认回退默认 |
| 字体不可用 | 标记字体替代风险；预览和导出使用同一替代结果 |
| master-backed 导出 postflight 失败 | 导出失败，不降级后伪装为母版保真成功 |

回退是可观察事实，不是静默容错。用户选择自定义模板后，系统不能在失败时悄悄输出默认
风格并仍显示自定义模板名称。

## 15. 分阶段实施

### Phase 1：模板协议与内置目录（对齐 SVG-native + 现有 lifecycle）

- 建立 schema、catalog revision、`design/template-policy.json` 和
  `ResolvedTemplateSelection`；
- 把 auto 池收敛到约 6–8 个可解释 builtin（自 `DESIGN_PRESETS` 选取），关键词 matching
  作为 catalog 一等元数据实现（不依赖已删除的 spectrum 推荐模块）；
- selection 写入 `design/design-spec.json`，复用已有 `design_spec` revision / stale 传播；
- 落实 §5.1：resolver 锁定 DS，`ppt-design` / Submit 不得另选冲突风格；
- Agent 动态上下文读取 policy 与 resolved selection；
- UI 提供自动/默认选择；Phase 1 不提供无效上传按钮。

### Phase 2：上传参考模板

- 增加 PPTX/POTX file picker、导入、hash、OOXML 安全检查和项目内 `design/templates/` 存储；
- 提取 theme、字体、master/layout 摘要和预览；
- 生成 `design-reference` descriptor；
- 选择后把约束投影到 Design System / Brand Profile / 设计上下文；
- 明确展示不能保留原始母版；页面事实源仍是 SVG。

### Phase 3：母版驱动编译与导出（可选独立大工程）

- 扩展 Presentation imported master/layout 模型；
- placeholder-aware 填槽或等价编译；
- Editor/HTML/PPTX 三端继承一致；
- master/layout OOXML export 与 postflight；
- 通过真实 PowerPoint/WPS/Keynote 样例验收后启用 `master-backed`。
- **不阻塞** Phase 1–2 的产品交付。

### Phase 4：上传库的 lifecycle 一等公民化（增强，非 selection 前提）

- 将 template source / inspection 提升为可选 ArtifactRevision kind，或建立
  `design/templates/**` → `design_spec` 的显式依赖边；
- 模板库文件变更时确定性标记依赖该 revision 的 `design_spec` 及下游
  `page_plan` / `page_svg` / preview / proposal / export；
- 支持版本比较、恢复和项目迁移。
- 注意：Phase 1 的 selection stale 已由 `design_spec` 覆盖；本阶段只补上传库缺口。

## 16. 验收标准

### 自动选择

- 技术、财务、教育、品牌和文化类固定样例选择结果稳定且明显不同；
- 同一输入与 catalog revision 始终得到相同选择；
- 弱信号和冲突信号可靠回退项目默认；
- 用户显式选择永远覆盖自动选择；
- 选择理由、分数和回退原因可测试、可展示；
- `design-spec` 中 `ResolvedTemplateSelection` 与 `presentationDesignSystem` 一致，
  Submit 不得接受冲突 DS。

### 上传

- 非 OOXML、超限 ZIP、宏/危险嵌入对象被拒绝；
- 同文件重复导入幂等；
- 原始文件移动后项目模板仍可用；
- inspection/preview 失败时不会创建可选择的成功 revision；
- `design-reference` 与 `master-backed` 在 UI 和结果中不会混淆。

### 生成与导出

- resolved template revision 被写入 `design-spec` / `design_spec` revision；
- 变更 `design-spec` 内 selection/DS 会使正确的下游 artifact stale；
- Editor、HTML 和 PPTX 使用同一 resolved design；
- `design-reference` 路径下导出不声称保留原母版；
- master-backed 样例（仅 Phase 3）在 postflight 和真实 Office 应用中保留预期 master/layout；
- 任意失败都不会静默改用另一模板并报告成功。

### 回归验证

- catalog/resolver/schema 单元测试；
- template import 的路径、ZIP、OOXML、hash 和幂等测试（Phase 2+）；
- System Context 动态 section 与 cache invalidation 测试；
- project policy 持久化和 session 隔离测试；
- design-spec 锁与 Submit 一致性测试；
- Presentation/HTML/PPTX 一致性与 postflight 测试；
- `npm.cmd run typecheck`、`npm.cmd test`；
- master-backed 阶段额外运行真实 PPTX 生成并人工打开检查。

## 17. 关键设计结论

1. 模板上传和模板自动选择是两条能力，不应共享一个模糊的“模板选择”状态。
2. 自动选择只面向系统内置、可完整验证的模板；默认模板是低置信度回退。
3. 自定义模板必须由用户显式选择，并保存为项目内受控 revision。
4. Template 锁定 Design System 与 SVG 作者指引；页面构图由 page-plan + SVG 完成。
   Agent Grammar 作者面已从注册表移除；共享 Grammar 库与模板零耦合。
5. 模板决策由代码解析并写入 `design-spec`；Prompt 只消费可验证结果；与模型选风格
   不得双源。
6. “参考模板”与“母版保真模板”必须分级实现和展示；Phase 3 不阻塞 Phase 1–2。
7. selection 的 lifecycle/stale 在 Phase 1 即跟随 `design_spec`；上传库 artifact 一等公民化
   是后续增强，不形成第三套工作流状态机。
