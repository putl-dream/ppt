# PPT 能力、产物与作业生命周期重构计划

> 状态：设计草案（2026-07-24）
>
> 范围：PPT 新建、编辑、重设计、素材、编译、视觉反馈、审查、审批、应用、导出，以及这些能力之间的中间产物、状态流转和恢复语义。
>
> 关联方案：
>
> - [`agent-query-lifecycle-refactor-plan.md`](./agent-query-lifecycle-refactor-plan.md)：定义 Agent Query 内的 History、Params、State、Workspace 与 Attempt 边界。
> - [`ppt-layout-state-machine-plan.md`](./ppt-layout-state-machine-plan.md)：定义 `layout-plan` 的单一事实源和受控执行。
> - [`commercial-ppt-visual-compiler-v2.md`](./commercial-ppt-visual-compiler-v2.md)：定义 Lean 商业视觉导演、素材解析、确定性编译与质量门。
> - [`ppt-workflow-reliability-fix-plan.md`](./ppt-workflow-reliability-fix-plan.md)：定义文件原子写、产物验证和恢复问题。

本文不直接重写 Presentation、CommandBus、CommitGate 或 Query loop。目标是先建立 PPT 业务领域自己的稳定层级，使 Agent Mode、Lean Mode 和人工编辑不再各自维护一套流程事实。

## 1. 设计结论

PPT 领域的目标生命周期应固定为：

```text
Project / Deck Identity
  → PptCapabilityRequest
  → PptJobParams
  → committed PptJobState
  → while:
       Stage Input Artifacts
       + Stage Workspace
       + Attempt / External Effect
       → validate candidate
       → commit Artifact Revision
       → advance Job State
  → Command Proposal
  → approval / CommitGate
  → committed Presentation Revision
  → Export Artifact
```

核心决策：

1. **PPT Job 是跨 Query 的业务工作流**。它不属于某次 Agent Query State，也不因一次 Query completed 而消失。
2. **中间过程必须以有类型、有版本、可校验的 Artifact 表达**，不能通过聊天摘要、Task list 状态或文件是否存在来推断。
3. **Agent Mode 与 Lean Mode 使用同一组 PPT Artifact 和同一条后半段管线**；差别只是执行策略、模型调用预算和用户确认点。
4. **Presentation 只表示已应用的可编辑 deck**。未审批的内容草稿、设计方案和编译结果属于 job candidate，不提前伪装成已提交 Presentation。
5. **每个阶段都采用 candidate → validate → commit**。阶段中途写出的半成品不推进 Job State，也不使下游产物变为 ready。
6. **用户可见进度是 durable Job State 的投影**。Renderer 事件、Agent 文本和 Task list 只负责展示或调度，不是业务事实源。
7. **内容、设计、素材、编译和质量是不同数据领域**。不能继续让 storyboard、layout-plan、Presentation 和 command proposal 互相代替。

一句话概括：

> Agent Query 管“模型这一轮怎么运行”，PPT Job 管“这份演示如何从需求演化为可交付版本”，Artifact Revision 管“每一步已经可靠地产出了什么”。

## 2. 当前实现的领域问题

当前各项单点能力已经较丰富，但还没有形成统一的 PPT 业务生命周期。

### 2.1 两条创建管线拥有不同事实源

Agent 工作流：

```text
brief.md
  → outline.md
  → slides/storyboard.json
  → Presentation 内容草稿
  → slides/layout-plan.json
  → ExecuteLayoutPlan
  → command proposal
```

Lean 工作流：

```text
LeanDeckSpecV2
  → DirectedDeckPlan
  → ResolvedAssetManifest
  → deterministic compile
  → CommercialQualityReport
  → command proposal
```

二者最终都进入 CommandBus / CommitGate，但在此前使用不同的内容模型、设计模型、素材状态和质量报告。结果是：

- Agent 路径的 storyboard 表达较弱，Lean 路径的 DeckSpec 表达较完整；
- `layout-plan` 与 `DirectedDeckPlan` 都在描述视觉决策，但结构和执行器不同；
- Agent 路径的 render feedback 属于 Query 内一次反馈，Lean 路径的 quality report 属于编译管线；
- 同一种能力需要在 skill、prompt、工具和 Lean service 中重复维护。

### 2.2 中间产物状态存在双重定义

当前至少存在两套状态：

- workspace probe：`missing | empty | default | invalid | verified`
- project artifact：`draft | ready | stale`

它们分别由文件内容探测和 Session 项目元数据维护，没有统一 revision、dependency hash 或 commit 记录。因此可能出现：

- 文件内容已变化，但项目状态仍为 ready；
- 只要 `layout-plan.json` 存在就被视为 verified，尚未真正解析和对齐 snapshot；
- 上游重写后，下游 stale 依赖人工或路径映射触发；
- context compact 后只能再次探测文件并猜测业务进度；
- Task 完成、文件写入、文件校验和业务阶段完成不是同一个事件。

### 2.3 Task list、Agent Query 与 PPT 工作流层级混合

Task list 适合表达工作分配和依赖，但不应成为 PPT 业务状态机：

