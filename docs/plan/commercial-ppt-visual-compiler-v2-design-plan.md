# 商业 PPT 视觉编译器 v2 设计方案

> 依据：`docs/commercial-ppt-visual-compiler-v2.md`  
> 范围：Lean Mode 新建商业 PPT  
> 目标：在一次内容模型调用、确定性编译、用户审批和现有 Presentation 边界不变的前提下，把 Lean 输出升级为具有商业叙事、视觉焦点、素材证据和整套节奏的可交付初稿。  
> 本文不指定实施时间，只定义代码方向、模块边界、实施顺序和验收结果。

---

## 1. 结论

当前代码已经具备 v2 所需的大部分底座，但尚未形成商业视觉编译产品链路：

- 已具备严格的 Lean DeckSpec、一次模型调用和确定性替换式编译；
- 已具备 DesignSystem、Layout Grammar、图片槽位、图片本地化、来源元数据和三端渲染；
- 已具备 CommitGate、布局/样式/素材校验、缩略图和基础视觉评分；
- 当前 Lean 编译仍把 schema、内容适配、版式映射、元素创建和命令生成集中在 `src/shared/lean-mode.ts`；
- 当前 Layout/Grammar/Slot 仍有多个事实源，Commercial Scene 无法直接建立在稳定的可执行契约之上；
- 图片搜索仍是 Agent 工具流程，没有成为 Lean 可直接调用的素材解析服务；
- 视觉评分、deck rhythm 和素材审计尚未组成 Lean 的商业质量门；
- PPTX 中的 chart 仍以栅格化视觉为主，尚不能满足“关键图表可编辑”的最终要求。

因此，v2 **需要模块抽取和抽象设计**，但不需要重写底层 Presentation、Renderer、CommandBus 或 CommitGate。

推荐采用以下主链路：

```text
一次内容模型调用
  -> DeckSpec v2
  -> CommercialVisualDirector（纯函数）
  -> DirectedDeckPlan
  -> CommercialAssetResolver（有副作用）
  -> ResolvedAssetManifest
  -> CommercialSceneCompiler（纯函数）
  -> Presentation + PresentationCommand[]
  -> CommercialQualityGate
  -> CommitGate
  -> 预览 / 审批 / 应用 / 导出
```

核心原则：

1. DeckSpec 只保存内容和视觉语义，不保存坐标。
2. Director 只做可解释的场景与节奏决策，不生成元素。
3. Asset Resolver 只解析和固化素材，不修改商业叙事。
4. Scene Compiler 是坐标、槽位和场景结构的单一事实源。
5. Renderer 忠实消费 Presentation，不再次推断 Scene。
6. 质量门基于编译结果关闸，不触发第二次内容模型调用。
7. 确定性定义为：相同 DeckSpec、DesignSystem、ResolvedAssetManifest 和编译器版本得到相同 canonical Presentation hash。

---

## 2. 当前代码能力审核

### 2.1 可直接复用的能力

| 能力 | 当前实现 | v2 用法 |
|------|----------|---------|
| 一次内容模型调用 | `src/main/agent/lean/lean-presentation-service.ts` | 保留调用次数、唯一工具提交和失败不重试语义 |
| 严格 DeckSpec | `src/shared/lean-mode.ts` 的 Zod schema | 演进为 v1/v2 版本联合契约 |
| 确定性 Lean 输出 | `compileLeanDeckSpec` + 最终元素 ID 归一化 | 下沉为统一 `DeterministicIdFactory` 和 canonical hash |
| 设计系统 | `src/design-system/*` | 新增 `editorial-business` preset/pack，复用颜色、字体、背景解析 |
| Layout Grammar | `src/shared/layout-grammar.ts`、部分 `layout-handlers/*` | 作为 Scene 底层原语，不作为 Commercial Scene 本身 |
| 图片槽位与 treatment | `layout-slots.ts`、`ImageElement` | 由 Scene Contract 统一声明并生成 |
| 图片搜索 | `SearchSlideImages` | 抽取底层搜索服务供 Agent Tool 与 Lean 共用 |
| 图片安全本地化 | `src/main/agent/assets/image-asset.ts` | 原样复用下载安全、hash、本地路径和来源元数据 |
| 素材校验 | `AssetValidator`、`visual-asset-audit.ts` | 扩展为 Scene 级 required/optional/fallback 校验 |
| 结构校验 | `LayoutValidator`、`StyleValidator` | 继续负责通用硬错误 |
| CommitGate | `src/main/agent/gate/commit-gate.ts` | 保持最终命令沙箱、diff、审批和拒绝边界 |
| 缩略图 | `slide-thumbnail-service.ts` | 增加 deck contact sheet 生成 |
| 视觉评分 | `src/design-system/evaluation.ts` | 作为商业评分的基础指标来源 |
| HTML/PPTX/编辑器渲染 | `slide-html-render.ts`、`ppt-exporter.ts`、`SlideElementRenderer.tsx` | 保持 Presentation 为共同输入，补充一致性契约测试 |

### 2.2 当前真实缺口

#### A. Lean 编译职责过度集中

