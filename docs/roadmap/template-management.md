# Presentation 模板管理与自动选择路线图

> 文档类型：活跃提案
> 状态：Proposed，尚未成为现行代码事实
> 最后更新：2026-07-29
>
> 说明：本文件仅为提案；仓库中尚无独立模板领域模块。勿因 roadmap 存在而当作已实现。

## 1. 背景

当前系统已经具备两类相邻能力：

- `src/design-system/` 提供内置视觉风格、配色、阅读模式和 Design System；
- `src/shared/design-recommendation.ts` 可以根据主题、受众和使用场景推荐视觉方向。

但产品层还没有统一的“模板”领域能力：

- 设置页的“默认设计系统”主要是 Renderer 本地偏好，不是 Agent Mode 每次生成都能读取的
  项目事实；
- 自动推荐输出的是 Design System 方向，不是带版本、适用条件和能力说明的模板选择；
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
- 选择结果必须固化到项目/设计 artifact，不能只存在于聊天文案或 Renderer `localStorage`。

## 3. “模板”在系统中的含义

现有视觉系统刻意避免让模型选择一套死坐标模板。本提案中的模板不是单页坐标壳，而是
一组可执行的设计约束和能力声明。

### 3.1 内置模板

内置模板是系统维护的 `TemplateDescriptor + DesignSystem + capability metadata`：

- deck 级视觉语言；
- 支持的内容密度、图表、图片和页面角色；
- 可用的 Layout Grammar / Scene / Variant；
- 适合的主题、受众和演示场景；
- 版本和预览；
- 默认 Design System。

页面级构图仍由内容意图、Scene、Layout Grammar 和确定性编译器决定。选择内置模板不会
让整套演示退化为重复卡片或固定坐标复制。

### 3.2 上传模板

上传模板分为两个诚实的能力等级：

| 等级 | 能力 | 生成与导出语义 |
|---|---|---|
| `design-reference` | 提取配色、字体信息、画布、母版/版式名称和示例页结构，作为设计约束 | 由现有 SVG-native/Presentation 管线重新生成；不承诺保留原始 master |
| `master-backed` | 保留并复用原 PPTX/POTX 的 master、layout、placeholder、主题和重复元素 | 新页面绑定导入的 layout，导出继续携带原始母版关系 |

MVP 可以先交付 `design-reference`，但 UI 和结果必须明确显示“参考模板”。只有
master/layout/placeholder 和导出链路全部验证通过后，才能标记为 `master-backed`。

## 4. 目标与非目标

### 4.1 目标

- 用户能选择“自动、默认、自定义”三种项目级策略；
- 普通任务能根据内容自动匹配明显不同的内置视觉风格；
- 没有可靠匹配时稳定回退默认模板；
- 自定义模板上传后进入受控项目资源，不依赖原始外部路径长期可用；
- 每次生成可以追溯“使用了哪个模板、哪个版本、为什么选择、是否发生回退”；
- 模板选择进入 Design/Artifact 状态，并成为 Agent 的结构化动态上下文；
- Editor、HTML 预览和 PPTX 导出对模板解析结果使用同一 Presentation 事实。

### 4.2 非目标

- 不让模型直接读任意外部文件路径；
- 不把上传文件自动加入所有项目的推荐池；
- 不通过 Prompt 假装实现 master/layout 复用；
- 不允许模板绕过 Presentation schema、质量门、CommitGate 或 PPTX postflight；
- 不把模板选择做成必须让用户比较 safe/shifted/bold 的固定流程；
- 不在第一阶段实现 PowerPoint 所有动画、宏、ActiveX、嵌入对象和特殊字体兼容。

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
  source?: UploadedTemplateSource;
}