- teammate `submitted` 只表示工作已提交给 lead，不表示 artifact 已验证；
- Query completed 只表示一次模型请求结束，不表示 PPT Job 完成；
- AskUser waiting 可能暂停 Query，也可能暂停 PPT Job 的用户决策；
- command approval 属于 Proposal 生命周期，不属于普通 Artifact 生命周期；
- 一个 PPT Job 可以跨多个 Query、Run、teammate task 和应用重启。

### 2.4 Presentation 创建得过早

Agent 路径会先把 storyboard 转成“无排版 Presentation 内容草稿”，再等待设计。这样会产生几个问题：

- 用户看到的 Presentation 同时像 committed deck 和中间草稿；
- content draft、layout compile 与最终 apply 共用同一个 revision 体系；
- 上游内容变更后，需要通过命令修补已经生成的低层元素；
- storyboard 与 Presentation 中的文案容易成为双事实源；
- 是否“已生成 PPT”取决于 UI、approval 和 artifact 状态的不同解释。

### 2.5 中间过程缺少可恢复的阶段提交点

已有 Query checkpoint 能恢复模型/工具批次，但不能回答：

- DeckSpec 是否已经验证并可复用；
- 素材搜索完成了哪些请求；
- 编译结果对应哪些输入 revision；
- quality report 是否仍适用于当前 candidate；
- proposal 是由哪一组 artifact 编译产生；
- 用户修改 outline 后，应从哪一阶段重新开始。

这些是 PPT 业务事实，不能放回 Query checkpoint。

## 3. 身份与生命周期层级

### 3.1 ID 定义

```ts
type ProjectId = string;              // 用户工作区 / PPT 项目
type PresentationId = string;         // 一份可编辑演示
type PresentationRevision = number;   // 已应用 Presentation 的 CAS revision

type PptJobId = string;               // 一次逻辑 PPT 业务工作流
type PptStageRunId = string;           // 某阶段的一次执行尝试

type ArtifactId = string;             // 逻辑产物身份
type ArtifactRevisionId = string;     // 不可变产物版本
type ProposalId = string;             // 等待审批/应用的命令提案
type DecisionId = string;             // 用户语义决策，如 outline/design 选择
type ExportId = string;               // 一次导出记录
```

它们与 Agent 身份的关系：

```text
SessionId ── owns UI project ──> ProjectId
ThreadId  ── discusses ────────> ProjectId / PptJobId
QueryId   ── may advance ──────> PptJobId
RunId     ── executes one IPC ─> QueryId

PptJobId  ── produces ─────────> ArtifactRevisionId*
ProposalId ─ applies against ──> PresentationRevision
```

禁止：

- 用 `threadId === jobId` 推断 PPT Job；
- 用 Query completed 推断 PptJob completed；
- 用 Presentation revision 代替 Artifact revision；
- 用 Task list task ID 代替 Artifact ID。

### 3.2 生命周期层级

```text
Project
├─ Presentation
│  ├─ committed revision 17
│  └─ committed revision 18
├─ PptJob A：新建 deck
│  ├─ Artifact revisions
│  ├─ Stage checkpoints
│  └─ Proposal
├─ PptJob B：重设计第 3–5 页
└─ Export records
```

一个 Project 可以有多个顺序或并行 Job；一个 Job 必须声明基于哪个 Presentation revision。修改型 Job 在应用前必须执行 CAS/CommitGate，不能覆盖期间发生的人工编辑。

## 4. PPT 数据领域

目标系统分为九个业务数据域。

| 数据域 | 核心对象 | 负责 | 不负责 |
|---|---|---|---|
| Intent | `PptIntent` | 受众、目标、场景、约束、交付要求 | 页级文案与坐标 |
| Evidence | `EvidenceBundle` | 来源、事实、引用、授权与时效 | 决定叙事 |
| Narrative | `NarrativePlan` | 章节、论证顺序、页数预算 | 页面视觉结构 |
| Deck Content | `DeckSpec` | 每页结论、内容单元、source refs、audience move | 最终坐标 |
| Design | `DeckDesignPlan` | design system、scene/grammar、节奏、素材需求 | 修改事实与文案 |
| Assets | `AssetManifest` | 候选、来源、本地化、授权、焦点和裁切 | 决定商业故事 |
| Compilation | `CompiledDeck` | Presentation candidate、commands、hash、输入 refs | 用户审批 |
| Quality | `DeckQualityReport` | 硬失败、评分、证据、修复范围 | 静默改写内容 |
| Delivery | `CommandProposal`、`ExportArtifact` | 审批、应用、导出、交付记录 | 重新推理设计 |

工作流数据另成一层：

| 工作流对象 | 作用 |
|---|---|
| `PptJobParams` | 本次 Job 的稳定输入和策略 |
| `PptJobState` | 已提交阶段、当前 artifact refs、等待事项 |
| `PptStageWorkspace` | 当前阶段未提交 candidate |
| `PptJobCheckpoint` | committed state + inflight stage facts |
| `PptJobEvent` | 可回放的状态变化，用于 UI/audit |

## 5. Canonical Artifact Graph

### 5.1 新建 PPT

```text
PptIntent
  ├──────────────→ EvidenceBundle (optional)
  ↓
NarrativePlan
  ↓
DeckSpec ←──────── EvidenceBundle
  ↓
DeckDesignPlan
  ↓
AssetManifest
  ↓
CompiledDeck
  ↓
DeckQualityReport
  ↓
CommandProposal
  ↓ approval + CommitGate
Presentation Revision
  ↓
ExportArtifact
```