`src/shared/lean-mode.ts` 同时承担：

- DeckSpec schema；
- 跨页内容校验；
- kind 到 layout 的选择；
- 内容到原始元素的适配；
- 稳定 ID；
- DesignSystem 选择；
- layout 调用；
- 来源页脚；
- Presentation 和 Command 生成。

继续在该文件中加入 visual intent、Scene、素材和质量评分会形成新的大单体，并让纯编译和有副作用的素材解析无法分离。

#### B. Layout 尚未成为稳定的插件边界

- `src/shared/layout.ts` 仍是大型集中式实现；
- `layoutRegistry` 主要保存元数据，`apply` 不是实际执行入口；
- cover、section、process、case、image-grid 已有 grammar handler，但主文件仍保留旧分支；
- comparison、concept、architecture、summary、toc 等仍位于主文件；
- `layout-slots.ts` 独立重复维护部分槽位坐标，handler 和 slot contract 不是同一事实源。

Commercial Scene 若直接依赖现状，会同时依赖 registry、grammar handler、`applyLayout` 分支和 `layout-slots.ts`，难以保证槽位、校验和实际坐标一致。

#### C. 素材能力是工具能力，不是产品管线

现有能力可以搜索、下载和插入单张图片，但缺少：

- `assetBrief -> query` 的确定性转换；
- 候选尺寸、比例、格式、重复度和来源完整度评分；
- 固化的素材清单；
- 图片尺寸探测和最小分辨率规则；
- 焦点、安全裁切区域；
- Scene slot 与候选的批量匹配；
- 明确的无图降级决策。

当前搜索候选排序主要依据来源信息是否存在，不能直接支撑 Commercial Scene 的自动素材选择。

#### D. 质量能力存在，但没有形成 Lean 商业质量门

- CommitGate 已运行通用 layout/style/asset validators；
- `evaluateDeckVisualQuality` 主要接入 Agent style/edit 的 render feedback；
- `validateDeckRhythm` 主要接入 LayoutPlan 和工具；
- 素材审计以通用 layout/grammar 推断图片需求；
- Lean Proposal 编译完成后没有专门的 Commercial Scene、节奏、焦点、素材和确定性报告。

v2 应组合现有检查，而不是再建一套不接 CommitGate 的评分系统。

#### E. 可编辑性目标存在一处明确差距

文字、形状和图片可在 PPTX 中保持原生对象；chart 当前在 PPTX 导出侧主要通过 SVG/图片表达。最终验收若要求“图表可编辑”，必须增加商业图表的原生编译路径，不能只把已有 chart 栅格化后计为通过。

#### F. 确定性边界需要显式化

Lean 当前通过最后一次元素 ID 归一化获得稳定结果，但通用 layout helper 内部仍使用 `randomUUID`/随机 ID。v2 不应依赖“编译结束后碰巧覆盖 ID”，而应把 ID 生成器作为编译上下文依赖。

此外，外部搜索结果会变化。“相同 DeckSpec 重复编译一致”应精确定义为相同的 **ResolvedAssetManifest** 输入，而不是每次重新搜索互联网仍要求结果一致。

---

## 3. 目标架构与职责

### 3.1 分层

| 层 | 输入 | 输出 | 是否允许副作用 |
|----|------|------|----------------|
| Lean Content | 用户需求 | DeckSpec v2 | 仅一次模型调用 |
| Spec Validation | DeckSpec v2 | ValidatedDeckSpec | 否 |
| Visual Director | ValidatedDeckSpec + pack 摘要 | DirectedDeckPlan | 否 |
| Asset Planning | DirectedDeckPlan | AssetRequest[] | 否 |
| Asset Resolution | AssetRequest[] + workspace | ResolvedAssetManifest | 是：搜索、读取、下载、写本地素材 |
| Scene Compilation | spec + plan + manifest + pack | Presentation | 否 |
| Command Compilation | base + Presentation | PresentationCommand[] | 否 |
| Commercial Quality | 上述所有产物 | CommercialQualityReport | 否 |
| Commit | commands + current Presentation | CommitGateResult | 仅沙箱试运行；应用仍需审批 |

### 3.2 中间产物

#### DirectedDeckPlan

Director 的结果必须是可记录、可解释、可测试的独立产物：

```ts
type DirectedDeckPlanV1 = {
  version: 1;
  packId: "editorial-business";
  compilerVersion: string;
  slides: DirectedSlidePlanV1[];
};

type DirectedSlidePlanV1 = {
  slideIndex: number;
  sceneId: CommercialSceneId;
  variantId: string;
  backgroundMode: "light" | "dark" | "image";
  emphasis: string[];
  assetRequests: AssetRequestV1[];
  fallbackSceneId: CommercialSceneId;
  score: SceneSelectionScore;
  rationaleCodes: string[];
};
```

该产物不进入模型上下文，也不包含元素坐标。它用于调试、质量报告、fixture 和确定性测试。

#### ResolvedAssetManifest

