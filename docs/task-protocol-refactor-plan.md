# Task 持久化协议重构设计

> 状态：设计完成，待实施
>
> 范围：Task 数据模型、文件持久化、模型工具、query loop 接入、teammate 消费、UI 同步及相关 prompt。
>
> 重构策略：产品契约 clean break，但测试持续受保护。先建立新协议测试，再迁移实现和调用方；只有旧断言已被等价或更强的新测试覆盖后，才删除只验证旧工具名或旧 schema 的测试。

## 1. 目标与非目标

Task 是模型通过工具主动维护的一组持久化工作状态。query loop 只负责收集模型返回的 `tool_use`、执行 Task 工具、生成配对的 `tool_result`，并在下一轮把调用和结果交还模型。

query loop 不根据普通工具调用推导任务进度，不在运行时内部维护 Task 状态机，也不因 `Read*`、`SubmitCommands`、文件写入或 teammate activity 自动推进 Task。

本次重构目标：

- 将 `status`、`owner`、依赖关系、review 拆成四个正交维度；
- 用一组职责分离的 `Task*` 工具形成唯一模型协议；
- 让 lead 与 teammate 共用同一套持久化语义；
- 保留跨进程并发认领、依赖调度、崩溃恢复和 UI 实时同步；
- 移除当前 `TaskGraph*` 中与模型驱动协议冲突的隐式状态变更。

非目标：

- 不把 Task 做成长期项目历史或审计日志；
- 不在底层强制 `pending → in_progress → completed` 有限状态机；
- 不自动把认领等同于开始执行；
- 不保留旧 `TaskGraph*` 工具名、旧 JSON schema 或旧测试兼容层。

## 2. 当前实现与目标协议的差异

| 当前实现 | 目标协议 |
|---|---|
| `pending / in_progress / submitted / completed` | `pending / in_progress / completed` |
| `claimTask()` 同时写 owner 和 `in_progress` | claim 只写 owner |
| `completeTask()` 清空 owner | 完成状态与 owner 独立，默认保留 owner |
| `TaskGraphClaim / TaskGraphComplete` 混合 owner 与状态变更 | 普通字段、owner 命令和 review 命令职责分离 |
| `executionTarget` 是散落的一级字段 | 收敛为受权限保护的强类型 `routing.executionTarget` |
| `blockedBy` 单向存储 | `blocks / blockedBy` 双向持久化并保持一致 |
| `_meta.json` 计数器缺少 task-list 级原子边界 | canonical `tasks.json` 中的 high-water mark 在 task-list 锁内更新 |
| `.tasks/` 直接挂在 workspace 下 | `.tasks/<taskListId>/` 按会话或团队隔离 |
| 工具调用会自动 spawn worker | watcher/worker 生命周期独立于 CRUD 工具 |
| `TaskGraphCreatePlan` 维护唯一 active plan | 模型按需调用 `TaskCreate`，不维护隐藏 plan 状态 |
| UI 依赖工具主动 publish | 同进程 signal + 跨进程 watch/poll 统一刷新 |
| `submitted` 同时承担进度和验收语义 | 顶层 `review` 作为可恢复、正交的验收状态 |

当前 `submitted` 表示 teammate 已完成工作但等待 lead 验收。新协议不再把“待验收”混入工作进度：

- teammate 先持久化 `review=requested`，再通过 mailbox 发变更通知；
- Task 保持 `in_progress`，owner 保持 teammate；
- lead 验收通过时在同一事务内写入 `review=approved` 并设为 `completed`；
- 验收不通过时写入 `review=changes_requested`，再通过 mailbox 给 owner 反馈；
- 只有 `completed` 才解除下游依赖。

## 3. 目标数据模型

```ts
export const taskStatusSchema = z.enum([
  "pending",
  "in_progress",
  "completed",
]);

export const taskSchema = z.object({
  id: z.string().min(1),
  revision: z.number().int().nonnegative(),
  subject: z.string().min(1),
  description: z.string(),
  activeForm: z.string().optional(),
  owner: z.string().optional(),
  status: taskStatusSchema,
  blocks: z.array(z.string()),
  blockedBy: z.array(z.string()),
  routing: z.object({
    executionTarget: z.enum(["lead", "teammate"]),
  }),
  completionPolicy: z.enum(["direct", "review_required"]),
  review: z.discriminatedUnion("state", [
    z.object({ state: z.literal("none") }),
    z.object({
      state: z.literal("requested"),
      requestId: z.string().min(1),
      requestedBy: z.string().min(1),
      requestedAt: z.string().datetime(),
    }),
    z.object({
      state: z.literal("changes_requested"),
      requestId: z.string().min(1),
      requestedBy: z.string().min(1),
      requestedAt: z.string().datetime(),
      reviewedBy: z.string().min(1),
      reviewedAt: z.string().datetime(),
      reason: z.string().optional(),
    }),
    z.object({
      state: z.literal("approved"),
      requestId: z.string().min(1),
      requestedBy: z.string().min(1),
      requestedAt: z.string().datetime(),
      reviewedBy: z.string().min(1),
      reviewedAt: z.string().datetime(),
    }),
  ]),
  reviewReceipts: z.array(z.object({
    commandType: z.enum(["request", "approve", "reject"]),
    requestId: z.string().min(1),
    resultState: z.enum(["requested", "approved", "changes_requested"]),
    actorId: z.string().min(1),
    committedAt: z.string().datetime(),
  })),
  userMetadata: z.record(z.string(), z.unknown()).optional(),
  systemMetadata: z.record(z.string(), z.unknown()).optional(),
});
```