### 5.2 修改 PPT

```text
Base Presentation Revision
  ↓ semantic projection
DeckSnapshotSpec
  + EditIntent
  ↓
DeckPatchSpec
  ↓
Affected Design Plan
  ↓
Compiled Patch
  ↓
Quality Report (affected slides + deck-level)
  ↓
CommandProposal
```

### 5.3 Artifact 与当前文件的映射

迁移期保留用户可读文件，但重新定义其角色：

| 当前文件 | 目标逻辑对象 | 迁移期语义 |
|---|---|---|
| `brief.md` | `PptIntent` | 人类可读投影，可导入为新 candidate |
| `outline.md` | `NarrativePlan` | 人类可读投影 |
| `research/*` | `EvidenceBundle` | 证据内容和来源附件 |
| `slides/storyboard.json` | `DeckSpec` | 兼容投影，逐步升级 schema |
| `slides/layout-plan.json` | `DeckDesignPlan` | 兼容投影，统一 Agent/Lean 设计结构 |
| `design/system.json` | `DeckDesignPlan.designSystem` | 可独立编辑的设计输入 |
| `deck/snapshot.json` | committed Presentation | 只投影已应用 revision |
| `history/exports.json` | `ExportArtifact[]` | 交付记录投影 |

稳定路径不再独立保存状态。Artifact Store 记录版本、hash、依赖和验证结果；稳定文件只是当前 committed revision 的 materialized view。

## 6. Artifact 契约

### 6.1 不可变版本

```ts
interface PptArtifactRevision<T> {
  artifactId: ArtifactId;
  revisionId: ArtifactRevisionId;
  kind: PptArtifactKind;
  schemaVersion: number;

  projectId: ProjectId;
  jobId: PptJobId;
  createdBy: {
    type: "user" | "agent" | "compiler" | "system";
    queryId?: string;
    taskId?: string;
  };

  inputs: Array<{
    artifactId: ArtifactId;
    revisionId: ArtifactRevisionId;
    contentHash: string;
  }>;

  contentHash: string;
  payload: T;
  createdAt: string;
}
```

Artifact revision 一旦 committed 就不可原地修改。用户修改稳定文件时，系统导入并生成新的 candidate revision，而不是改写旧 revision。

### 6.2 验证与发布

不要用一个 `status` 同时表达内容是否合法、是否当前有效、是否已发布。

```ts
interface ArtifactValidation {
  outcome: "valid" | "invalid";
  validatorVersion: string;
  issues: PptArtifactIssue[];
  validatedAt: string;
}

type ArtifactPublication =
  | { type: "candidate" }
  | { type: "committed"; committedAt: string }
  | { type: "rejected"; reason: string }
  | { type: "superseded"; replacedBy: ArtifactRevisionId };
```

`stale` 不直接写入 Artifact revision，而是根据 committed binding 的输入 revision 计算：

```ts
freshness =
  artifact.inputs 与当前上游 committed refs 完全一致
    ? "current"
    : "stale";
```

这样可消除 workspace probe 与 `draft/ready/stale` 双状态。

### 6.3 Candidate 提交协议

每个阶段只能通过以下协议推进：

```text
open stage workspace
  → produce candidate
  → schema validate
  → cross-artifact validate
  → domain quality validate
  → atomically persist revision
  → update committed artifact binding
  → advance PptJobState
```

任何一步失败：

- candidate 可以保留用于诊断；
- committed binding 不变；
- 下游不解锁；
- UI 显示具体 issue；
- 新尝试从上一个 committed State 开始。

## 7. 统一的内容与设计契约

### 7.1 `PptIntent`

替代 loose brief 字符串，至少包含：

```ts
interface PptIntent {
  title: string;
  operation: "create" | "edit" | "restyle" | "review" | "export";
  audience: string;
  objective: string;
  desiredAction: string;
  coreMessage: string;
  presentationContext: string;
  afterUse: string;
  restructurePermission: "preserve" | "reorder" | "rewrite-and-merge";
  narrativeMode: string;
  locale: string;
  targetSlideCount?: number;
  durationMinutes?: number;
  mustInclude: string[];
  mustAvoid: string[];
  delivery: {
    formats: Array<"pptx" | "html">;
    editableRequired: boolean;
  };
}
```

### 7.2 `NarrativePlan`

表达章节和论证，不提前选择具体 layout：

```ts
interface NarrativePlan {
  title: string;
  thesis: string;
  sections: Array<{
    id: string;
    title: string;
    purpose: string;
    audienceMove: string;
    slideBudget: number;
    claims: string[];
    requiredEvidenceRefs: string[];
  }>;
}
```

### 7.3 `DeckSpec`

统一 storyboard 与 LeanDeckSpec：