```ts
type ResolvedAssetManifestV1 = {
  version: 1;
  assets: ResolvedAssetV1[];
};

type ResolvedAssetV1 = {
  requestId: string;
  slotId: string;
  status: "resolved" | "unavailable";
  sha256?: string;
  localPath?: string;
  mimeType?: "image/png" | "image/jpeg" | "image/gif";
  pixelWidth?: number;
  pixelHeight?: number;
  focalPoint?: { x: number; y: number };
  safeCrop?: { x: number; y: number; width: number; height: number };
  sourceUrl?: string;
  sourcePageUrl?: string;
  provider?: string;
  licenseStatus: "verified" | "unknown" | "restricted";
  license?: string;
  attribution?: string;
  rejectionCodes: string[];
};
```

Manifest 是确定性编译的素材输入。网络候选变化只影响 manifest 生成，不影响相同 manifest 的重复编译结果。

---

## 4. 建议代码模块

```text
src/
  commercial-visual/
    contracts/
      visual-intent.ts
      directed-deck-plan.ts
      asset-manifest.ts
      quality-report.ts
    director/
      commercial-visual-director.ts
      scene-scoring.ts
      rhythm-policy.ts
    scenes/
      scene-contract.ts
      scene-registry.ts
      scene-compiler-context.ts
      editorial-business/
        index.ts
        theme.ts
        cinematic-cover.ts
        numbered-overview.ts
        hero-narrative.ts
        split-case.ts
        dual-evidence.ts
        metric-landscape.ts
        project-gallery.ts
        minimal-epilogue.ts
    assets/
      asset-request-planner.ts
      candidate-scoring.ts
      image-probe.ts
      crop-planner.ts
      commercial-asset-resolver.ts
    compiler/
      commercial-deck-compiler.ts
      commercial-content-adapter.ts
      deterministic-id-factory.ts
      native-chart-compiler.ts
      command-compiler.ts
      canonical-presentation-hash.ts
    quality/
      commercial-quality-gate.ts
      commercial-hard-validator.ts
      commercial-visual-scorer.ts
      contact-sheet-service.ts
```

Lean 层调整为：

```text
src/shared/lean/
  deck-spec-v1.ts
  deck-spec-v2.ts
  deck-spec.ts
  spec-migration.ts

src/main/agent/lean/
  lean-presentation-service.ts
  lean-v2-pipeline.ts
```

不建议把整个目录放在 `src/shared`：素材搜索、下载和本地化属于 main 进程副作用。纯 contracts/director/compiler/quality 可以被 shared 与 main 引用；`assets/commercial-asset-resolver.ts` 应位于 main 可执行边界，或通过接口注入。

### 4.1 必须抽取的模块

#### `DeckSpec v1/v2`

从 `lean-mode.ts` 抽出 schema、类型和跨页校验。保留：

- `leanDeckSpecV1Schema`；
- `leanDeckSpecV2Schema`；
- `leanDeckSpecSchema = z.discriminatedUnion("version", ...)`；
- v1 到内部 normalized spec 的显式迁移；
- 结构化输出仍只使用当前目标版本的 JSON Schema。

不允许用宽松 `.passthrough()` 兼容版本；未知字段继续失败。

#### `DeterministicIdFactory`

所有 Scene 生成的 slide、element、shape、caption 和 command ID 都必须来自：

```ts
interface DeterministicIdFactory {
  id(namespace: string, ...semanticPath: unknown[]): string;
}
```

Scene handler 不得调用 `crypto.randomUUID()` 或 `Math.random()`。

#### `CommercialSceneRegistry`

Scene registry 必须是真正的可执行注册表，不复制当前仅保存 layout 元数据的模式：

```ts
type CommercialSceneDefinition = {
  id: CommercialSceneId;
  packId: string;
  supportedRoles: CommercialRole[];
  supportedPurposes: LeanSlidePurpose[];
  constraints: SceneContentConstraints;
  assetSlots: SceneAssetSlot[];
  variants: SceneVariantDefinition[];
  fallbackSceneId?: CommercialSceneId;
  analyze(input: SceneAnalyzeInput): SceneFitResult;
  compile(input: CommercialSceneCompileInput): CompiledScene;
};
```

`analyze` 和 `compile` 必须共享同一个 constraints/slots 定义。不得在 quality validator 或 `layout-slots.ts` 再写一份场景槽位坐标。

#### `CommercialVisualDirector`

Director 是纯函数，禁止：

- 访问网络；
- 生成 PresentationElement；
- 修改 DeckSpec；
- 使用随机数；
- 根据 Renderer 输出反向猜布局。

排序必须使用固定权重和固定 tie-break：

```text
roleMatch
+ purposeMatch
+ compositionMatch
+ contentFit
+ assetAvailability
+ rhythmBonus
- repetitionPenalty
- densityPenalty
- fallbackPenalty
```

分数相同时按 pack 中 Scene 顺序、variant 顺序稳定选择。

#### `CommercialAssetResolver`

将现有 Agent 工具中的搜索执行逻辑抽为可复用服务：

```ts
interface ImageSearchService {
  search(request: ImageSearchRequest): Promise<ImageCandidate[]>;
}
```