interface ProjectTemplatePolicy {
  mode: TemplatePolicyMode;
  defaultTemplateId: string;
  customTemplateId?: string;
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

约束：

- `mode=custom` 必须引用可用、已验证的 uploaded template revision；
- `mode=auto` 不保存一个永久模板结果，而是在设计 artifact 生成时解析并固化结果；
- `defaultTemplateId` 必须始终指向可执行的内置模板；
- selection 引用 immutable revision，不能只引用可能被覆盖的文件名；
- uploaded source 的路径只由 Main/Project 层保存，Renderer 和模型只接触受控 ID、摘要和
  项目内相对路径。

## 6. 内置模板目录

当前 `DESIGN_PRESETS` 可以成为首批内置模板的视觉来源，但需要增加匹配与能力元数据，
不能继续只依赖散落在推荐函数中的关键词数组。

建议目录职责：

```text
Builtin Template Catalog
  ├─ identity: id / revision / label
  ├─ executable design system
  ├─ semantic matching metadata
  ├─ supported scene / grammar capabilities
  ├─ preview assets
  └─ fallback eligibility
```

目录是代码事实。模型可以说明和使用选择结果，但不能发明不存在的模板 ID。

内置模板至少应区分：

- 商务决策与咨询汇报；
- 技术、架构与产品说明；
- 数据、研究和财务报告；
- 教育、课程和培训；
- 品牌、发布和营销叙事；
- 文化、历史与编辑出版；
- 默认通用模板。

每个模板需要有稳定视觉差异，同时声明不擅长的内容。例如摄影主导模板不能在缺少图片
素材时留下空框；高密度数据模板不应用于舞台式极简发布。

## 7. 自动选择

### 7.1 输入

自动选择读取已经存在或可从当前 Query 提取的结构化事实：

- communication contract：受众、目标、核心信息、交付场景、会后用途；
- brief / outline / storyboard 中的主题与行业；
- argument mode 和 reading mode；
- 页数、平均文本密度、图表/表格/图片需求；
- brand profile 中的硬约束；
- 用户本轮明确表达的视觉偏好和禁用项。

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
  → select best built-in
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

### 7.3 与现有设计推荐的关系

`ResolveDesignPlan` 仍负责沟通契约和设计方向，但模板选择不应再隐藏在
`SPECTRUM_PROFILES` 中。推荐链收敛为：

```text
communication contract
  → resolve project template policy
  → select/resolve TemplateDescriptor
  → derive or lock DesignSystemV2
  → page-level rhythm / layout intent
  → Scene / Layout Grammar / SVG-native compile
```

用户明确指定视觉风格时，可以解析为显式内置模板；用户明确选择上传模板时，使用上传模板
的已验证 revision。只有没有显式选择时才执行自动匹配。

## 8. 默认模板

默认模板分为两层：

1. **应用默认**：安装时始终存在的内置模板，例如 `swiss-minimal`；
2. **项目默认**：项目创建时从用户偏好快照得到，之后作为项目事实独立保存。

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
  → 用户显式设为当前项目模板
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

这些文件未来应纳入
[Presentation Artifact 与 Job 生命周期](./presentation-lifecycle.md) 的 immutable
revision/dependency 体系。在该路线落地前，至少需要 content hash、schema validation
和原子写，不能仅把外部路径保存到 `localStorage`。

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

`master-backed` 是独立工程阶段，不等于解析出颜色和字体。完成它至少需要：

1. Presentation model 能表示 imported master/layout/placeholder 引用；
2. Compiler 能按 placeholder 语义填充内容，而不是把固定坐标复制成普通元素；
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
| 项目策略 | Project/Presentation artifact | auto/default/custom、项目默认、自定义模板引用 |
| 本次解析结果 | Deck Design artifact | resolved template revision、理由、分数、回退原因 |

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
- 管理已上传模板库；
- 不直接改变当前已打开项目的选择。

### 12.2 项目级入口

项目创建/设计区域提供三个互斥选项：

- **自动选择（推荐）**：展示“系统将根据内容选择，无法判断时使用 ××”；
- **使用默认模板**：展示当前项目默认模板；
- **自定义模板**：选择已经导入的模板，或进入上传流程。

生成后在预览/设计摘要中显示：

- 模板名称和来源；
- 自动选择理由或回退原因；
- support level；
- “参考模板”或“母版模板”状态；
- 更换模板会使哪些下游设计/编译 artifact stale。

只有用户明确要求比较模板时才展示多候选对比。普通创建任务直接使用推荐结果，避免增加
一次无意义确认。

## 13. 与现有架构的集成点

### Shared

- 新增 template descriptor、policy、inspection 和 selection schema；
- catalog 与 resolver 使用纯函数，便于确定性测试；
- `DeckDesignPlan`/未来 Artifact Revision 保存 selection。

### Main / Project

- 新增 native file picker 和 template import service；
- 负责 OOXML 校验、受控复制、hash、inspection 和 preview；
- 项目级 policy 与 template index 原子持久化；
- 不通过通用文本编辑器修改二进制模板。

### Agent Runtime

- RunFactory 从项目事实构建 template dynamic context；
- 自动选择由领域 resolver 执行，模型只提供已验证的 communication signals；
- resolved selection 进入 prompt cache key 和设计 artifact；
- 模板变更不修改 Query Loop，也不成为新的硬编码 Prompt stage。

### Presentation / Export

- `design-reference` 转换为 Design System、brand constraints 和 layout guidance；
- `master-backed` 需要独立 imported-deck compiler/exporter；
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

### Phase 1：模板协议与内置目录

- 建立 schema、catalog revision、project policy 和 resolved selection；
- 把现有 `DESIGN_PRESETS` 与关键词推荐收敛到可解释 catalog/resolver；
- Agent Mode 读取项目默认与自动选择结果；
- 增加低置信度默认回退；
- UI 提供自动/默认选择，不先做无效上传按钮。

### Phase 2：上传参考模板

- 增加 PPTX/POTX file picker、导入、hash、OOXML 安全检查和项目内存储；
- 提取 theme、字体、master/layout 摘要和预览；
- 生成 `design-reference` descriptor；
- 选择后把约束投影到 Design System/Brand Profile/设计上下文；
- 明确展示不能保留原始母版。

### Phase 3：母版驱动编译与导出

- 扩展 Presentation imported master/layout 模型；
- placeholder-aware compile；
- Editor/HTML/PPTX 三端继承一致；
- master/layout OOXML export 与 postflight；
- 通过真实 PowerPoint/WPS/Keynote 样例验收后启用 `master-backed`。

### Phase 4：生命周期整合

- 模板 source、inspection、selection 和 compiled deck 接入 immutable Artifact Revision；
- 模板 revision 变化确定性标记 DesignPlan、CompiledDeck、QualityReport 和 Export stale；
- 支持版本比较、恢复和项目迁移。

## 16. 验收标准

### 自动选择

- 技术、财务、教育、品牌和文化类固定样例选择结果稳定且明显不同；
- 同一输入与 catalog revision 始终得到相同选择；
- 弱信号和冲突信号可靠回退项目默认；
- 用户显式选择永远覆盖自动选择；
- 选择理由、分数和回退原因可测试、可展示。

### 上传

- 非 OOXML、超限 ZIP、宏/危险嵌入对象被拒绝；
- 同文件重复导入幂等；
- 原始文件移动后项目模板仍可用；
- inspection/preview 失败时不会创建可选择的成功 revision；
- `design-reference` 与 `master-backed` 在 UI 和结果中不会混淆。

### 生成与导出

- resolved template revision 被写入设计 artifact；
- 模板变更会使正确的下游 artifact stale；
- Editor、HTML 和 PPTX 使用同一 resolved design；
- master-backed 样例在 postflight 和真实 Office 应用中保留预期 master/layout；
- 任意失败都不会静默改用另一模板并报告成功。

### 回归验证

- catalog/resolver/schema 单元测试；
- template import 的路径、ZIP、OOXML、hash 和幂等测试；
- System Context 动态 section 与 cache invalidation 测试；
- project policy 持久化和 session 隔离测试；
- Presentation/HTML/PPTX 一致性与 postflight 测试；
- `npm.cmd run typecheck`、`npm.cmd test`；
- master-backed 阶段额外运行真实 PPTX 生成并人工打开检查。

## 17. 关键设计结论

1. 模板上传和模板自动选择是两条能力，不应共享一个模糊的“模板选择”状态。
2. 自动选择只面向系统内置、可完整验证的模板；默认模板是低置信度回退。
3. 自定义模板必须由用户显式选择，并保存为项目内受控 revision。
4. Template、Design System、Layout Grammar 和单页 Scene 各有职责，不能互相替代。
5. 模板决策由代码解析和持久化，Prompt 只消费可验证结果。
6. “参考模板”与“母版保真模板”必须分级实现和展示。
7. 模板能力最终应接入 Presentation Artifact/Job 生命周期，而不是形成第三套工作流状态。