```ts
interface DeckSpec {
  version: 3;
  intentRef: ArtifactRevisionId;
  narrativeRef?: ArtifactRevisionId;
  evidenceRef?: ArtifactRevisionId;
  title: string;
  locale: string;
  slides: Array<{
    id: string;
    purpose:
      | "opening"
      | "navigation"
      | "context"
      | "problem"
      | "insight"
      | "solution"
      | "proof"
      | "plan"
      | "ask"
      | "close";
    title: string;
    audienceMove: string;
    content: PptContentUnit[];
    sourceRefs: string[];
    speakerNotes?: string;
    visualHints?: {
      emphasis: string[];
      imagePreference?: "required" | "optional" | "none";
      assetBrief?: string;
    };
  }>;
}
```

`PptContentUnit` 使用有界 union 表达 paragraph、bullets、metric、comparison、process、chart、table、quote、image brief。模型不输出 `x/y/width/height`。

### 7.4 `DeckDesignPlan`

统一 `layout-plan` 与 `DirectedDeckPlan`：

```ts
interface DeckDesignPlan {
  version: 2;
  deckSpecRef: ArtifactRevisionId;
  designSystem: DesignSystemV1;
  packId?: string;
  slides: Array<{
    slideSpecId: string;
    layout?: string;
    grammarVariant?: string;
    sceneId?: string;
    sceneVariantId?: string;
    slideVariant?: "hero" | "light" | "dark";
    designOverride?: SlideDesignOverride;
    emphasis: string[];
    assetRequests: AssetRequest[];
    rationaleCodes: string[];
  }>;
}
```

规则：

- Agent Design 与本地 Visual Director 都产出同一契约；
- `layout/grammar` 与 `scene` 是两种编译后端选择，不再形成两条产品管线；
- design plan 必须逐页引用 `slideSpecId`，不能仅按数组位置绑定；
- 设计层不能改写 `DeckSpec.content`、事实、source refs 和 audience move。

## 8. PPT Job 状态

### 8.1 应用入口

```ts
type PptCapabilityRequest =
  | {
      operation: "create";
      projectId: ProjectId;
      presentationId: PresentationId;
      request: string;
      executionPolicy: "fast" | "guided" | "agentic";
    }
  | {
      operation: "edit" | "restyle" | "review";
      projectId: ProjectId;
      presentationId: PresentationId;
      request: string;
      selectedSlideIds: string[];
      selectedElementIds: string[];
    }
  | {
      operation: "export";
      projectId: ProjectId;
      presentationId: PresentationId;
      presentationRevision: number;
      format: "pptx" | "html";
    };
```

入口 request 只描述用户意图；Service 负责解析当前 Presentation revision、选择执行策略并创建稳定 Job Params。

### 8.2 稳定参数

```ts
interface PptJobParams {
  projectId: ProjectId;
  presentationId: PresentationId;
  jobId: PptJobId;

  operation: "create" | "edit" | "restyle" | "review" | "export";
  executionPolicy: "fast" | "guided" | "agentic";
  request: string;

  basePresentationRevision: number;
  basePresentationRef: ArtifactRevisionId;
  selectedSlideIds: string[];
  selectedElementIds: string[];

  modelPolicy?: AgentModelSelection;
  approvalPolicy: "final_only" | "stage_gates" | "auto_safe";
}
```

Params 在 Job 创建后保持稳定并可持久化。`AbortSignal`、事件端口、模型客户端和存储实现属于每次 attach/run 的 `PptJobExecutionContext`，不进入 durable Params。用户后续改变目标时，应创建 Job amendment 或新 Job，不应悄悄原地改变旧参数。

### 8.3 Committed State

```ts
interface PptJobState {
  jobId: PptJobId;
  status:
    | "running"
    | "waiting_user"
    | "waiting_approval"
    | "paused"
    | "completed"
    | "failed"
    | "cancelled";

  stage:
    | "intake"
    | "research"
    | "narrative"
    | "content"
    | "design"
    | "assets"
    | "compile"
    | "quality"
    | "proposal"
    | "apply"
    | "export";

  artifacts: Partial<Record<PptArtifactKind, ArtifactRevisionId>>;
  basePresentationRevision: number;
  proposalId?: ProposalId;
  pendingDecisionId?: DecisionId;
  completedStages: string[];
  warnings: PptArtifactIssue[];
}
```

### 8.4 Stage Workspace

```ts
interface PptStageWorkspace {
  stageRunId: PptStageRunId;
  stage: PptJobState["stage"];
  inputRefs: ArtifactRevisionId[];
  candidateRefs: ArtifactRevisionId[];
  attemptIds: string[];
  activeExternalEffect?: {
    kind: "model" | "asset_download" | "render" | "export";
    idempotencyKey: string;
    replayPolicy: "safe" | "check_first" | "never";
  };
  diagnostics: PptArtifactIssue[];
}
```

### 8.5 Checkpoint

```ts
interface PptJobCheckpoint {
  version: 1;
  jobId: PptJobId;
  committedState: PptJobState;
  inflight?: {
    phase:
      | "producing_candidate"
      | "validating_candidate"
      | "resolving_assets"
      | "rendering_preview"
      | "exporting";
    workspace: PptStageWorkspace;
  };
}
```

PPT Job checkpoint 与 Agent Query checkpoint 独立。Query 恢复后可以重新 attach Job；Job 恢复不需要反序列化旧模型 while-loop。

## 9. 状态流转

### 9.1 主状态机