`SearchSlideImages` 继续作为工具适配器；Lean Pipeline 直接调用 service，不调用工具层。

`localizeImageAsset` 保持底层下载器职责，不承载候选选择或 Scene 决策。

#### `CommercialQualityGate`

商业质量门组合而不是替代现有校验：

```text
presentationSchema
  + DeckValidationService
  + validateDeckRhythm 的商业扩展
  + auditPresentationVisualAssets 的 Scene 版本
  + evaluateDeckVisualQuality
  + CommercialHardValidator
  + canonical hash / renderer parity checks
```

返回统一报告：

```ts
type CommercialQualityReport = {
  passed: boolean;
  hardFailures: CommercialQualityIssue[];
  warnings: CommercialQualityIssue[];
  scores: CommercialVisualScore;
  slideResults: CommercialSlideQualityResult[];
  sceneStats: SceneUsageStats;
  assetStats: AssetCoverageStats;
  determinism: DeterminismResult;
};
```

### 4.2 应复用而不重建的模块

- `Presentation` 和 `PresentationCommand`；
- `CommandBus` 和 `CommitGate`；
- DesignSystem resolver、颜色、字体、背景；
- 图片下载安全和本地缓存；
- HTML/PPTX/编辑器的元素渲染；
- slide thumbnail service；
- 通用 layout/style/asset validators。

### 4.3 需要先偿还的布局技术债

在新增八个 Scene 前，完成一次小范围 Layout 执行边界收敛：

1. `layoutRegistry.apply` 成为真实执行入口，或明确废弃它并统一使用 `layoutGrammarRegistry`；
2. 将 `layout.ts` 中剩余集中分支逐步抽到 handler；
3. 删除已由 grammar handler 覆盖的旧分支；
4. slot rect、slot requirement 和 handler placement 合并到同一 handler/Scene contract；
5. helper 接收 `IdFactory`，移除布局生成元素的随机 ID；
6. `applyLayout` 只负责构建 context、选择 handler、保存元数据和保留用户元素。

该工作不是为了先把所有旧 layout 重写，而是避免 Commercial Scene 继续依赖不稳定的多事实源。

---

## 5. DeckSpec v2 设计

### 5.1 视觉语义

在每页增加必填 `visual`：

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
  assetBrief: string;
  emphasis: string[];
};
```

### 5.2 校验规则

- `version` 必须为 `2`；
- `imageMode="none"` 时 `assetBrief` 必须为空；
- `imageMode!="none"` 时 `assetBrief` 必须非空且不得包含 URL；
- `emphasis` 为 1–3 项；
- emphasis 必须能在当前 slide 的可见内容单元中精确匹配；
- 不接受坐标、字号、颜色、阴影、URL、sceneId；
- role/purpose/kind 的非法组合在 schema refinement 中失败；
- `required` 不保证一定有图片，但必须生成素材请求和无图 fallback；
- 保留现有 sourceRef、内容密度、首尾页和跨页叙事规则。

### 5.3 模型调用边界

更新 Lean system prompt 和 submit tool schema，使模型只输出 v2。模型可以建议 composition，但不能选择最终 Scene。

以下行为保持不变：

- 恰好一次内容模型请求；
- schema 失败不进行第二次模型修复；
- 不进行外部事实研究；
- 不伪造图片来源和授权；
- 不输出 PresentationElement。

---

## 6. Commercial Scene Pack 设计

### 6.1 Scene 与 Layout Grammar 的关系

Commercial Scene 是产品级构图，Layout Grammar 是底层排版原语：

```text
Commercial Scene
  = 内容约束
  + 素材槽位
  + Scene variant
  + 背景模式
  + emphasis 映射
  + caption/source 规则
  + 可执行 compile
  + fallback
  + quality rules
```

Scene 可以调用通用 typography、shape、image treatment、chart primitive，也可以复用稳定的 Layout Grammar helper；但不能只把 Scene 做成 `layout + grammarVariant` 的别名。

### 6.2 `editorial-business` 首包

| Scene | 主要输入 | 必要素材 | 无素材降级 |
|-------|----------|----------|------------|
| `cinematic-cover` | cover/opening/hero | optional，full-bleed variant 为 required | 深色大标题封面 |
| `numbered-overview` | agenda/navigation/overview | none | 本身即无图 |
| `hero-narrative` | insight/solution/hero | optional 或 required | 强结论 + editorial block |
| `split-case` | context/proof/solution | optional | 指标/事实侧栏 |
| `dual-evidence` | comparison/proof | 0 或 2，禁止只留一侧空槽 | 双指标或原生对比结构 |
| `metric-landscape` | metric/chart/proof | optional | 原生数据视觉占主导 |
| `project-gallery` | gallery/proof | required，至少 3 个有效槽 | 改选 `split-case`，不生成空 gallery |
| `minimal-epilogue` | close/ask/statement | none | 本身即无图 |

### 6.3 Scene 编译输出

每个 Scene 返回：

```ts
type CompiledScene = {
  slide: Slide;
  sceneRef: {
    packId: string;
    sceneId: string;
    variantId: string;
  };
  consumedContentIds: string[];
  consumedAssetRequestIds: string[];
  diagnostics: SceneCompileDiagnostic[];
};
```

建议为 `Slide` 增加可选 `sceneRef` 元数据，而不是复用 `layout` 字段保存 Scene。`layout`/`grammarVariant` 仍可用于兼容现有编辑和通用工具。

### 6.4 内容适配

不要让 Scene 直接解析 Lean 的多个 nullable 分支。先通过 `CommercialContentAdapter` 转为统一 content units：

```ts
type CommercialContentUnit =
  | { type: "title"; id: string; text: string }
  | { type: "subtitle"; id: string; text: string }
  | { type: "item"; id: string; heading: string; detail: string }
  | { type: "comparison"; id: string; left: Column; right: Column }
  | { type: "metric"; id: string; value: string; label: string; takeaway: string }
  | { type: "chart"; id: string; chart: LeanChart }
  | { type: "source"; id: string; text: string };
