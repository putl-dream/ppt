# Teammate Runtime 第二阶段重构方案

> 状态：已完成（2026-07-22）
>
> 范围：`src/main/agent/teammate/spawn-teammate.ts`、直接相关的 task/runtime helper 与回归测试。
>
> 原则：保留 Active Inbox、消息时序、工具批处理和现有 `StopBlock` 公共契约；先锁定行为，再移动边界。

## 1. 核心行为契约

一个 turn 定义为“一次模型调用 + 该响应要求的完整 tool batch”。每个 turn 完成后必须回到顶层生命周期循环，并在下一次模型调用前消费 inbox。

- assigned 状态收到 routed messages 时视为 continuation：保留 activity 和 activity-bound task，追加 conversation，并按现有行为把 step count 重置为 `0`。
- idle 状态收到 routed messages 时创建新 assignment 和 activity。
- 合法 shutdown 优先于同批普通消息；tool batch 内不新增抢占点。
- Idle scheduler 不消费 inbox，只负责 idle timing、sleep、timeout 和 task claim。
- `AssignmentTurnRunner.advance()` 每次最多推进一个完整 turn，不采用 run-to-completion。

Router 返回的是 `routedMessages`，其中可以包含 lead/teammate 普通消息和已经成功匹配的协议响应；不得只保留 lead 消息。

## 2. 状态与任务所有权

`TeammateRuntime.phase` 是运行中生命周期的唯一真相源：

```ts
type TeammatePhase =
  | { kind: "idle"; since: number; nextPollAt: number }
  | { kind: "assigned"; assignment: AssignmentContext; activityId: string; modelSteps: number }
  | { kind: "stopping"; exit: NonFailureExit }
  | { kind: "failed"; exit: FailedExit };
```

外部 `state.status` 由 transition 同步。进入 internal `stopping` 时不能提前公开为 `stopped`；terminal finalization 完成后才提交 `stopped`，避免同名 teammate 在旧实例仍清理时被重新 spawn。现有 `spawn()` 外层 catch/finally 不再决定正常生命周期状态，只保留 pre-runtime 失败兜底、失败通知和最终持久化编排。

assignment 中的 `activityTaskId` 只表示 activity 展示关联，不表示全部任务所有权。`TaskStore` 是 ownership 的唯一真相源；assignment completion 必须查询该 teammate 名下所有 `in_progress` tasks。只要仍有 owned in-progress task，就生成列出全部任务的 submit guidance，且不重置 step count、不进入 idle。

## 3. Assignment 与 terminal finalization

任务释放只允许通过两个明确边界：

- `AssignmentFinalizer`：teammate 继续存活时完成 assignment、处理 step limit 并及时释放 owned tasks。
- `TerminalFinalizer`：shutdown、abort、hook-stop、failure、idle timeout 时执行 best-effort 终态处理。

Terminal finalizer 将动作拆开，而不是让 disposer 发送消息：

1. 按 exit 结束残留 activity；
2. 按兼容时序释放 owned tasks；
3. 发送 lifecycle/result/shutdown response；
4. 汇总前置清理错误并计算最终有效 exit；
5. 根据最终有效 exit 触发一次 Stop Hook；
6. 最后才向外公开 `stopped`，失败则公开 `failed`；
7. 由 `spawn()` 外层 finally 持久化最终状态。

现有消息语义保持：

| Exit | Activity | Lead notification | Stop reason |
|---|---|---|---|
| idle timeout | none | lifecycle summary | completed |
| shutdown | interrupted | lifecycle summary + shutdown response | completed |
| hook stop | completed | completion result | completed |
| aborted | interrupted | 不新增结果消息 | aborted |
| failed | failed | 保留外层 error notification | aborted |

`StopBlock.reason` 继续使用 `completed | step_limit | aborted`，不扩大公共类型。assignment step limit 后 teammate 回到 idle，因此不形成 terminal exit。

终态处理的每一步独立捕获错误。原始执行错误优先于 cleanup error；Stop Hook 之前出现的 cleanup error 会形成明确的 effective failed exit，避免 Hook 报 completed 而最终状态为 failed。Stop Hook 自身失败只能作为 cleanup error 上报，不能追溯改变已发送的 Hook 输入。

## 4. Abort 语义

`TeammateManager` 提供可测试的 `abortTeammate()`：名称必须 sanitize，对 stopped/failed 实例返回 false，并通过 controller signal 中断运行。

只有 signal 已 aborted，且错误是 signal reason、`AbortError` 或内部 `TeammateCancellationError` 时才归为取消；不得依靠错误消息匹配，也不得把未伴随 signal 的任意 `AbortError` 静默吞掉。abort 进入 stopping/aborted，不进入 failed。

## 5. 实施与验收（四步）

1. **锁定行为**：增加 Active Inbox、step count、activity、手动 claim、terminal notification/Hook 和 abort characterization tests。验收：测试准确复现旧行为或暴露已确认缺口，不修改旧断言。
2. **提取调度与单 turn 边界**：实现 routed inbox router、纯 idle scheduler 和 `AssignmentTurnRunner.advance()`。验收：每个 turn 后重新 drain inbox，tool batch 粒度和消息格式不变。
3. **引入 runtime transitions 与两级 finalizer**：统一 phase/status、全部 owned task completion、abort 和 effective exit。验收：任务、activity、lead 消息、Stop Hook 与最终状态在全部 terminal path 上一致且至多执行一次。
4. **收口并回归**：封闭 conversation 写入，移除旧 mutable run 字段和直接状态赋值。验收：`npm.cmd run typecheck`、`npm.cmd test`、`git diff --check` 全部通过。

## 6. 实施结果

- `TeammateRuntime.phase` 已替代松散的 `TeammateRunState` 字段组合；activity finished 具备幂等保护。
- inbox routing、idle polling 和单 turn model/tool 推进已形成独立边界；Active Inbox 安全点保持不变。
- conversation 写入已封闭，入口不再直接修改 transcript/model message 数组。
- assignment completion 改为查询 TaskStore 中全部 owned `in_progress` tasks，手动 `claim_task` 无法绕过 submit。
- assignment 与 terminal finalization 已分离；cleanup failure 会在 Stop Hook 前形成 failed effective exit。
- 新增公开 `abortTeammate()`，abort、hook-stop、shutdown、idle timeout 和 failure 均使用显式 exit。
- 严格类型检查与全量 631 个单元测试通过。

## 7. 必须覆盖的回归场景

- active continuation 在下一 turn 可见，保持 activity/task，仅重置 lead continuation 的 step count；
- 同批 shutdown 优先，普通消息不进入下一模型调用；
- tool batch 完成后才处理 shutdown；
- 普通 assignment 手动 `claim_task` 后，未 submit 的 owned task 阻止进入 idle；
- step limit 及时释放 owned tasks，但 teammate 继续处于 idle；
- idle timeout 和 hook stop 保留现有 lead 消息；
- shutdown、abort、model failure、tool infrastructure failure 和 cleanup failure 均释放任务；
- assignment-finished 与 Stop Hook 各至多一次；
- cleanup failure 不覆盖原始执行错误，也不造成 Hook result 与最终状态矛盾；
- public `stopped` 只在 terminal finalization 完成后可见。