```text
created
  → intake
  → [research]
  → [narrative]
  → content
  → design
  → assets
  → compile
  → quality
  → proposal
  → waiting_approval
  → apply
  → completed
```

Export 是读取某个 committed Presentation revision 的独立 Job：`created → export → completed`，不重新打开已经 completed 的创建/编辑 Job。

任一阶段可以进入：

```text
waiting_user   用户语义决策
paused         用户主动暂停或可恢复中断
failed         当前阶段不可自动恢复
cancelled      用户取消，不再推进
```

### 9.2 阶段转换条件

| From | To | 必须满足 |
|---|---|---|
| intake | narrative/research/content | `PptIntent` committed |
| research | content | EvidenceBundle committed；缺失项有明确 warning |
| narrative | content | NarrativePlan schema、页数和目标校验通过 |
| content | design | DeckSpec 完整、source refs 合法、每页 audience move 明确 |
| design | assets | DesignPlan 与 DeckSpec 一一对应 |
| assets | compile | required asset 已 resolved 或已提交无图 fallback |
| compile | quality | command replay 与 canonical hash 校验通过 |
| quality | proposal | hard failure 为 0 |
| proposal | waiting_approval | proposal 已持久化且绑定 base revision |
| waiting_approval | apply | 用户批准且 base revision 未变化 |
| apply | completed | CommitGate 与 CommandBus 原子提交成功 |
| created | export | operation=export，且目标 committed Presentation revision 存在 |

### 9.3 上游修改

用户修改 committed Artifact 后：

1. 写入新的 candidate；
2. 验证后 commit 新 revision；
3. 基于 dependency refs 计算所有下游 freshness；
4. 保留旧下游 revision 供对比，但不能继续作为当前 proposal 输入；
5. 新 Job 从最早 stale 阶段继续。

例如修改 `NarrativePlan`：

```text
PptIntent        current
EvidenceBundle   current
NarrativePlan    new current revision
DeckSpec         stale
DesignPlan       stale
AssetManifest    stale
CompiledDeck     stale
Proposal         stale / cannot apply
```

## 10. 各操作能力

### 10.1 Create

完整新建，允许经过所有阶段。最终只有一次 Presentation apply：

```text
intent → narrative/evidence → deck spec → design → assets
→ compile candidate → quality → proposal → apply
```

中间预览基于 CompiledDeck candidate，不需要先写入正式 Presentation。

### 10.2 Edit

小范围修改不强制重跑完整创建链：

```text
base Presentation
  → semantic projection of affected slides
  → DeckPatchSpec
  → compile affected commands
  → affected + deck-level quality
  → proposal
```

编辑必须显式声明保留规则：

- untouched slide/element 不变；
- 用户 provenance 元素默认保留；
- layout 重编译只清理 `provenance: "layout"`；
- 修改型 Job 的 proposal 绑定 base revision。

### 10.3 Restyle

只重建设计域：

```text
base Presentation
  → content projection
  → new DeckDesignPlan
  → assets delta
  → recompile layout-owned elements
  → quality → proposal
```

不得借重设计改写文案和事实。

### 10.4 Review

只读能力：

```text
committed Presentation 或 CompiledDeck candidate
  → structural validators
  → thumbnails
  → visual evaluation
  → asset/license audit
  → DeckQualityReport
```

Review 不自动修复。用户要求修复时创建新的 Edit/Restyle Job。

### 10.5 Export

```text
committed Presentation Revision
  → export preflight
  → write temp output
  → postflight inspect
  → atomic publish
  → ExportArtifact
```

Export 不能从未审批 candidate 或 stale proposal 导出。未知授权、缺图、PPTX part 缺失等必须在 preflight/postflight 中明确处理。

## 11. 执行策略：统一 Agent 与 Lean

`agent` 和 `lean` 不再代表两套数据管线，而映射为 execution policy：

| 策略 | 原模式 | 行为 |
|---|---|---|
| `fast` | Lean | 一次内容模型调用；本地 design/assets/compile/quality；默认只在最终 approval 停顿 |
| `guided` | 轻量 Agent | 必要时确认 intent/design；阶段数量可折叠；支持用户编辑中间产物 |
| `agentic` | 完整 Agent | 可研究、使用 teammate、多 Query 推进和有限视觉修订 |

三种策略必须共享：

- `PptIntent`
- `DeckSpec`
- `DeckDesignPlan`
- `AssetManifest`
- compiler
- quality report
- proposal / CommitGate
- Presentation / export

允许不同的是：

- 谁产生某个 Artifact；
- 是否跳过 optional Artifact；
- 模型调用预算；
- 是否使用 teammate；
- 用户确认点；
- 自动修复次数。

## 12. 中间过程能力与 UI

### 12.1 Durable 事件

```ts
type PptJobEvent =
  | { type: "job_started"; jobId: PptJobId }
  | { type: "stage_started"; stage: string; stageRunId: string }
  | { type: "candidate_created"; kind: PptArtifactKind; revisionId: string }
  | { type: "validation_failed"; revisionId: string; issues: PptArtifactIssue[] }
  | { type: "artifact_committed"; kind: PptArtifactKind; revisionId: string }
  | { type: "stage_completed"; stage: string }
  | { type: "decision_required"; decisionId: DecisionId }
  | { type: "preview_ready"; compiledDeckRef: ArtifactRevisionId }
  | { type: "approval_required"; proposalId: ProposalId }
  | { type: "proposal_applied"; presentationRevision: number }
  | { type: "export_completed"; exportId: ExportId }
  | { type: "job_terminal"; status: "completed" | "failed" | "cancelled" };
```

