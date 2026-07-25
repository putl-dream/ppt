# Presentation Artifact 与 Job 生命周期路线图

> 文档类型：活跃提案
> 状态：Proposed，尚未成为现行代码事实
> 最后更新：2026-07-25

## 1. 要解决的问题

当前 Agent Mode 与 Lean Mode 已能生成、校验、审批和导出，但前半段使用不同 artifact 和状态来源。文件存在、Task 完成、Query completed、proposal ready 和 Presentation applied 容易被混为一个“完成”。

现行代码已经提供 workspace-level 项目文件管理页，可按 artifact 分组浏览文件、查看
详情/diff，并安全编辑已注册的普通 UTF-8 文本 artifact；`deck`、`history` 和未知
artifact 文件只读。其 `editToken + expected sha256 version` 只解决当前文件的读取
隔离和并发提交，不提供本路线所定义的 immutable Artifact Revision 或 PptJob 状态。

目标是增加独立的 PPT 业务层：

> Query 管一次模型请求如何运行；PptJob 管一份演示如何跨 Query 演化；Artifact Revision 证明每个阶段可靠地产出了什么。

## 2. 目标生命周期

```text
Project / Deck identity
  → PptCapabilityRequest
  → PptJobParams
  → committed PptJobState
  → stage candidate
  → validate
  → commit immutable Artifact Revision
  → advance Job State
  → Command Proposal
  → approval + CommitGate
  → committed Presentation Revision
  → Export Artifact
```

## 3. 身份

| ID | 含义 |
|---|---|
| `ProjectId` | workspace / PPT 项目 |
| `PresentationId` | 一份可编辑演示 |
| `PresentationRevision` | 已应用 deck 的 CAS revision |
| `PptJobId` | 一次逻辑业务工作流 |
| `PptStageRunId` | 某阶段的一次执行尝试 |
| `ArtifactId` | 逻辑产物 |
| `ArtifactRevisionId` | 不可变产物版本 |
| `ProposalId` | 等待审批/应用的提案 |

这些 ID 不与 thread/query/run/task ID 合并。

## 4. Canonical Artifact Graph

新建：

```text
Intent
  → NarrativePlan
  → DeckSpec
  → DeckDesignPlan
  → AssetManifest
  → CompiledDeck
  → QualityReport
  → CommandProposal
  → PresentationRevision
  → ExportArtifact
```

编辑：

```text
PresentationRevision
  → EditIntent / RestyleIntent
  → Candidate Deck or Commands
  → QualityReport
  → Proposal
  → next PresentationRevision
```

Agent/Lean 的区别只保留在执行策略，后半段共享 Design、Assets、Compile、Quality 和 Proposal 契约。

## 5. Artifact Revision

每个 committed revision 至少包含：

```ts
interface ArtifactRevision<T> {
  artifactId: string;
  revisionId: string;
  kind: string;
  schemaVersion: number;
  value: T;
  contentHash: string;
  dependencies: Array<{
    artifactId: string;
    revisionId: string;
    contentHash: string;
  }>;
  validation: ValidationReport;
  committedAt: string;
}
```

阶段内采用：

```text
candidate → validate → commit
```

半写文件、失败 attempt 和未验证 teammate 结果不生成 revision。

## 6. Job State

建议状态：

- `running`
- `waiting_user`
- `waiting_approval`
- `completed`
- `cancelled`
- `failed`

State 保存：

- 当前 capability 和 stage；
- committed artifact revision 指针；
- stale 原因；
- 当前 candidate/stage attempt；
- proposal/presentation/export 指针；
- waiting reason。

UI 进度是该 State 的投影，不由聊天文本或 Task 状态推断。

## 7. 上游修改与 stale

Artifact 依赖精确 revision/hash。上游变化时：

- 下游标记 stale；
- committed 旧 revision 保留，可比较和回滚；
- 系统计算最早需要重跑的 stage；
- 不删除已应用 Presentation；
- 模型看到具体 stale edge，而不是“可能需要重做”。

## 8. Candidate、Preview 与 Presentation

- Candidate：未验证或未批准的业务产物。
- CompiledDeck：已编译但尚未应用。
- Preview：Candidate 的只读渲染。
- Proposal：Candidate 到当前 Presentation 的命令差异。
- Presentation：用户当前已应用的 deck。

创建内容草稿时不应提前把半成品伪装成 committed Presentation。

## 9. 恢复

PptJob checkpoint 与 Query checkpoint 正交：

- Query 恢复半个模型/工具批次；
- PptJob 恢复最近 committed stage 和 candidate；
- 外部素材/导出记录幂等 key；
- waiting_user/approval 保留稳定 token；
- apply/export 在副作用边界后不盲目重放。

## 10. 迁移顺序

### 已落地的前置能力（不代表 Phase 1 完成）

- workspace 当前 artifact 的分组、文件列表、详情、diff 与文本编辑入口。
- `deck`、`history` 与未知 artifact 只读，避免通用编辑入口覆盖领域事实源。
- Renderer、Agent 与项目持久化共享 `WorkspaceFileService` 的路径、UTF-8、symlink、
  inode/hash、跨进程锁和原子替换边界。
- 编辑保存使用 session/path-bound `editToken` 与读取时 SHA-256 version 做 CAS。

这些能力没有建立 Artifact Index，也没有保留 immutable revision、dependency
snapshot 或 validation snapshot，因此本路线整体仍为 **Proposed**。

### Phase 1：领域类型与 Artifact Index

- 建立 ID、revision、hash、dependency 和 validation。
- 兼容读取现有 brief/outline/storyboard/layout-plan。

### Phase 2：统一内容与设计契约

- Agent storyboard 与 Lean DeckSpec 建立显式映射。
- LayoutPlan 与 DirectedDeckPlan 共享可执行设计核心。

### Phase 3：PptJob Orchestrator

- Job Params/State/Stage Workspace。
- durable transitions 和 UI projection。

### Phase 4：Compile、Quality 与 Proposal

- Agent/Lean 共用后半段。
- Candidate/Preview/Proposal 边界收敛。

### Phase 5：Edit、Recovery、Export

- Create/Edit/Restyle/Review/Export 接入 Job。
- 清理重复 probe status 和旧 writer。

## 11. 不进入本路线

- 不替换通用 Query Loop。
- 不让模型输出坐标元素树。
- 不取消 Lean 的一次内容调用优势。
- 不绕过 CommitGate。
- 不用 TaskStore 代替 PptJob。
- 不用无限视觉模型循环修稿。

## 12. 完成定义

- PPT Job 是跨 Query 的唯一业务工作流状态。
- 关键 artifact 均有 immutable revision、hash、dependency 和 validation。
- Agent/Lean 共享后半段。
- candidate、proposal、committed Presentation 边界明确。
- 上游修改确定性标记下游 stale。
- 新建、编辑、重设计、审查和导出使用同一能力门面。
- 崩溃恢复不重复 apply/export 等副作用。