持久化模型不包含运行时派生字段。以下内容在读取时计算：

- `isBlocked`；
- `incompleteBlockedBy`；
- `canClaim`；
- UI owner label；
- 当前 task list 是否全部完成。

`createdAt / updatedAt / claimInstanceId / planId` 不再是顶层协议字段：

- 系统时间戳写入只能由 Store 维护的 `systemMetadata`；
- 模型可编辑扩展信息只能写入 `userMetadata`；
- `routing` 和 `completionPolicy` 是受保护的调度与完成策略，不能通过通用 metadata 更新；
- 计划目标使用任务描述或 `userMetadata` 表达，不再维护 `_plan.json`。

### 3.1 四个独立维度

| 维度 | 权威字段 | 写入者 |
|---|---|---|
| 工作进度 | `status` | 模型调用 `TaskUpdate` |
| 任务认领 | `owner` | `claim / assign / release / transfer` 专用命令 |
| 依赖关系 | `blocks / blockedBy` | 模型调用工具，store 维护双向一致性 |
| 验收状态 | `review` | `request / approve / reject` 专用命令 |

允许出现但不鼓励的组合：

- `pending + owner`：已认领，尚未开始；
- `in_progress + owner=undefined`：已开始但未声明执行者；
- `completed + owner`：保留完成者；
- `completed → in_progress`：重开任务。

底层不强制单一的 `pending → in_progress → completed` FSM，但每个命令仍校验自己的前置条件，拒绝无意义或越权的状态组合。推荐生命周期同时由工具 schema 和 system prompt 约束。

### 3.2 Revision 与稳定错误

每个 task 带单调递增的 `revision`，task list 带从 `0` 开始的 `listRevision`：

- 每个成功且产生实际变化的 mutate 恰好令 `listRevision += 1`；
- 变更集中的每个 task 各自 `revision += 1`，新建 task 从 `0` 开始；
- 建立或删除双向依赖时，两端 task 都增加 revision；
- `TaskUpdate`、assign、transfer、release、review request/approve/reject 的 `expectedRevision` 必填；
- 依赖更新和 delete 同时要求 `expectedRevision` 与 `expectedListRevision`；
- close/reopen/archive 的 `expectedListRevision` 必填；
- 只有 claim 允许省略 `expectedRevision`，因为“owner 仍为空”本身就是锁内竞争条件；传入时作为额外约束；
- no-op 幂等重放不增加任何 revision；
- UI snapshot 直接使用持久化 `listRevision` 去重，内容 hash 仅用于检测存储损坏；
- revision 不代替 task-list 锁，只阻止调用者基于旧快照覆盖新状态。

V1 稳定错误至少包括：

- `TASK_NOT_FOUND`；
- `REVISION_CONFLICT`；
- `OWNER_CONFLICT`；
- `TASK_BLOCKED`；
- `OWNER_BUSY`；
- `TASK_ALREADY_COMPLETED`；
- `INVALID_STATE_TRANSITION`；
- `NOT_AUTHORIZED`；
- `REVIEW_ALREADY_REQUESTED`；
- `REVIEW_REQUEST_MISMATCH`；
- `LIST_CLOSED`；
- `LIST_ARCHIVED`；
- `MIGRATION_FAILED`。

### 3.3 可信执行主体

模型参数不是身份来源。runtime 在构造 ToolContext 时注入不可由 tool input 覆写的主体：

```ts
type TaskPermission =
  | "task:create"
  | "task:update_own"
  | "task:update_any"
  | "task:manage_dependencies"
  | "task:manage_routing"
  | "task:assign"
  | "task:review"
  | "task:manage_list";

type TaskCommandPrincipal = {
  actorId: string;
  role: "lead" | "teammate" | "system";
  teamSessionId?: string;
  permissions: ReadonlySet<TaskPermission>;
};
```

唯一写入口为：

```ts
TaskStore.mutate(identity, command, principal)
```

`requestedBy`、`reviewedBy`、系统时间戳和审计 actor 全部由 Store 从 principal 写入，模型输入不得包含这些字段。identity 校验按 scope 区分：

- `scope="team"`：principal 必须携带 `teamSessionId`，且与 canonical team identity 精确匹配；
- `scope="conversation"`：principal 必须绑定当前 conversation/thread identity；不得因缺少 teamSessionId 降级为未校验，也不得让其他 team principal 接入；
- identity 不匹配统一返回 `NOT_AUTHORIZED`，并且必须发生在读取或修改 task 内容之前。

V1 权限矩阵：

| 操作 | lead | teammate | system watcher |
|---|---|---|---|
| create | 允许 | 仅显式授权时允许 | 禁止 |
| 更新 subject/description/activeForm/userMetadata | 任意 task | 仅自己 owner 的 task | 禁止 |
| 更新 status | 任意 task，仍受 completion policy 限制 | 仅自己 owner 的 task | 禁止 |
| 更新依赖 | 允许 | 禁止 | 禁止 |
| 修改 routing/completionPolicy | 允许 | 禁止 | 禁止 |
| claim/release 自己 | 允许 | 允许 | 禁止伪装为其他 actor |
| assign/transfer 他人 | 允许 | 禁止 | 仅 recovery policy 明确授权时允许 |
| request review | 允许 | 仅自己 owner 的 task | 禁止 |
| approve/reject | 允许 | 禁止 | 禁止 |
| close/reopen/archive | 允许 | 禁止 | system 仅可执行 retention cleanup，不可代替 archive 决策 |

