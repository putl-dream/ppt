# Presentation Artifact 与 Job 生命周期路线图

> 文档类型：活跃提案
> 状态：Proposed，尚未成为现行代码事实
> 最后更新：2026-07-30

## 1. 要解决的问题

产品创建已统一为 Agent SVG-native（`design-spec` / `page-plan` / `slides/svg/*` →
`PreviewSvgPage` → `SubmitSvgDeck`）；Lean Mode 已从 IPC 退役。仍存在的问题是：
文件存在、Task 完成、Query completed、proposal ready 和 Presentation applied
容易被混为一个“完成”；SVG 锁文件、遗留 storyboard/layout-plan、probe 与
`draft/ready/stale` metadata 尚未收敛为统一 revision graph。

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

这些 ID 不与 thread/query/run/task ID 合并。数字 `Presentation.revision`（CommandBus CAS）
与 immutable `PresentationRevisionId` 若并存，必须文档化区分，不得混用。

## 4. Canonical Artifact Graph

新建（对齐现行 SVG-native）：

```text
Intent / DesignSpec
  → PagePlan
  → PageSvg[]
  → PreviewReceipts
  → SvgDeckProposal
  → PresentationRevision
  → ExportArtifact
```

遗留 / 编辑旁路可继续映射到同一 Job 门面：

```text
PresentationRevision
  → EditIntent / RestyleIntent
  → Candidate Deck or Commands
  → QualityReport
  → Proposal
  → next PresentationRevision
```

执行策略差异（例如是否自动审批）留在 `executionStrategy` / CommitGate；不恢复
Lean 作为对等产品创建 Mode。离线 commercial compiler 若保留，只作为可选导入源，
其产出仍须进入同一 Artifact Revision 与 Proposal 边界。

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

半写文件、失败 attempt、未通过 PreviewSvgPage 的 SVG 和未验证 teammate 结果不生成 revision。

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

- Candidate：未验证或未批准的业务产物（含未过门禁的 SVG）。
- Preview：Candidate 的只读渲染（含 PreviewSvgPage PNG）。
- Proposal：Candidate 到当前 Presentation 的命令差异（含 SubmitSvgDeck 产出）。
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

- 产品创建统一为 SVG-native；Lean 产品入口已退役。
- workspace 当前 artifact 的分组、文件列表、详情、diff 与文本编辑入口。
- `deck`、`history` 与未知 artifact 只读，避免通用编辑入口覆盖领域事实源。
- Renderer、Agent 与项目持久化共享 `WorkspaceFileService` 的路径、UTF-8、symlink、
  inode/hash、跨进程锁和原子替换边界。
- 编辑保存使用 session/path-bound `editToken` 与读取时 SHA-256 version 做 CAS。

这些能力没有建立 Artifact Index，也没有保留 immutable revision、dependency
snapshot 或 validation snapshot，因此本路线整体仍为 **Proposed**。

### Phase 1：领域类型与 Artifact Index

- 建立 ID、revision、hash、dependency 和 validation。
- 兼容读取 design-spec、page-plan、SVG 页，以及遗留 brief/outline/storyboard/layout-plan。

### Phase 2：作者文件与注册表对齐

- 默认 project artifact / workspace probe 与 SVG-native 锁文件对齐。
- 明确遗留 storyboard/layout-plan 的导入或只读兼容边界。

### Phase 3：PptJob Orchestrator

- Job Params/State/Stage Workspace。
- durable transitions 和 UI projection。
- 拆开 Query/run completed 与 job/artifact ready。

### Phase 4：Quality 与 Proposal 边界

- Candidate/Preview/Proposal/Presentation 边界收敛。
- SubmitSvgDeck 与遗留命令提案共用 Job 投影。

### Phase 5：Edit、Recovery、Export

- Create/Edit/Restyle/Review/Export 接入 Job。
- 清理重复 probe status 和旧 writer。

## 11. 不进入本路线

- 不替换通用 Query Loop。
- 不把 Lean 重新挂回产品 Mode。
- 不绕过 CommitGate。
- 不用 TaskStore 代替 PptJob。
- 不用无限视觉模型循环修稿。
- 不取消 SVG-native 作为新建权威路径。

## 12. 完成定义

- PPT Job 是跨 Query 的唯一业务工作流状态。
- 关键 artifact 均有 immutable revision、hash、dependency 和 validation。
- 新建与编辑共用 Presentation / CommitGate / 导出门面。
- candidate、proposal、committed Presentation 边界明确。
- 上游修改确定性标记下游 stale。
- 崩溃恢复不重复 apply/export 等副作用。