```

Scene 以 content units 和约束工作，避免重复编写 kind 分支。

---

## 7. 素材管线设计

### 7.1 流程

```text
visual.assetBrief
  -> AssetRequestPlanner
  -> ImageSearchService
  -> CandidateNormalizer
  -> ImageProbe
  -> CandidateScorer
  -> Deduplicator
  -> LocalizeImageAsset
  -> CropPlanner
  -> ResolvedAssetManifest
```

### 7.2 候选硬过滤

- 只接受现有 Presentation 支持的 PNG/JPEG/GIF；
- 候选 URL 必须通过现有公共地址和重定向安全检查；
- full-bleed 槽位不得使用低于目标输出像素预算的图片；
- 实际宽高比偏差超过安全裁切阈值且无安全裁切区域时淘汰；
- 同一 deck 默认不得重复使用相同 sha256；
- `licenseStatus="restricted"` 不得自动选用；
- 缺少 sourcePageUrl 或授权信息可保留为 unknown，但必须形成警告；
- 下载失败、格式签名不匹配、超尺寸或 workspace 越界为硬失败候选。

### 7.3 确定性候选评分

```text
score =
  semanticRelevance
  + aspectFit
  + resolutionFit
  + sourceCompleteness
  + licenseConfidence
  + focalSafety
  - duplicatePenalty
  - upscalePenalty
```

搜索服务若不提供可靠语义分数，第一阶段 `semanticRelevance` 使用稳定的查询词/描述词匹配；分数相同时使用规范化 source URL、候选索引和内容 hash 作为稳定 tie-break。

### 7.4 焦点与裁切

第一阶段不依赖视觉模型：

- 优先读取提供方焦点或图片元数据；
- 无焦点时使用中心焦点；
- 根据目标槽位计算 deterministic cover crop；
- 保存 focalPoint/safeCrop 到 manifest；
- Scene Compiler 只消费已解析 crop，不在 Renderer 再决策。

Presentation 当前只有 `objectFit`。为实现三端一致裁切，需要给 ImageElement 增加可选的规范化裁切字段，例如：

```ts
crop?: { x: number; y: number; width: number; height: number };
```

三个 Renderer 共同遵守同一 crop 语义；若暂未完成 crop contract，则不能把“焦点裁切三端一致”标记为通过。

### 7.5 无图降级

降级发生在 Director 的第二次纯函数决策中，不触发模型：

1. Asset Resolver 返回 unavailable；
2. Director 使用原 plan、manifest 和 Scene fallback 重新解析受影响页面；
3. 编译 fallback Scene；
4. Quality Gate 确认不存在空槽和残留占位框。

降级只能改变 Scene/variant，不能改写标题、正文、指标或事实。

---

## 8. 编译器设计

### 8.1 编译入口

```ts
compileCommercialDeck(input: {
  spec: LeanDeckSpecV2;
  plan: DirectedDeckPlanV1;
  assets: ResolvedAssetManifestV1;
  designSystem: DesignSystemV1;
  basePresentation: Presentation;
  compilerVersion: string;
}): CompiledCommercialDeck
```

输出：

```ts
type CompiledCommercialDeck = {
  presentation: Presentation;
  commands: PresentationCommand[];
  diagnostics: CompileDiagnostic[];
  canonicalHash: string;
};
```

### 8.2 编译不变量

- 输入在函数入口完成 schema parse；
- Scene 必须消费所有 required content unit；
- 未消费内容为 hard failure，不能静默丢弃；
- 无内容不生成空卡片；
- unavailable asset 不生成 ImageElement；
- sourceRef 必须编译为可见 caption/source；
- element ID 只由语义路径决定；
- Scene 不读取当前时间、网络、环境随机数；
- command 顺序固定为 remove、title、design system、add slides；
- compile 不修改输入对象；
- Presentation 再次通过 `presentationSchema`。

### 8.3 原生可编辑图表

新增 `NativeChartCompiler`，第一阶段覆盖 Lean 已支持的四种 chart：

- bar；
- h-bar；
- timeline；
- kpi-tower。

优先将 chart 编译为原生 shape + text primitives，使编辑器、HTML 和 PPTX 使用同一 Presentation 结构。若选择 PPTX 原生 chart，则必须同时定义 editor/HTML 的等价语义和结构一致性规则，不能只在 exporter 私自替换。

验收中不得把 rasterized chart 计入“图表可编辑”。

### 8.4 Canonical hash

hash 输入包括：

- 规范化 DeckSpec v2；
- DirectedDeckPlan；
- asset manifest 中被消费素材的 sha256/crop；
- DesignSystem；
- compilerVersion；
- 最终 Presentation 的 canonical JSON。

排除运行时字段：

- revision 的外部变化；
- fetchedAt；
- 绝对 workspace 路径；
- 临时 URL；
- 预览生成时间。

测试同时比较对象深相等和 canonical hash，避免只有 hash 测试掩盖字段差异。

---

## 9. 商业质量门设计

### 9.1 接入位置

Lean v2 的 Proposal 生成顺序：

```text
compile
  -> CommercialQualityGate
  -> 失败：返回结构化失败，不提交命令
  -> 通过：提交现有 CommitGate
  -> CommitGate 通过：展示预览和审批
