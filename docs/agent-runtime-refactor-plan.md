# Agent Runtime 渐进式重构方案

> 状态：核心三项已实施；应用层 RunFactory 迁移保留为后续收敛  
> 对象：`src/main/agent/runtime/agent-runtime.ts` 及其直接依赖  
> 目标：将 `AgentRuntime` 收敛为领域中立的生命周期与状态推进内核  
> 原则：先定义目标契约，再渐进迁移；测试用于证明已选择的契约，不冻结偶然实现

## 1. 背景与边界

当前 `AgentRuntime.run()` 同时负责模型循环、工具协议、前后台执行、checkpoint、Inbox、Hook、UI 事件、TaskGraph 与 Presentation 终止策略。问题不只是方法过长，而是稳定机制、基础设施和 PPT 业务策略共享同一修改入口。

本轮目标：

- Runtime 只推进标准 Session transition；
- Session 成为可恢复状态的唯一写入边界；
- checkpoint、工具事务、输入源、事件投影和 Presentation 策略拥有独立边界；
- 保留现有 `AgentService`，由它负责应用用例和资源生命周期；
- 公开 `AgentRuntimeResult` 暂时保持兼容。

本轮不顺带重写模型消息协议、全部 Tool、Renderer 状态模型或 teammate runtime，也不以 `run()` 行数作为验收标准。

### 本次实施范围

本次针对审核中阻塞实施的三个问题组如下：

1. **状态与终态语义**：`AgentSession` 成为协议/生命周期状态写入边界；终态区分 candidate 与 sealed；取消分类先于普通失败映射；`CheckpointPolicy` 固定 transition 到恢复边界的映射。
2. **Checkpoint 并发正确性**：文件与 SQLite Store 均使用原子 lease、generation、精确 revision CAS、terminal fence 和条件 close；失败终态通过 lease inspection 对模糊 IO 结果做 read-after-write 对账。
3. **工具与后台边界**：Preflight、真实 Executor 和 Presentation Completion Policy 分离；前后台共享执行事实模型；后台采用“scheduled placeholder 持久化成功后再 launch”的两阶段协议；Inbox/权限输入与事件投影从工具主干移出。

已落地模块包括：

- `agent-session.ts`、`agent-transition.ts`、`checkpoint-policy.ts`；
- `checkpoint-coordinator.ts` 与 DurableRunStore/SQLite v2 writer metadata；
- `tool-preflight.ts`、`tool-execution-engine.ts`、`presentation-completion-policy.ts`；
- `background-task-manager.ts` 两阶段调度；
- `turn-input-assembler.ts`、`lead-inbox-input-source.ts`、`agent-event-ports.ts`。

`PresentationAgentRunFactory` 尚未从现有 `AgentService`/Runtime 准备代码中机械迁出。它不再阻塞上述三个正确性问题，但仍是后续把 Runtime 完全领域中立化的收敛任务；不得为了形式上的“完成”复制一层空编排服务。

## 2. 行为决策与测试处理

现有测试是当前行为证据。每项行为先分类，再决定测试如何处理：

| 当前行为 | 目标决策 | 测试处理 |
|---|---|---|
| assistant/tool_result 批次连续 | 必须兼容 | 保留并补恢复场景 |
| `tool_running` 表示“调用已领取，后续未知” | 机械阶段兼容 | 保留；v2 phase 细分另立改造 |
| 成功工具不因 Post Hook/映射失败被说成未执行 | 必须兼容 | 保留前后台等价测试 |
| 纯文本响应不单独保存 `model_committed` | 机械阶段兼容 | 保留；新增边界需单独决策 |
| 权限响应在 checkpoint 前发送 | 当前 at-least-once；暂时兼容 | 测稳定 ID 和消费端去重 |
| checkpoint 仅靠进程内 write tail | 已知并发缺陷 | 用 lease/CAS 新契约替换 |
| 新 run 可与旧 run 竞争同一 thread | 已知缺陷 | 新增 thread 互斥/显式 takeover 测试 |
| UI 文案由 Runtime 直接生成 | 架构偶然行为 | 用事件映射 golden test 替换实现断言 |