事件持久化用于 audit 和恢复；高频模型 token delta、下载字节进度和缩略图渲染百分比可以是 ephemeral progress，不进入 artifact 事实源。

### 12.2 用户可见阶段

UI 不展示内部所有工具调用，而展示可验证的业务节点：

1. 需求
2. 叙事与资料
3. 逐页内容
4. 视觉方案
5. 素材
6. 预览与质检
7. 应用
8. 导出

每个节点显示：

- 当前 committed artifact；
- 状态：未开始 / 进行中 / 待确认 / 已验证 / 已过期 / 失败；
- 输入版本和更新时间；
- validation issues；
- 与上一 revision 的语义 diff；
- “从此处重新生成”入口。

### 12.3 用户决策

用户决策分两类：

```ts
type PptDecisionRequest =
  | { type: "clarify_intent"; decisionId: DecisionId; questions: string[] }
  | { type: "approve_narrative"; decisionId: DecisionId; artifactRef: string }
  | { type: "choose_design_direction"; decisionId: DecisionId; options: unknown[] }
  | { type: "resolve_asset_license"; decisionId: DecisionId; assets: string[] };
```

语义决策不使用 Command approval 表示。Command approval 只处理“是否把 proposal 应用到 Presentation”。

## 13. Proposal、Presentation 与提交边界

### 13.1 CompiledDeck

```ts
interface CompiledDeck {
  deckSpecRef: ArtifactRevisionId;
  designPlanRef: ArtifactRevisionId;
  assetManifestRef: ArtifactRevisionId;
  basePresentationRevision: number;

  candidatePresentation: Presentation;
  commands: PresentationCommand[];
  canonicalHash: string;
  compilerVersion: string;
  determinismVerified: boolean;
  commandReplayVerified: boolean;
}
```

CompiledDeck 是可预览 candidate，不是 committed Presentation。

### 13.2 CommandProposal

```ts
interface PptCommandProposal {
  proposalId: ProposalId;
  jobId: PptJobId;
  compiledDeckRef: ArtifactRevisionId;
  qualityReportRef: ArtifactRevisionId;
  basePresentationRevision: number;
  commands: PresentationCommand[];
  summary: string;
  risk: string;
  status:
    | "pending_approval"
    | "approved"
    | "rejected"
    | "stale"
    | "applied";
}
```

Proposal 在以下情况自动 stale：

- Presentation revision 已变化；
- 任一输入 Artifact binding 已变化；
- quality report 不再对应当前 compiled deck；
- asset license 状态变化为 restricted。

### 13.3 原子提交

```text
reload current Presentation
  → assert revision == proposal.baseRevision
  → assert proposal inputs still current
  → rerun CommitGate
  → CommandBus.executeMany
  → persist Presentation + deck/snapshot
  → mark proposal applied
  → complete PptJob
```

后置通知、UI card、History 写入失败不得覆盖已经成功应用的主结果。

## 14. 恢复与幂等

### 14.1 恢复原则

恢复只读取：

- committed PptJobState；
- committed Artifact revisions；
- inflight stage workspace；
- 已记录的外部副作用事实。

不通过聊天记录重新猜阶段，不从 Task list conclusion 重建 artifact，不把 partial candidate 当成 committed。

### 14.2 外部副作用

| 副作用 | replay policy |
|---|---|
| 纯模型生成 candidate | safe；新 attempt 生成新 candidate |
| 素材搜索 | safe，使用 request/idempotency key 去重 |
| 图片下载 | check_first，先检查 hash/local file |
| thumbnail render | safe，可重建 |
| CommandBus apply | never blind replay；检查 proposal status 和 revision |
| PPTX/HTML export | check_first；验证 temp/final 文件和 Export record |

### 14.3 waiting_user

PPT Job waiting_user 保存：

- committed Job State；
- DecisionRequest；
- 等待该决策的 stage；
- 当前已提交 Artifact refs。

若同时由 Agent AskUser 承载：

- Query checkpoint 负责恢复 tool batch；
- PptJob checkpoint 负责恢复业务 decision；
- 二者通过 `decisionId` 关联；
- 用户回答完成后，先 commit 对应 PPT Artifact/State，再让 Query 继续。

## 15. 能力与工具层级

目标调用层级：

```text
Renderer / Agent Tool
  → PptCapabilityService
  → PptJobOrchestrator
  → Stage Services
       Intent / Research / Narrative / Content
       Design / Assets / Compiler / Quality
       Proposal / Apply / Export
  → Stores and Ports
       ArtifactStore / JobStore / PresentationStore
       Model / Search / Renderer / Filesystem
```

### 15.1 对外能力