idle watcher 必须使用即将接收 assignment 的具体 teammate principal 调用 claim，而不是使用 `role=system` 再传入 owner。`system` principal 只用于明确的 orphan-owner recovery 和 retention cleanup；这些内部命令的目标由 runtime 状态产生，不接受模型参数。

## 4. 模型工具与 Store 命令协议

模型可见工具统一使用 `Task*` 前缀。Store 不提供一个可任意覆写所有字段的万能 update；工具层将输入映射为职责分离命令，并统一进入 `TaskStore.mutate(identity, command, principal)`。principal 只来自 runtime context。

### 4.1 `TaskCreate`

输入：

```ts
{
  subject: string;
  description: string;
  activeForm?: string;
  executionTarget: "lead" | "teammate";
  completionPolicy: "direct" | "review_required";
  userMetadata?: Record<string, unknown>;
}
```

固定初始化为 `pending`、`revision=0`、无 owner、无依赖、`review=none`、`reviewReceipts=[]`。teammate 路由的任务必须使用 `review_required`；只有 lead 路由任务可以使用 `direct`。teammate principal 即使具备 create 权限，也只能创建 `executionTarget=teammate + review_required`；其他组合返回 `NOT_AUTHORIZED`。依赖由模型取得任务 ID 后通过受权限保护的依赖更新建立。

创建成功后：

- 在 task-list 锁内运行纯 Store validator 并提交完整 `tasks.json`；
- 释放锁后发出 `tasks-updated` 并运行观察型 hook；
- 返回完整 task、稳定摘要和错误 code。

### 4.2 `TaskUpdate`

输入：

```ts
type TaskUpdateInput = {
  taskId: string;
  expectedRevision: number;
  subject?: string;
  description?: string;
  activeForm?: string;
  status?: "pending" | "in_progress" | "completed";
  userMetadata?: Record<string, unknown>;
} & (
  | {
      dependencyChanges?: undefined;
    }
  | {
      expectedListRevision: number;
      dependencyChanges: {
        addBlocks?: string[];
        addBlockedBy?: string[];
        removeBlocks?: string[];
        removeBlockedBy?: string[];
      };
    }
);
```

约束：

- 删除使用独立 `TaskDelete` 命令；
- `userMetadata` 浅合并，值为 `null` 时删除 key；`systemMetadata/routing/completionPolicy` 不在此输入中；
- 依赖使用 `dependencyChanges` 增删操作，避免并发覆盖丢边；
- schema 是两个互斥 variant：普通字段更新不接受 list CAS 字段；依赖 variant 的 `expectedListRevision` 必填；
- 加边校验节点存在、禁止 self-edge 和依赖环；
- `blocks` 与 `blockedBy` 在同一个 task-list 锁内双向更新；
- `TaskUpdate` 不允许修改 owner 或 review；
- 普通完成只适用于 `completionPolicy=direct`、`routing.executionTarget=lead` 且 principal 有权更新该任务的情况；
- `completionPolicy=review_required` 的任务只能由 `TaskReviewApprove` 进入 completed，即使 review 当前为 none 也拒绝普通完成；
- 不自动清空 owner，不自动删除后继任务依赖；
- 命令校验 `expectedRevision`，提交后增加 task revision。

一次调用中的多个字段必须原子提交，不暴露半更新图。

工具 schema 使用 union/superRefine 保证：不含依赖操作时禁止伪造无意义的 list CAS；包含任一 `add/remove Blocks/BlockedBy` 时 `expectedListRevision` 必填。该条件在 tool validation 和 Store command validation 两层执行。

### 4.2.1 Delete 与 reopen

- `TaskDelete(taskId, expectedRevision, expectedListRevision)`：仅 lead；删除目标及所有反向边，因此同时校验 task/list revision；
- `TaskReopen(taskId, expectedRevision)`：仅 lead 且 list=open；将 completed 恢复为 pending并保留 owner；当前 `review=approved` 对应 receipts 已在 `reviewReceipts` 中，按最近 20 个完整轮次统一保留，当前 review 重置为 none；
- 两者都不是 `TaskUpdate` 的特殊 status 值。

### 4.3 Owner 命令

- `TaskClaim(taskId, expectedRevision?)`：唯一允许 blind write 的竞争命令；owner 强制取 `principal.actorId`，要求 owner 为空、任务未完成、未阻塞且 agent 不 busy。传入 revision 时额外校验。
- `TaskAssign(taskId, owner, expectedRevision)`：lead 的管理性指派；禁止静默覆盖非空 owner。
- `TaskRelease(taskId, expectedRevision)`：普通调用者只能释放自己；lead/system recovery 可按权限释放他人。
- `TaskTransfer(taskId, newOwner, expectedRevision)`：仅 lead；Store 从当前记录校验旧 owner，并原子检查新 owner busy 状态。

所有 owner 变化只能通过上述命令。`TaskUpdate` 和通用 metadata 更新不得绕过 owner 约束。