修改或删除旧测试时，必须说明旧契约为何失效以及由哪个新契约替代，不允许仅为让测试变绿而放松断言。

## 3. 状态所有权

| 状态/资源 | 存储位置 | 状态写入者 | 行为生产者 | 持久化 |
|---|---|---|---|---|
| model messages、tool queue/results、pending input | AgentSession.protocol | `AgentSession.apply()` | Driver/Input/Tool transition | 是 |
| phase、累计模型步数、terminal candidate/sealed | AgentSession.lifecycle | `AgentSession.apply()` | Runtime/Finalizer transition | 是 |
| 本次 invocation 已用模型步数 | AgentSession volatile state | `AgentSession.apply()` | model input transition | 否，恢复时归零 |
| discovery/skill/presentation policy state | Session extensions | `AgentSession.apply()` | 对应 Service/Policy | 按 mapper 保存 |
| 后台任务 | BackgroundTaskManager | BackgroundTaskCoordinator | Scheduler/Executor | snapshot |
| revision、generation、write tail、fence | CheckpointCoordinator | Coordinator | Coordinator | 前两者持久化 |
| taskStore、taskGraphOwner | PreparedRunResources | 对应应用服务 | ToolContext/Cleanup | 外部存储 |
| Presentation snapshot、选择态 | Presentation ToolContext | 不可变 | Presentation Tool | 不进入 Runtime checkpoint |

Session 保存可恢复事实，但不拥有领域行为。Driver、Executor、InputSource 和 Policy 只能返回 transition，不能直接修改 Session。

## 4. Prepared Run 与应用层

现有 `AgentService` 保持应用层入口：

```text
AgentService
  ├── PresentationAgentRunFactory
  ├── AgentRuntime
  └── AgentResultAdapter
```

`PresentationAgentRunFactory.prepare()` 返回：

```ts
type PreparationResult =
  | {type: "ready"; run: PreparedAgentRun; resources: PreparedRunResources}
  | {type: "short_circuit"; result: AgentRuntimeResult; resources: PreparedRunResources};
```

`runId` 在进入 Runtime 前必须生成，且每次 Runtime invocation 唯一。恢复旧 checkpoint 时另带 `resumeFromRunId`。RunFactory 对准备过程自身负责异常安全；一旦创建资源，任何准备失败都必须在内部释放。AgentService 的 finally 负责释放成功返回的 `PreparedRunResources`，且清理异常只能产生 warning，不能覆盖主结果或主错误。

Runtime 不直接解释当前 PPT 专用 `ToolContext`。最终使用泛型或不透明的 `ToolExecutionEnvironment` Port，由 Tool Executor 消费，Driver 只透传。

## 5. Transition 与终态生命周期

### 5.1 推进模型

`nextTransition()` 可以调用外部依赖，但不直接修改 Session：

```text
nextTransition(session.view())
  → AgentTransition
  → session.apply(transition)
  → CheckpointPolicy 决定是否持久化
```

模型 turn 是“输入封口至该响应的完整工具批次提交完毕”的聚合概念，不等于一次外层循环。

主要 transition：

- `user_prompt_accepted | user_prompt_stopped`
- `model_input_prepared`
- `model_response_received`
- `tool_claimed`
- `tool_processed`
- `background_state_changed`
- `run_completed | run_waiting_user | run_proposal_ready`
- `run_failed | run_cancelled`

UserPromptSubmit Hook 也必须返回 transition 并经过统一 apply/finalize，不得成为隐式 Session 写入者。

### 5.2 异常与取消

Tool Executor 吸收可预期工具失败；模型、InputSource、checkpoint、不变量、CompletionPolicy 和取消异常交给 Runtime 外层。

所有 catch 先执行取消分类：

```ts
if (cancellationClassifier.isCancellation(error, signal)) throw error;
return mapExpectedFailure(error);
```

因此工具、Hook 或映射响应 AbortSignal 时不会被误报成普通工具失败。

### 5.3 candidate 与 sealed terminal

终态先成为 candidate；只有终态 checkpoint 成功后才 sealed：

```text
terminal transition
  → apply candidate
  → commitTerminal
  → seal
  → Stop Hook（安全执行）
  → RuntimeCloser（安全清理）
```