```ts
interface PptCapabilityService {
  start(request: PptCapabilityRequest): Promise<PptJobView>;
  inspect(jobId: PptJobId): Promise<PptJobView>;
  continue(jobId: PptJobId): Promise<PptJobView>;
  answerDecision(jobId: PptJobId, decision: PptDecisionAnswer): Promise<PptJobView>;
  approveProposal(proposalId: ProposalId, approved: boolean): Promise<PptJobView>;
  cancel(jobId: PptJobId): Promise<PptJobView>;
}
```

### 15.2 Agent 工具

Agent 工具应表达业务意图，而不是暴露所有内部阶段：

- `StartPptJob`
- `InspectPptJob`
- `ContinuePptJob`
- `AnswerPptDecision`
- `ReviewPptDeck`
- `ApprovePptProposal`（Renderer 用户操作为主）
- `ExportPptDeck`

现有 `ReadPresentationSnapshot`、`SubmitCommands`、`ExecuteLayoutPlan` 等在迁移期保留。最终：

- 读工具是 inspect port；
- `ExecuteLayoutPlan` 下沉为 Design → Compile stage service；
- `SubmitCommands` 只作为低层 Proposal adapter；
- deferred beautify/validate 工具收敛到 Design、Quality 或 Edit capability；
- skill 描述策略和质量标准，不再承担 durable 状态机。

## 16. 与 Agent Query 生命周期的对齐

### 16.1 两个正交状态机

```text
Agent Query:
  Params → Query State → Iteration Workspace → Attempt

PPT Job:
  Job Params → Job State → Stage Workspace → Artifact Candidate
```

对应关系相似，但不能合并：

| Query 层 | PPT 层 |
|---|---|
| QueryParams | PptJobParams |
| QueryState | PptJobState |
| IterationWorkspace | PptStageWorkspace |
| Model Attempt | Stage Attempt / external effect |
| Conversation History | Ppt Artifact Graph |
| tool_result | Job command/result summary |

### 16.2 交互规则

1. 一次 Query 可以创建或推进一个 PPT Job。
2. 一个 PPT Job 可以跨多个 Query。
3. Query State 只保存调用 PPT tool 所需的 tool_use/tool_result，不复制完整 Artifact payload。
4. PPT tool model result 只返回紧凑的 `jobId + state + artifact refs + issues summary`。
5. 完整 Artifact 写入 Artifact Store；大结果不进入 Conversation History。
6. Query fallback/tombstone 不得撤销已经 committed 的 Artifact；模型 attempt 只有在显式 tool commit 后才产生 PPT 事实。
7. Query crash recovery不得自动重放 apply/export 等副作用不确定操作。

## 17. 不变量

实施中必须由测试锁定：

1. Project、Presentation、PptJob、Query、Run 身份互不推断。
2. 一个 Artifact revision committed 后不可修改。
3. Job State 只引用已 committed Artifact。
4. candidate 验证失败不得推进 stage。
5. Artifact freshness 由 dependency revision 计算，不依赖手工 stale 标记。
6. Task list completed 不等于 Artifact committed。
7. Query completed 不等于 PptJob completed。
8. Agent 与 fast/Lean 路径必须产出同一 DeckSpec/DesignPlan 契约。
9. 内容域不得包含坐标；设计域不得修改事实和正文。
10. Presentation 只在 proposal apply 后改变。
11. 编译结果必须通过 command replay 与 deterministic hash 校验。
12. quality hard failure 不为 0 时不得创建可应用 proposal。
13. proposal 必须绑定 base Presentation revision 和全部输入 Artifact refs。
14. stale proposal 不得应用。
15. 用户修改上游 Artifact 后，下游 freshness 可确定性计算。
16. required asset 缺失时必须显式 fallback 或阻断，不能保留空槽。
17. 远程素材进入 Presentation 前必须本地化并记录来源/授权。
18. Export 只能读取 committed Presentation revision。
19. UI progress 和聊天文本不得成为恢复事实源。
20. Renderer、audit、History 或通知失败不得覆盖已提交的 Presentation 主结果。

## 18. 测试矩阵

| 场景 | 关键断言 |
|---|---|
| fast 新建 | 一次内容调用后仍产出 canonical DeckSpec/DesignPlan |
| agentic 新建 | 多 Query/teammate 最终产物与 fast 使用同一 schema |
| brief/intent 修改 | 新 revision committed；下游自动 stale |
| invalid storyboard/spec | candidate rejected；Job 停留在 content |
| design 与 spec 页不匹配 | DesignPlan 不可 commit |
| required asset 下载失败 | 显式 fallback 或 assets stage 失败 |
| compile 重放 | commands 重放结果与 candidate Presentation 一致 |
| quality hard failure | 不生成可应用 proposal |
| proposal 等待期间人工编辑 | revision CAS 失败；proposal stale |
| approval 后应用 | CommandBus 原子提交；Job completed |
| apply 后通知失败 | Presentation 仍保持 committed |
| Query completed | 未完成 PPT Job 仍可由新 Query attach |
| waiting_user 重启 | DecisionRequest 与 stage 可恢复 |
| 素材下载中崩溃 | check-first，不重复下载已验证 hash |
| export 中崩溃 | temp/final/postflight 状态可判定，不盲目重复 |
| review-only | 不产生 Presentation mutation |
| restyle | 文案与 source refs 不变，只更新 layout-owned elements |
| edit selected slides | 未选 slide hash 不变 |
| 旧 workspace | brief/outline/storyboard/layout-plan 可导入为 revision |