### 4.4 Review 命令

- `TaskReviewRequest(taskId, requestId, expectedRevision)`；
- `TaskReviewApprove(taskId, requestId, expectedRevision)`；
- `TaskReviewReject(taskId, requestId, reason?, expectedRevision)`。

`requestedBy/reviewedBy/requestedAt/reviewedAt` 均由 Store 从 principal 和时钟写入。

生命周期：

```text
pending
  → in_progress / review=none
  → in_progress / review=requested
  → in_progress / review=changes_requested
  → in_progress / review=requested
  → completed / review=approved
```

规则：

- request 仅允许当前 owner 发起；approve/reject 仅允许有验收权限的 lead 发起；
- reject 写入 `changes_requested`；
- worker 修复后重新 request 必须生成新 requestId；
- approve 与设置 `completed/review=approved` 在同一原子替换中完成；
- approved 终态永久保留最后 requestId、请求者、验收者和时间；UI 将其派生为“无待处理验收”，但不得擦除；
- 对 `approved` 的相同 requestId 重放 approve/通知返回幂等成功且不增加 revision；不同 requestId 返回 `TASK_ALREADY_COMPLETED`；
- 对 `changes_requested` 的相同 requestId 重放 reject/通知返回同一终态；修复后只能用新的 requestId 执行 `TaskReviewRequest` 开启下一轮；
- 所有 review 命令先按 `(commandType, requestId)` 检查当前 review 和 `reviewReceipts`；命中时直接返回已提交结果并跳过 `expectedRevision`，否则才执行正常 revision 和状态校验，避免 tool_result 丢失后的合法重放被旧 revision 拒绝；
- 每次 review 命令成功提交时写入对应 receipt；进入新 request 前，上一轮 receipt 必须已经持久化，不能因当前 review 从 `RC(A)` 替换为 `RQ(B)` 而丢失；
- `reviewReceipts` 按 review 轮次保留最近 20 轮，每轮包含该 requestId 已成功提交的 request 及 approve/reject receipt；裁剪只能在同一事务内删除最旧完整轮次，不能留下半轮；
- 幂等检查先查当前 review，再查 receipt history；命中历史 receipt 返回原结果且不增加 task/list revision；只有当前状态和历史都没有匹配项时才返回 mismatch 或状态错误；
- release 或 owner 退出不清除 review；
- mailbox 发送失败不回滚已提交状态，可按稳定 requestId 重试通知；
- 重启后完全由 task record 重建 review UI。

幂等键是 `(commandType, requestId)`，不能只比较 requestId：

| 当前 review | 命令 | 结果 |
|---|---|---|
| `RQ(A)` | `Request(A)` | 幂等成功，不增加 revision |
| `RQ(A)` | `Request(B)` | `REVIEW_ALREADY_REQUESTED` |
| `RQ(A)` | `Approve(A)` / `Reject(A)` | 正常提交 |
| `RQ(A)` | `Approve(B)` / `Reject(B)` | `REVIEW_REQUEST_MISMATCH` |
| `RC(A)` | `Reject(A)` | 幂等返回上次 reject 终态 |
| `RC(A)` | `Request(A)` | `REVIEW_REQUEST_MISMATCH`，不能把旧请求当成新一轮 |
| `RC(A)` | `Request(B)` | 进入 `RQ(B)` |
| `RC(A)` | `Approve(A)` | `INVALID_STATE_TRANSITION` |
| `RA(A)` | `Approve(A)` | 幂等返回已完成终态 |
| `RA(A)` | 任意使用 `B` 的 review 命令 | `TASK_ALREADY_COMPLETED` |
| `RQ(B)` | 延迟重放 `Reject(A)`，且历史有 receipt | 幂等返回 `RC(A)` 的既有结果，不改变当前 `RQ(B)` |

幂等 receipt 检查必须先于 expectedRevision 校验；只有表中明确且能在当前 review 或 receipt history 中找到的同命令重放可跳过旧 revision。历史命中只返回当时结果，不得把旧终态重新写回当前 review。其他命令仍严格校验必填 revision。

### 4.5 `TaskList`

读取当前 `taskListId` 的全部任务，返回结构化列表和模型摘要：

```text
#1 [pending] 生成 brief
#2 [in_progress] 编写 storyboard (worker-a)
#3 [pending] 执行版式 [blocked by #2]
```

摘要只展示未完成 blocker，完整 JSON 保留原始依赖。`TaskList` 不创建 worker、不认领任务、不修改状态。

### 4.6 `TaskGet`

按 ID 返回完整任务及派生信息：

```ts
{
  task: Task;
  derived: {
    isBlocked: boolean;
    incompleteBlockedBy: string[];
    canClaim: boolean;
  };
}
```

### 4.7 Task list 生命周期

- list 状态机为 `open → closed → archived`，并允许有管理权限的 lead 执行 `closed → open`；
- `TaskCloseList(expectedListRevision)` 停止 task mutation，但不删除数据；
- `TaskReopenList(expectedListRevision)` 只允许 lead，将 closed 恢复为 open；
- `TaskArchiveList(expectedListRevision, outcome, archiveReason?)` 仅允许 lead，将 closed list 标记为只读归档；
- `outcome` 必须是 `"completed" | "abandoned"`：completed 要求 `readyToArchive=true`，abandoned 允许保留未完成任务且必须提供 `archiveReason`；
- closed 禁止 task create/update/delete/owner/review 命令，但允许 reopen 和 archive；
- archived 永久只读，不允许 reopen；
- completed task 只有 list 为 open 时才能显式 reopen；
- archive 之后只读保留，物理清理由独立、明确的 retention policy 负责。