正常 checkpoint 或成功终态 checkpoint 失败时，Runtime 外层把未 sealed candidate 覆盖为 `run_failed`，并调用专用 `commitFailureTerminal()`。失败 checkpoint 仍失败时保留主错误，只写 best-effort audit。

`RuntimeCloser`、`SessionFactory.close()`、checkpoint close 和资源 dispose 都必须逐项捕获异常；finally 中的清理错误不得覆盖成功结果、取消错误或主失败。

## 6. CheckpointPolicy 与恢复边界

| Transition | Durable phase | 保存策略 |
|---|---|---|
| `user_prompt_accepted` | 不变 | 不保存 |
| `user_prompt_stopped` | `finished` | terminal |
| `model_input_prepared` | `before_model` | 普通保存；同时递增累计和本次步数 |
| `model_response_received`，有工具 | `model_committed` | 普通保存 |
| `model_response_received`，纯文本 | 保持原 phase | 不立即保存 |
| `tool_claimed` | `tool_running` | 普通保存 |
| `tool_processed`，普通结果 | `tool_committed` | 下一 transition 前完成 |
| `tool_processed`，直接终态 | `finished` | 只保存 terminal |
| `background_state_changed` | 保持当前 phase | fence 前允许普通保存 |
| 运行终态 | `finished` | terminal |

version 1 的 `tool_running` 继续表示：工具调用已经领取，崩溃后无法判断查找、校验、Hook 或 execute 到达哪一步。机械迁移不得把保存点移动到 PreToolUse 或 execute 之后。

## 7. Lease、CAS 与失败终态

### 7.1 同 thread 运行互斥

generation 只能防止旧写入，不能阻止旧运行继续产生副作用。因此 AgentService 先提供进程内 thread mutex；Store 同时提供跨实例 lease：

- active lease 存在时，普通 `openLease` 返回 `lease_busy`；
- 只有显式 recovery/takeover，且旧 lease 已过期、已取消或匹配 expected runId 时，才能推进 generation；
- takeover 后旧 Runtime 必须被通知取消；在确认旧 Runtime 停止前，不执行新的有副作用工具；
- `closeLease` 使用 threadId + runId + generation 条件关闭，旧 lease 不能清除新 lease。

### 7.2 原子 open 与精确 CAS

Store 在同一事务或文件锁内读取 checkpoint、校验 active lease、分配 generation 并写 active writer。保存条件为：

```text
active generation/runId 匹配
stored revision == expectedRevision
nextRevision == expectedRevision + 1
```

相同 revision 与相同 payload hash 的重试返回 `already_applied`；不同 payload 返回 `revision_conflict`。snapshot、expectedRevision 和 nextRevision 在入队时冻结，但后续写入在前序失败后必须取消。

### 7.3 失败终态特殊通道

Coordinator 记录 `lastConfirmedRevision`。`commitFailureTerminal()` 允许从 `open`、`faulted` 或未 sealed 的 `terminal_fenced` 状态执行：

- 明确未写入：从 lastConfirmedRevision 提交 failed terminal；
- IO 结果不确定：按 generation/revision/hash read-after-write 对账；
- 已写入成功 candidate：用下一 revision 覆盖为 failed terminal；
- stale generation：不得再写，只返回 `stale` 并记录审计。

普通 terminal fence 会先禁止新普通 commit、等待已入队写入，再保存 terminal。后台 callback 在 fence 后只能得到 `rejected_after_terminal`。

阶段性兼容：机械抽取继续读写 v1；引入 lease/CAS 时升级为 v2，writer metadata 包含 runId、generation、revision。读取 v1 后恢复内部状态，第一次成功保存写为 v2 revision 1。

## 8. 工具预处理、调度与执行

工具管线分三层：