```

CommitGate 继续作为系统最终安全门。Commercial Quality Gate 是 Lean v2 的产品质量门，两者不能互相替代。

### 9.2 硬失败

除方向文档中的规则外，代码上明确为：

- DeckSpec、plan、manifest、Presentation 任一 schema 无效；
- Scene 不支持当前 role/purpose/content；
- required content unit 未消费；
- Scene required asset 未解析且未执行 fallback；
- 空 text、空卡片、空 comparison side、空 image slot；
- 元素越界、关键前景遮挡；
- 最小正文字号低于设计约束；
- metric/chart 无有效 sourceRef 或 sourceRef 不存在；
- 远程图片未本地化；
- 素材路径越出 workspace；
- restricted license 资产被自动使用；
- Renderer 不支持新 element/crop contract；
- 编译相同 fixture 两次对象或 hash 不一致；
- Presentation 命令无法在 base 上重放得到相同结果；
- PPTX 导出缺失图片或关键内容；
- raster chart 被声明为可编辑 chart；
- preview 与 Presentation 的元素类型/数量/顺序契约不一致。

### 9.3 商业视觉评分

在现有评分上扩展并保持 0–100：

```ts
type CommercialVisualScore = {
  hierarchy: number;
  composition: number;
  assetQuality: number;
  variety: number;
  rhythm: number;
  brandConsistency: number;
  editability: number;
  overall: number;
};
```

第一阶段自动指标：

- 字号层级比和 textRole 覆盖；
- 主视觉/主指标面积占比；
- Scene 数量、相邻重复和结构签名；
- light/dark/image 背景序列；
- 图片像素与槽位输出像素比；
- aspect/crop 匹配度；
- source/license 元数据覆盖；
- 文本密度和元素数量；
- 空白区域分布；
- layout/style/asset validator 结果；
- PPTX 原生文本、形状、图片、图表占比。

评分不能覆盖硬失败。`overall` 再高，只要存在 hard failure 仍不能进入审批。

### 9.4 可解释结果

每个 issue 必须包含：

- code；
- severity；
- slideId；
- sceneId；
- message；
- evidence；
- fixHint；
- ruleVersion。

预览页展示 deck 总分、每页分数、场景使用统计、素材警告和失败原因；未知授权只显示“未验证”，不得显示“可商用”。

---

## 10. Contact Sheet 与三端一致性

### 10.1 Contact Sheet

复用 `slide-thumbnail-service`，增加 deck 级拼图：

- 固定 8 页 fixture 输出单页 contact sheet；
- 每张缩略图标注 slide index、sceneId、backgroundMode；
- baseline 和 v2 使用相同尺寸、间距和渲染设置；
- fixture 产物可作为测试 artifact 保存；
- contact sheet 用于人工评分，不作为唯一自动判定。

### 10.2 三端一致性定义

“一致”不是像素完全相同，而是以下结构一致：

- slide 顺序、标题和背景模式一致；
- element 类型、内容、坐标、尺寸和 z-order 一致；
- 字体角色、颜色 token 和对齐一致；
- 图片 asset、slot、crop、objectFit 和 treatment 一致；
- chart 的数据、标签和视觉 primitive 一致；
- source/caption 可见；
- 无 Renderer 私自选择 Scene 或重新排版。

增加 renderer capability matrix。新增字段或元素时，必须同时更新：

1. Presentation schema；
2. Editor Renderer；
3. HTML Renderer；
4. PPTX Exporter；
5. 三端 contract test。

---

## 11. Lean v2 服务编排

`LeanPresentationService` 只保留：

- 请求上限和 starter deck 检查；
- 一次模型调用；
- DeckSpec 提取和校验；
- token/耗时指标；
- 调用 `LeanV2Pipeline`；
- 组装 Proposal。

`LeanV2Pipeline` 负责：

```ts
class LeanV2Pipeline {
  create(input): Promise<LeanV2PipelineResult> {
    // validate -> direct -> resolve assets -> fallback -> compile -> quality
  }
}
```

指标扩展：

- `modelCalls` 固定为 1；
- `directorDurationMs`；
- `assetResolutionDurationMs`；
- `compileDurationMs`；
- `qualityDurationMs`；
- `assetRequestCount/resolvedAssetCount`；
- `sceneCount`；
- `commercialQualityScore`；
- `canonicalHash`。

图片搜索请求和下载次数必须单独记录，不得混入内容模型调用次数。

---

## 12. 实施顺序

### 阶段 A：基准与契约

交付：

- 固定 8 页 `commercial-visual` DeckSpec fixture；
- 当前 Lean baseline Presentation、缩略图和 contact sheet；
- DeckSpec v2 schema；
- DirectedDeckPlan、AssetManifest、QualityReport schema；
- canonical hash；
- 人工商业视觉评分表。

退出条件：

- fixture 可重复生成；
- baseline 产物可在测试中定位；
- v1 现有测试全部保持通过；
- v2 schema 明确拒绝坐标、URL 和非法 emphasis。

### 阶段 B：布局执行边界收敛

交付：

- 真正可执行的 handler registry；
- handler/slot 单一事实源；
- deterministic ID context；
- 删除已覆盖的旧 layout 分支；
- `applyLayout` 缩减为调度器。

退出条件：

- 现有 layout、grammar、CommitGate 和 exporter 测试不回退；
- handler contract 能同时提供 compile、slot 和 constraint；
- layout 生成元素不再依赖随机 ID。

### 阶段 C：首批四个 Scene

交付：

- `editorial-business` pack；
- `cinematic-cover`；
- `numbered-overview`；
- `hero-narrative`；
- `split-case`；
- 受控本地素材 manifest；
- Director 基础评分和节奏规则；
- contact sheet 对比。

退出条件：

- 不接真实搜索也能明显区别于同构白卡片 baseline；
- 8 页 fixture 至少使用首批四种 Scene；
- 无空槽、无内容丢失；
- 相同输入对象和 hash 一致；
- 三端 contract test 通过。

### 阶段 D：素材解析闭环

交付：

- 可复用 ImageSearchService；
- candidate normalize/probe/score/deduplicate；
- 本地化和 manifest；
- crop contract 与三端实现；
- Scene fallback。

退出条件：

- required 图片有素材或明确降级；
- 远程 URL 不进入 Presentation；
- 来源页和授权状态可审计；
- 低清、比例不适配和重复素材被过滤；
- 无图降级后不保留占位框。

### 阶段 E：完整八 Scene 与商业质量门

交付：

- 其余四个 Scene；
- rhythm policy；
- commercial hard validator；
- visual scorer；
- Lean 预览质量报告；
- CommitGate 前置接入。

退出条件：

- 8 页 fixture 至少 5 种 Scene；
- 不连续重复同一 Scene；
- 背景节奏和强视觉页频率达标；
- 所有 hard failure 可定位到 slide/scene/rule；
- 质量失败不触发第二次模型调用。

### 阶段 F：可编辑图表与发布收敛

交付：

- 四种 Lean chart 的原生可编辑编译；
- PPTX 结构检查；
- 回归、性能和导出测试；
- v2 feature flag / rollout 配置；
- v1 兼容读取和显式迁移策略。

退出条件：

- 关键 chart 不再依赖栅格化；
- PPTX 中主要文字、形状、图片和图表可编辑；
- v2 全量验收通过后才切换为 Lean 新建默认路径。

---

## 13. 测试设计

### 13.1 单元测试

- DeckSpec v2 schema 和 refinement；
- emphasis 内容引用；
- Director 各评分项和稳定 tie-break；
- rhythm penalty；
- Scene constraints/analyze；
- 每个 Scene 的内容消费和 slot 输出；
- deterministic ID；
- candidate scoring/deduplicate；
- crop planner；
- fallback；
- canonical hash；
- commercial hard validator；
- commercial score。

### 13.2 集成测试

- 一次模型响应到 Proposal；
- 本地受控素材到 manifest 到 Presentation；
- Presentation 到 commands 可重放；
- Commercial Quality Gate 到 CommitGate；
- workspace 图片本地化和导出；
- v1/v2 兼容；
- feature flag 路由；
- 质量失败无第二次模型请求。

### 13.3 Renderer 契约测试

- 每类 element 在 Editor/HTML/PPTX 均有实现；
- crop/objectFit/treatment；
- light/dark/image background；
- caption/source；
- chart primitive；
- z-order；
- contact sheet 生成。

### 13.4 Golden fixture

至少包含：

- 一份固定 8 页商业 deck；
- 一份无可用图片的 fallback deck；
- 一份 chart/metric deck；
- 一份中英文长短标题边界 deck；
- 一份图片授权未知的 warning deck；
- 一份非法 required asset 的 hard-failure deck。

Golden 断言以结构和 hash 为主，图片快照为辅。避免仅使用易脆弱的像素 diff。

---

## 14. 最终代码预期方向

完成后，代码应达到以下状态：

1. `lean-mode.ts` 不再是 schema、编译和命令生成的大单体；
2. Lean v2 的模型调用仍只有一次，visual director 和 quality gate 都是本地确定性逻辑；
3. Commercial Scene 是独立、可注册、可分析、可编译、带 fallback 的产品级模块；
4. Scene contract 同时拥有内容约束、素材槽位、坐标编译和质量规则，不再存在槽位多事实源；
5. 图片搜索服务可被 Agent Tool 和 Lean Pipeline 共用；
6. 下载器仍只负责安全本地化，不承担商业选择；
7. 素材 manifest 把外部不稳定搜索与内部确定性编译隔离；
8. Scene 和 layout 生成的所有 ID 都由 deterministic context 生成；
9. Commercial Quality Gate 组合现有通用校验并在 CommitGate 前执行；
10. Presentation 仍是 Editor、HTML 和 PPTX 的唯一渲染输入；
11. Renderer 不根据文本重新猜 Scene 或布局；
12. 支持的商业图表编译为 PPTX 可编辑对象或原生 primitives；
13. baseline、contact sheet、canonical hash 和质量报告成为持续回归资产；
14. 第一主题包稳定前不扩展更多主题包或多轮模型修复。

---

## 15. 最终验收结果

以同一份固定 8 页商业汇报、固定 DesignSystem 和固定 ResolvedAssetManifest 为基准，全部满足才视为 v2 首阶段完成。

### 15.1 功能与叙事

- DeckSpec v2 只包含内容和视觉语义，无坐标、字号、颜色、阴影和素材 URL；
- 首尾页合法，商业叙事和 sourceRef 校验通过；
- 至少使用 5 种 Commercial Scene；
- 连续两页不使用完全相同的 Scene + variant；
- 每 2–3 页至少一页强视觉页；
- 封面和结尾复用同一主题母题；
- 缩略图可辨识封面、总览、证据、案例/方案、计划和结尾；
- 每页只有一个明确主视觉焦点。

### 15.2 素材

- 至少 4 页具有有效图片资产或强数据视觉；
- required 图片全部解析成功或执行明确 fallback；
- 无空图片框、空卡片、空比较栏；
- 远程图片全部本地化；
- 图片尺寸和比例满足 Scene slot；
- 同一图片不被无意重复使用；
- 每个外部图片保留 sourceUrl/sourcePageUrl/licenseStatus；
- unknown license 显示警告且不宣称可商用；
- restricted 资产不被自动使用。

### 15.3 质量与安全

- Presentation schema、DeckValidationService、CommercialQualityGate 和 CommitGate 全部通过；
- 无元素越界、关键遮挡和低于阈值的正文；
- metric/chart 都有有效且可见的来源；
- 所有 hard failure 提供 slideId、sceneId、rule code 和 fix hint；
- 质量门失败不产生第二次内容模型调用；
- 用户审批前可查看整套预览、contact sheet、评分和警告。

### 15.4 确定性

- 相同 spec、plan、manifest、design system 和 compilerVersion 连续编译两次，Presentation 深相等；
- canonical Presentation hash 一致；
- commands 深相等；
- commands 在相同 base 上重放得到与 compiled Presentation 相同的结果；
- Scene 选择分数和 rationaleCodes 一致。

### 15.5 三端与可编辑性

- Editor、HTML、PPTX 的 slide/element 结构契约一致；
- 图片 crop/objectFit/treatment 三端一致；
- 标题、正文、caption、来源和主指标三端可见；
- 主要文字、图片和形状在 PPTX 中保持可编辑；
- bar、h-bar、timeline、kpi-tower 不以整图冒充可编辑图表；
- PPTX 导出不丢失素材、不降级为空白、不静默跳过错误。

### 15.6 性能与调用边界

- 内容模型调用次数严格为 1；
- 不启用多 Agent 或模型视觉返工；
- Director、Scene Compiler 和 Quality Gate 不进行模型调用；
- 图片搜索/下载次数独立计量；
- compile 和 quality 的耗时可观测；
- 相比 baseline，人工商业视觉评分在层级、构图、节奏、品牌一致性和交付完成度上均提升，且不得以牺牲内容正确性、编辑性或确定性换取视觉分数。

---

## 16. 不进入本次设计的方向

- 模型输出坐标或 PresentationElement；
- 多轮内容模型自动返工；
- 用整页截图替代可编辑 Presentation；
- 同时建设多个主题包；
- 像素级复制参考 PPT；
- 在 Scene/slot/quality contract 未稳定前增加大量 layout；
- 把商业质量逻辑写进 Renderer；
- 把外部搜索结果本身当作确定性编译输入；
- 用纯主观视觉模型评分替代硬规则和结构测试。

---

## 17. 一句话落地方案

**先把现有 Layout 执行与槽位契约收敛为稳定底座，再以 DirectedDeckPlan、ResolvedAssetManifest 和可执行 Commercial Scene 为核心建立纯函数视觉编译器，把现有校验、缩略图和 CommitGate 组合成 Lean v2 商业质量闭环。**