### 4.8 命令状态矩阵

`R0/RQ/RC/RA` 分别表示 review 为 none/requested/changes_requested/approved。

| 命令 | pending | in_progress | completed | review 约束 |
|---|---|---|---|---|
| update 内容/userMetadata | 允许 | 允许 | lead 可修正文案；不得改依赖 | RQ 时仅 owner/lead 可改工作内容 |
| update → in_progress | 仅未阻塞时允许 | no-op | 禁止，使用 reopen | 仅 R0/RC |
| update → pending | no-op | lead 或 owner 可暂停 | 禁止，使用 reopen | RQ 禁止；RC 允许 |
| update → completed | 仅未阻塞的 direct+lead task | 仅未阻塞的 direct+lead task | no-op | 必须 R0；review_required 一律走 approve |
| delete | lead | lead | lead | RQ 时拒绝，先 reject/close review |
| claim | owner 为空且未阻塞 | 仅恢复语义且 owner 为空 | 禁止 | RQ/RA 禁止，RC 可由原 owner 或 lead 重新分配 |
| assign/transfer/release | 允许 | 允许 | release 仅 lead；assign/transfer 禁止 | RQ 时 release/transfer 仅 lead，review 不清除 |
| request review | 禁止 | owner 可请求 | 禁止 | R0/RC → RQ；同 requestId 幂等 |
| approve | 禁止 | 仅未阻塞时 lead 可批准并完成 | 同 requestId 幂等 | RQ → RA |
| reject | 禁止 | lead 可拒绝 | 同 requestId 幂等 | RQ → RC |
| reopen task | 不适用 | 不适用 | 仅 lead 且 list=open | RA → R0；当前轮 receipts 已在 `reviewReceipts` 中，按最多 20 轮统一保留 |
| close list | list=open 时允许 | list=open 时允许 | list=open 时允许 | 不改变 task/review |
| archive list | closed 时仅允许 outcome=abandoned | closed 时仅允许 outcome=abandoned | closed 时可 completed 或 abandoned | 只允许 lead |

所有 task mutation 还必须先满足 list=`open`、principal 权限、expected revision 和依赖不变量；表中的“允许”不绕过这些前置条件。

依赖是硬执行约束：blocked task 不能 claim、不能从 pending 进入 in_progress、不能 direct complete，也不能 review approve。lead 如需越过依赖，必须先用带 task/list revision 的显式依赖更新删除对应边，让图变化可观察、可审计。

## 5. Store、目录与并发

### 5.1 目录布局

```text
<workspace>/
├── .task-storage-migration.lock
└── .tasks/
    ├── schema.json
    └── <readable-prefix>-<identity-hash>/
        ├── .lock
        └── tasks.json
```

V1 明确选择“单个 canonical `tasks.json`”方案，不做原地多文件事务，也不使用 manifest 作为提交边界：

```ts
type PersistedTaskList = {
  format: "task-list";
  version: 1;
  identity: TaskListIdentity;
  state: "open" | "closed" | "archived";
  archive?: {
    outcome: "completed" | "abandoned";
    reason?: string;
    archivedBy: string;
    archivedAt: string;
  };
  listRevision: number;
  highWatermark: number;
  hasEverContainedTasks: boolean;
  tasks: Record<string, Task>;
};
```

一条命令的 task、反向依赖、review、list revision 和 high-water mark 全部位于同一 JSON 文档中，通过一次 atomic replace 同时生效。读取者只可能看到完整旧版本或完整新版本，不存在半更新图，也不需要猜测崩溃前事务意图。

所有调用方使用集中式 `TaskListIdentityResolver`。runtime 创建时只解析一次：

```ts
type TaskListIdentity = {
  taskListId: string;
  scope: "conversation" | "team";
  canonicalKey: string;
};
```

解析优先级：

1. 显式 runtime `taskListId`；
2. team session 的稳定 ID；
3. conversation `threadId`。

解析结果注入 runtime context，fork、continue、recovery、lead 和 teammate 直接继承，不重新推导。目录名使用 `<readable-prefix>-<sha256(canonicalKey).slice(0, 16)>`，不能只 sanitize；canonical `tasks.json` 保存完整 identity，并在打开时检查 hash 碰撞和身份不匹配。

### 5.2 锁粒度

V1 每个 task list 同一时刻只有一个 writer。创建、更新、删除、依赖变更、claim、assign、release、transfer、review 和 archive 都进入同一事务入口：

```text
TaskStore.mutate(identity, command, principal)

取得 task-list lock
→ 读取并校验整个 tasks.json
→ 校验 revision、owner、依赖、review、权限和状态
→ 运行纯 Store validator
→ 在内存副本计算完整新 task list
→ 写入同目录临时文件并 flush/fsync
→ atomic rename 替换 tasks.json
→ fsync 父目录
→ 释放锁
→ 发送通知和执行观察型 hook
```