## 19. 五阶段实施计划

每阶段独立完成并验证后再进入下一阶段。

### 阶段 1：建立领域类型与兼容 Artifact Index

改动：

- 新增 ID、`PptJobParams`、`PptJobState`、Artifact envelope 和 dependency refs。
- 新增 `PptArtifactStore` / `PptJobStore` 接口。
- 现有 `brief.md`、`outline.md`、storyboard、layout-plan 通过 adapter 注册为 artifact revision。
- 保持当前 UI、skills 和生成路径不变。

验收：

- 同一文件重复探测得到稳定 content hash；
- 修改上游后能计算下游 stale；
- 不再需要用两套状态判断同一 artifact；
- `npm.cmd run typecheck`、`npm.cmd test` 通过。

### 阶段 2：统一 DeckSpec 与 DesignPlan

改动：

- 引入 DeckSpec v3 和 DeckDesignPlan v2。
- Storyboard 与 LeanDeckSpecV2 分别提供兼容 reader/migrator。
- `layout-plan` 与 `DirectedDeckPlan` 适配为统一 DesignPlan。
- Agent/Lean 后半段开始共享 design/assets/compiler contracts。

验收：

- 同一 fixture 可由 Agent adapter 和 Lean adapter 进入统一 compiler；
- 内容与设计字段边界有架构测试；
- 旧文件可读，新 writer 只写统一结构；
- `npm.cmd run typecheck`、`npm.cmd test` 通过。

### 阶段 3：PptJobOrchestrator 与阶段提交

改动：

- 建立 candidate → validate → commit → advance 的 stage runner。
- 将文件存在探测替换为 committed artifact refs。
- waiting_user、暂停、失败和恢复使用 PptJob checkpoint。
- Task list 只负责调度 artifact producer，提交必须经过 validator。

验收：

- 故障注入覆盖 candidate written、validated、artifact committed、state advanced 四个边界；
- 新 Query 能 attach 未完成 Job；
- Task submitted 但 artifact invalid 时下游不解锁；
- `npm.cmd run typecheck`、`npm.cmd test` 通过。

### 阶段 4：统一编译、质量、Proposal 与中间过程 UI

改动：

- Agent layout execute 与 Lean compiler 收敛到统一 CompiledDeck。
- 统一结构校验、render feedback、commercial quality 和 asset audit 报告。
- Proposal 绑定 base revision、artifact refs 与 quality report。
- UI 展示 durable stage/artifact 状态、diff、issues 和 preview。

验收：

- Presentation 在 apply 前不变化；
- stale proposal 无法应用；
- 用户可从任意 stale stage 重新生成；
- fast/guided/agentic 的进度使用同一事件协议；
- `npm.cmd run typecheck`、`npm.cmd test` 通过。

### 阶段 5：编辑、恢复、导出与旧路径清理

改动：

- Edit/Restyle/Review/Export 接入 PptJob。
- export 增加 temp → postflight → atomic publish。
- 清理不再需要的 workspace probe status、重复 Lean/Agent artifact 状态和 prompt 阶段推断。
- 更新 workflow、persistence、data pipeline 和 UI 文档。

验收：

- 新建、局部编辑、重设计、审查、审批、应用、导出均有端到端测试；
- 应用/导出崩溃恢复不盲目重放副作用；
- 旧 workspace 可迁移，新 writer 不再生成混合状态；
- 实际生成并检查一次 PPTX 与 HTML；
- `npm.cmd run typecheck`、`npm.cmd test` 通过；
- 有凭证时运行真实 Gateway 集成测试，无凭证时记录验证盲区。

## 20. 非目标

本方案不包含：

- 立即删除现有 skill 或 Agent 工具；
- 让模型直接生成 PresentationElement 坐标；
- 重写 CommandBus、CommitGate 或 Presentation schema；
- 同时建设大量新 layout/scene/theme；
- 把 Task list 替换成新的通用任务系统；
- 把所有中间产物塞入 Conversation History；
- 为了统一管线而取消 fast/Lean 的单次内容调用优势；
- 未经用户授权自动应用 Proposal；
- 用视觉模型无限循环返工；
- 把 Renderer 变成第二个设计编译器。

## 21. 完成定义

全部满足后才算完成：

- PPT Job 成为跨 Query 的唯一业务工作流状态；
- 所有关键中间产物都有 schema、revision、hash、dependencies 和 validation；
- Agent 与 Lean 共享 DeckSpec、DesignPlan、Assets、Compile、Quality 和 Proposal；
- 稳定文件是 committed Artifact 的投影，不再独立承担状态；
- Presentation 只保存已应用 deck；
- candidate、preview、proposal 和 committed Presentation 边界明确；
- 上游变更能确定性使下游 stale；
- 用户可查看、编辑、比较并从中间阶段继续；
- waiting_user、崩溃、审批和导出恢复语义明确；
- Query lifecycle 与 PPT lifecycle 正交；
- 新建、编辑、重设计、审查和导出使用同一能力门面；
- 旧 artifact 和旧模式有兼容读取与渐进迁移路径；
- 单元测试、实际 PPTX/HTML 产物和可执行的真实模型验证结果均有记录。