```ts
type ToolPreflightOutcome =
  | {type: "ready"; prepared: PreparedToolCall; mode: "foreground" | "background"}
  | {type: "immediate_result"; outcome: ToolExecutionOutcome}
  | {type: "denied"; modelResult: AgentModelToolResultBlock; reason: string}
  | {type: "hook_stopped"; reason: string};

type ToolDispatchOutcome =
  | {type: "foreground"; outcome: ToolExecutionOutcome}
  | {type: "background_scheduled"; taskId: string; placeholder: AgentModelToolResultBlock};

interface ToolExecutionOutcome {
  executionStatus: "not_started" | "threw" | "returned";
  sideEffects: "none" | "uncertain" | "committed_or_unknown";
  deliveryStatus: "delivered" | "validation_failed" | "postprocessing_failed";
  modelResult: AgentModelToolResultBlock;
  validatedResult?: unknown;
  warnings: ToolExecutionWarning[];
}
```

Executor 只描述事实，不返回 `AgentRuntimeResult`。Presentation Policy 解释 validated result，并决定普通 tool result、render feedback、AskUser 或 command proposal。

后台调度使用两阶段协议：先登记 `scheduled` task 并提交 placeholder/tool-committed checkpoint，确认成功后再启动真实执行并进入 `running`。后台完成只产生 notification，不能并发修改或终止 Session；重启恢复时 `scheduled` 可安全重排，`running` 则标记为副作用不确定。

## 9. 输入与事件

TurnInputAssembler 只在工具批次为空的合法用户轮次合并 pending content、后台 notification、普通 Inbox 与权限消息。

权限响应暂时保持 at-least-once：approval → send stable response ID → transcript/processed IDs → checkpoint → ack。崩溃可能重复发送相同 ID，消费端按 ID 去重；真正 exactly-once 需要独立 outbox/sendIfAbsent 改造。

事件使用带 namespace 的 envelope，但 UI、audit、context snapshot 和 stream 可保留不同 Port。迁移前建立 Renderer DTO golden test。订阅者必须隔离失败、保持同一 run 内顺序，并明确终态 flush；UI/audit 失败不得改变 Runtime 事实。

## 10. 五阶段实施与验收

### 阶段 1：契约、基线和状态迁移

- 落地本方案与测试决策矩阵；
- 补关键缺口测试；
- 引入 AgentSession，但不移动 checkpoint 与副作用边界。

验收：相关 Runtime 测试通过；Session 是持久化状态唯一写入口；`tool_running` 时机不变。

### 阶段 2：Transition 与 Checkpoint

- 引入 Runtime Driver 和 CheckpointPolicy；
- 机械抽取 v1 Coordinator；
- 再以独立提交实现 thread mutex、v2 lease/CAS、terminal override 和安全关闭。

验收：before/model/tool/terminal 恢复测试、取消测试、跨 generation 和并发 lease 测试通过。

### 阶段 3：工具、后台与输入

- 抽取 Preflight、Executor、Dispatcher；
- 前后台共享执行事实模型；
- 实现后台两阶段调度；
- 抽取 InputSource 与权限协调器。

验收：多工具批次、前后台 Hook/校验/映射等价、后台通知、权限重放和取消测试通过。

### 阶段 4：应用与领域边界

- 为 AgentService 注入 RunFactory；
- 统一 short circuit 与资源清理；
- 分离事件 Adapter/Projector；
- 抽取 Presentation Completion/Tool Policy。

验收：Runtime Driver 不导入 Presentation、UI 文案、MessageBus DTO 或具体工具名；现有 Renderer 行为由 golden test 证明。

### 阶段 5：收敛与完整验证

- 删除兼容分支与重复逻辑；
- 审查依赖方向和 checkpoint 版本迁移；
- 运行完整静态检查、单元测试和必要集成验证。

验收命令：

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run test:integration:agent # 有真实凭证且本次变更影响真实模型链路时
```

无法运行真实集成测试时，必须记录凭证/网络限制和具体手动验证步骤，不得用单元测试通过替代真实可用性结论。

## 11. 完成定义

- Runtime Driver 只依赖标准 transition、Session view 和 Ports；
- Session reducer 是可恢复状态的唯一写入者；
- checkpoint 存储实现变化不修改 Driver；
- 工具执行事实不包含 Presentation 终止结果；
- 后台线程不修改或终止 Session；
- 新增 UI 事件、Presentation 终止策略或工具输入规则不修改 Driver；
- 取消、恢复、副作用、Inbox 与终态顺序均有目标契约测试；
- typecheck、单元测试和适用的真实集成验证有实际结果记录。