V1 不引入 task 文件锁、redo journal 或自动 CAS 重试。崩溃发生在 rename 前则继续读取旧文件，发生在 rename 后则读取新文件；临时文件永远不是读取入口，启动时只做安全清理。任何 schema、identity hash 或双向边校验失败都 fail-closed，不自动“修复”或猜测。`highWatermark` 只增不减。

`claimTask` 检查任务存在、未完成、未被他人认领、未阻塞和 agent-busy；成功只写 `owner`，不修改 `status`。

### 5.3 删除、关闭与归档

- `TaskDelete(expectedRevision, expectedListRevision)` 删除单个任务并移除其他节点指向它的边；
- 空 task list 表示“尚无任务”，不表示完成；
- “曾包含任务且当前全部 completed”只是派生的 `readyToArchive`，不是额外持久化状态；
- 全部 completed 后 UI 可在 5 秒后折叠，但磁盘状态继续保留；
- `TaskCloseList` 显式关闭 task mutation；
- `TaskReopenList` 可由 lead 恢复写入；
- `TaskArchiveList` 仅从 closed 进入只读归档；
- completed 或 archived 数据只能由明确 retention policy 清理，UI timer 不得删除数据。
- retention cleanup 使用独立 storage-root cleanup lock；它不能改变 task/list revision，只能按已归档时间和策略物理删除整个目录。

### 5.4 存储迁移

迁移使用 `.tasks` 目录外的固定 `.task-storage-migration.lock`。新版根目录必须包含：

```json
{
  "format": "task-store",
  "version": 1
}
```

迁移流程：

```text
取得 migration lock
→ 读取 schema marker
→ 精确判断 legacy/new schema
→ 确认没有部分迁移
→ legacy 目录 rename 到带 UUID/进程随机量的唯一备份名
→ 创建新版目录和 schema marker
→ fsync 并重新读取验证
→ 释放锁
```

不能只根据目录中是否存在 JSON 推断版本。迁移失败返回 `MIGRATION_FAILED` 并禁止创建或写入空 task list；两个进程同时启动时，后取得锁者必须重新读取 marker，不得重复迁移。

## 6. Query loop 集成边界

保留现有通用流程：

```text
model response
  → 收集所有 tool_use blocks
  → 执行 tool batch
  → 生成一一配对的 tool_result blocks
  → 下一模型轮
```

Task 工具只注册到 core registry，不给 query loop 增加按具体工具名识别的 Task 专用分支。删除：

- discover 阶段强制 `TaskGraphCreatePlan` 的 preflight；
- 按名称识别 `TaskGraph*` 的策略分支；
- CRUD 工具内部自动 spawn worker；
- query 关闭时把 owner 和 `in_progress` 一起回滚。

每个 Task tool schema 使用 strict object，拒绝未声明的 `actorId/role/requestedBy/reviewedBy/systemMetadata` 等字段。tool execute 从 `ToolContext.taskPrincipal` 取得 principal，再调用 Store；模型消息、tool input 和恢复 transcript 中的任意身份字符串都不能覆盖该对象。lead、teammate、watcher/recovery runtime 分别在创建 context 时绑定自己的 principal。

query cancellation 只结束模型执行。是否释放 owner 由 ownership lifecycle 决定，不能顺便修改 status。

system prompt 只约束模型：复杂任务先创建任务；开始工作前更新 `in_progress`；通过专用 review 工具请求和完成验收；普通工具成功不自动推进 Task；恢复时先 `TaskList` 再 `TaskGet`。

## 7. Teammate watcher 与验收

```text
idle
  → 第一优先级：扫描 in_progress + unowned + unblocked + teammate-routable + review=none
  → recovery claim
  → TaskGet + 检查已有 artifact
  → 以恢复 prompt 提交 teammate query

没有普通恢复项
  → 扫描 changes_requested + unowned + unblocked + teammate-routable
  → 仅原 requestedBy 对应的 teammate 可 recovery claim
  → 原 actor 不存在或不可用时留给 lead 显式 TaskAssign

没有 recovery 项
  → 扫描 pending + unowned + unblocked + teammate-routable
  → claimTask（只写 owner）
  → TaskGet
  → 提交普通 teammate query
  → 模型 TaskUpdate(in_progress)
  → 执行实际工具
  → TaskReviewRequest（持久化）
  → mailbox: task_review_requested（通知）
  → lead 验收
  → lead TaskReviewApprove（原子完成）
```

watcher 只消费 `routing.executionTarget === "teammate"` 的任务。routing 没有缺省值，创建时必须显式提供；只有具有 `task:manage_routing` 权限的 lead 可修改。teammate 对 routing、completionPolicy 或 systemMetadata 的修改不会进入 Store command schema，并在越权入口返回 `NOT_AUTHORIZED`。

teammate 结束、失败或 step limit 时：

- 可释放 owner；
- 不自动把 `in_progress` 改回 `pending`；
- mailbox 告知 lead `task_owner_released`；
- 后续模型决定重开、重新认领或删除。

恢复规则：

- `in_progress + review=none + unowned` 进入普通恢复队列，可由任一合格 teammate 认领；
- `changes_requested(A) + unowned` 只允许 `requestedBy` 对应 actor 自动恢复；原 actor 已不存在时 watcher 不抢占，由 lead 显式 assign/transfer；
- `requested(A) + unowned` 不重新认领，因为工作已经进入 lead 验收阶段；lead 仍可 approve/reject；
- lead reject 后状态进入 `changes_requested`，再按上一条恢复或重新指派；
- orphan recovery 释放 owner 时保留 review、requestId 和 artifact 信息；
- 所有 recovery claim 仍要求未阻塞；恢复 prompt 必须先 `TaskGet` 并检查已有 artifact，禁止默认从头执行。

## 8. Hooks 与消息

首期将扩展点分成两类：

- Store validator：事务内执行的同步或严格受控纯函数，禁止 I/O、禁止访问 TaskStore、禁止重入；输入 `{ command, currentSnapshot, proposedSnapshot }`，可用稳定错误 code 阻断提交。
- Runtime notification hook：提交后执行，可异步和 I/O，必须幂等；失败只能产生 warning，不可回滚已提交事实。

如果未来必须让外部异步 pre-hook 阻止完成，采用“锁外读取 snapshot/revision → 执行幂等 pre-hook → 取得 list lock → 校验 revision 未变化 → 提交”。revision 变化时返回 `REVISION_CONFLICT`，不得自动重试不保证幂等的 hook。

`task_assignment`、`task_review_requested`、`task_review_rejected`、`task_owner_released` 走现有 mailbox，但 mailbox 只通知状态变化，不保存事实。消息失败不回滚 task 文件，只返回 warning，并由 watcher 根据 task record 和稳定 requestId 重试。

工具结果同时包含机器可读数据、稳定错误 code、模型摘要和 mailbox warning。

## 9. UI 同步

main process 提供唯一 `TaskSubscriptionService`：

- 同进程写入后调用 `notifyTasksUpdated(taskListId)`；
- 使用 `fs.watch` 监听当前 task list；
- 每 5 秒 fallback poll；
- 每次从磁盘重建 snapshot；
- 直接用持久化 `listRevision` 去重；内容 hash 只做防御性完整性校验。

renderer 接收：

```ts
type TaskListSnapshot = {
  taskListId: string;
  tasks: Task[];
  listRevision: number;
  state: "open" | "closed" | "archived";
  archive?: {
    outcome: "completed" | "abandoned";
    reason?: string;
  };
};
```

展示规则：

- status 决定进度图标；
- owner 独立显示；
- blocker 只展示未完成项；
- 全部完成后保留 5 秒再折叠，磁盘记录保持可查询；
- archived/completed 与 archived/abandoned 使用不同终态标签；abandoned 永远不能显示为“全部完成”；
- 不展示 `submitted`，待验收直接由 task 的持久化 review 状态重建；activity/mailbox 只补充通知过程。

## 10. 删除与替换清单

实施时替换旧产品契约，但测试必须先建立覆盖映射：

- 删除 `TaskGraphCreatePlan / TaskGraphClaim / TaskGraphComplete`；
- 替换为职责分离的 `TaskCreate / TaskUpdate / TaskDelete / TaskList / TaskGet / TaskClaim / TaskAssign / TaskRelease / TaskTransfer / TaskReopen / TaskReviewRequest / TaskReviewApprove / TaskReviewReject / TaskCloseList / TaskReopenList / TaskArchiveList`；
- 删除 `submitted` 及其 UI、prompt、submit tool；
- 删除旧顶层 `executionTarget / claimInstanceId / planId / createdAt / updatedAt`，新增受保护的 `routing/completionPolicy`；
- 删除 `_plan.json`、active-plan 限制和 create-plan preflight；
- 删除 claim 自动改 `in_progress`、complete 自动清 owner、shutdown 自动改回 `pending`；
- 删除 CRUD 工具内的 worker spawn；
- 先增加新协议测试；只有对应新测试已通过，才删除只验证旧工具名或旧 schema 的测试，并记录旧测试到新测试的映射。

旧 `.tasks/*.json` 不转换为新 task。首次启动新版时在目录外迁移锁保护下，将旧目录原子重命名为 `.tasks-legacy-<uuid>`，再创建带明确 schema marker 的新目录。读取路径不长期保留 legacy 分支，迁移失败 fail-closed。

## 11. 新测试设计

先新增新协议测试并保持现有测试可运行；调用方完成切换后，逐项移除已经被等价或更强新断言覆盖的旧契约测试。每个阶段都运行相关测试、`npm.cmd run typecheck` 和 `npm.cmd test`。

### 11.1 Store

- 默认值与 high-water mark；
- update 合并、delete 和必填 revision conflict；
- status/owner/dependency/review 四维正交及各命令约束；
- principal 不可由模型参数伪造，teammate 越权修改 routing/systemMetadata/他人 task 返回 `NOT_AUTHORIZED`；
- 双向依赖、环检测和动态解阻塞；
- 旧字段更新不覆盖并发新增依赖；
- 并发 create ID 唯一；
- 双 claim、assign 与 claim、release 与 transfer 竞态；
- review request 幂等、approve 与 reject 竞态；
- approve 提交后 tool_result 丢失时，相同 requestId 重放为 no-op 成功；
- reject 后重复旧 request、不同 requestId 重新请求及通知重试；
- `Reject(A) → Request(B)` 后延迟重放 `Reject(A)`，命中历史 receipt 但不覆盖当前 `RQ(B)`；
- review receipts 按完整轮次保留最近 20 轮，裁剪不会留下半轮；
- 每个 mutate 的 listRevision 与受影响 task revision 精确递增；
- direct/review_required 的完成权限及 completed task reopen；
- blocked task 不能 start/direct-complete/review-approve，删除依赖后才可继续；
- archive completed/abandoned outcome、reason 和 UI 终态区分；
- open/closed/archived 命令矩阵和 retention cleanup 锁；
- validator 阻断不落盘且不可重入；
- archive 后只读、completed 后重启仍可查询。

### 11.2 Tool 与 query

- 所有职责分离工具的 schema、结果和稳定错误 code；
- post-commit hook 失败只 warning，validator 才能阻断；
- mailbox 失败只 warning；
- 单轮多个 Task tool calls；
- `tool_use/tool_result` 一一配对；
- 普通工具成功不修改 task；
- cancellation/recovery 不自动改 status。

### 11.3 多进程、UI 与 teammate

- 两个 store 实例并发 create/claim/update；
- 在 canonical 临时文件写入前、fsync 后、rename 前和 rename 后注入进程失败，读取结果必须是完整旧版或完整新版；
- watch/poll 跨进程刷新和 revision 去重；
- 迁移双进程启动、部分迁移和 fail-closed；
- 完成态 UI 折叠但磁盘保留；
- watcher claim 后仍为 pending；
- watcher 优先恢复 in_progress/unowned，再消费 pending；RQ 不认领，RC 仅原 requestedBy 自动恢复；
- review request 幂等且不解锁下游；
- approve 原子完成后下游可认领；
- reject 与 approve 竞争只允许一个 revision 获胜；
- review `(commandType, requestId)` 幂等矩阵全部组合；
- review receipt 跨进程重启和跨轮次重放；
- teammate 崩溃只释放 owner；
- `in_progress + unowned` 恢复认领；
- 通知失败和重启后完全从 TaskStore 恢复 UI；
- taskList identity 在 fork、continue、recovery 和 teammate 间保持一致。

真实模型集成至少验证：

```text
TaskCreate → TaskUpdate(dependency) → watcher claim
→ teammate TaskUpdate(in_progress) → actual tool
→ TaskReviewRequest → lead TaskReviewApprove → downstream claim
```

## 12. 实施与验收

### 阶段 1：冻结协议与建立新契约测试

确定 revision、owner 命令、review、稳定错误、task-list identity 和 archive 契约；新增新协议测试，不删除旧测试。

验收：新测试覆盖协议不变量和主要竞态；现有测试仍可运行；`typecheck` 与完整单测通过。

### 阶段 2：实现 Store 与迁移

实现集中式 identity、目录外迁移锁、schema marker、canonical `tasks.json` 原子替换、principal 权限、revision、CRUD、依赖、owner、review 和 list 生命周期。

验收：并发、迁移、atomic replace 崩溃注入、权限伪造、通知失败和 completed 重启测试通过；任何读取只返回完整旧版或新版；`typecheck` 与完整单测通过。

### 阶段 3：替换工具、query 与 prompt/skill

注册职责分离的 `Task*` 工具，删除 create-plan preflight 和按旧工具名识别的策略；同步迁移 `src/**`、`skills/**` 和相关文档中的 prompt。

验收：query 集成测试证明 Task 只通过标准 tool loop 工作；单轮多工具仍保持 `tool_use/tool_result` 一一配对；`typecheck` 与完整单测通过。

### 阶段 4：重写 teammate、review、订阅与 UI

claim 只写 owner，以持久化 review 替代 submit；引入 main-process subscription service，并从 task snapshot 重建 UI。

验收：lead 验收前依赖不解锁；signal、watch、poll、5 秒折叠、重启恢复和四维展示测试通过；`typecheck` 与完整单测通过。

### 阶段 5：全量收口

按测试映射删除已经被新协议覆盖的旧契约测试，删除残余旧名称和 legacy reader 分支，执行真实模型验证。

验收：

- `rg "TaskGraph|submitted|claimInstanceId|_plan.json" src tests skills docs README.md README.en.md` 只剩 allowlist 中的迁移说明或非 Task 语义命中；
- `npm.cmd run typecheck` 通过；
- `npm.cmd test` 通过；
- 有 API key 时 `npm.cmd run test:integration:agent` 通过；
- `git diff --check` 通过；
- 手动确认 UI 完成态 5 秒后折叠、重启后仍能重新展开查询，并可显式 archive。

## 13. 核心决策总结

1. Task 是模型协议，不是 query loop 状态机。
2. 每个 task list 是单一 canonical JSON，通过一次 atomic replace 提交；revision 防止旧客户端覆盖新状态。
3. principal 由 runtime 注入，模型不能声明身份；routing、completionPolicy 和 systemMetadata 受权限保护。
4. status、owner、依赖、review 永远独立；所有 owner 和 review 变化使用专用命令。
5. review approved/changes_requested 终态和 requestId 持久保留，支持崩溃后的幂等重放。
6. 所有可恢复状态必须写入 TaskStore；mailbox 和 post-commit hook 都不是事实源。
7. 阻断提交的 validator 必须纯净、不可重入；观察型 hook 不可回滚事务。
8. completed 数据只能显式归档，不能由 UI timer 删除。
9. taskList identity 只解析一次，并随 runtime 上下文传播。
10. clean break 只针对产品兼容层；测试先建立新契约，再有映射地移除旧断言。
