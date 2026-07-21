# Teammate Runtime 渐进式重构计划

> 状态：已完成（2026-07-21）  
> 范围：`src/main/agent/teammate/spawn-teammate.ts` 中的 `runTeammate` 及其直接辅助逻辑。  
> 原则：保持现有协议、状态、时序和对外消息行为，不引入新的事件框架或依赖。

## 1. 背景

`runTeammate` 当前同时承担 teammate 调度、assignment 生命周期、模型 turn、工具执行、进度上报和清理。主要问题不是方法行数，而是三个不同生命周期被压在同一个循环中：

```text
teammate 生命周期
  └─ assignment 生命周期
      └─ model / tool turn 生命周期
```

此外，assignment 状态由 `hasActiveAssignment`、`currentTaskId`、activity、idle timer 和 `modelSteps` 等松散变量共同表达；`transcript` 与 `modelMessages` 需要在多个分支双写；工具循环内部混合参数校验、计划审批、Hook、权限、执行、进度和错误归一化。

## 2. 已确认的边界

- `TeammateState` 由 `spawn()` 创建；`runTeammate` 只驱动并修改它。
- `ProtocolStateStore` 由 `TeammateManager` 持有；`runTeammate` 只 hydrate、查询和 flush。
- teammate 的运行状态是 `running / idle / stopped / failed`；`stopped` 由 `spawn()` 外层收口。
- `interrupted` 在运行循环内主要是 assignment progress outcome；冷启动持久化恢复另有 `reconcileInterrupted()`。
- shutdown 是协议事件和退出原因，不额外引入同名状态。
- task release 保留“业务分支及时释放 + finally 幂等兜底”的现有语义。

## 3. 目标与非目标

### 目标

- `runTeammate` 主要表达生命周期编排，不再包含单个工具调用细节。
- assignment 的开始、完成、进入 idle 等字段更新通过集中操作完成。
- transcript 和模型消息通过原子 helper 同步写入。
- 工具批处理返回显式 outcome，深层逻辑不直接决定顶层控制流。
- 保持 shutdown、idle timeout、step limit、plan approval、Hook stop 和 abort 的现有可观察行为。

### 非目标

- 不一次性拆成多个 class 或八个独立组件。
- 不引入通用 event bus、`nextEvent()` 框架或新的并发模型。
- 不改变 teammate 状态枚举、消息协议、工具权限或任务提交规则。
- 不借重构修改现有测试期望。

## 4. 目标结构

首轮只形成四个边界：

```text
runTeammate                 顶层生命周期编排
├─ assignment transitions  集中维护 assignment / idle 字段
├─ conversation helpers    原子维护 transcript / modelMessages
├─ poll/claim flow          保留 inbox、idle 和任务认领时序
└─ executeToolBatch         工具校验、审批、Hook、执行和结果归一化
```

暂不把 waiting for model、executing tools、claiming task 等瞬时执行阶段提升为 teammate 顶层状态，避免状态转换数量膨胀。progress 仍由运行层发布结构化事件，展示文案格式化则收口在工具执行辅助逻辑中。

## 5. 实施步骤与验收

### 步骤 1：集中 assignment 状态迁移

- 用一个运行期 assignment state 对象承载当前 assignment、task、activity、step 和 idle timer。
- 提取开始 assignment、完成 activity、进入 idle 等集中操作。
- 保持分支中的 task release 时机不变。

验收：`teammate-message-bus`、`teammate-progress`、`task-graph` 测试通过。

### 步骤 2：封装 conversation 写入

- 提供 append user、assistant 和 tool results 的原子 helper。
- 保留 transcript 与 model messages 的现有格式、顺序和 compaction identity 行为。

验收：相关 teammate 测试通过，模型调用测试中的消息配对行为不变。

### 步骤 3：提取工具批处理

- 将 `for (const call of calls)` 提取为独立函数。
- 通过显式 `continue / stop` outcome 告知顶层是否结束 teammate。
- 保留 plan approval、Pre/Post Hook、permission、progress 和错误转换顺序。

验收：`teammate-message-bus`、`agent-hooks-permission`、`tool-result-pairing` 测试通过。

### 步骤 4：收敛入口并回归

- 清理 `runTeammate` 中已经下沉的局部实现细节。
- 复核所有 `continue / break / return / throw / abort / finally` 路径。
- 不继续扩张抽象，只有出现明确重复边界时才新增 helper。

验收：`npm.cmd run typecheck`、`npm.cmd test` 和 `git diff --check` 全部通过。

## 6. 行为保持清单

- inbox 协议响应必须先路由并持久化，再处理普通 assignment 消息。
- 合法 shutdown 必须先释放名下任务、结束 activity、发送生命周期摘要及 response。
- idle 时优先处理 inbox；没有消息才按原间隔扫描任务板。
- 单个 assignment 达到 step limit 后释放任务并进入 idle，不终止 teammate。
- task board assignment 未显式 `submit_task` 时，final response 继续被转成 guidance。
- tool call 顺序执行，且每个 `tool_use` 都生成配对的 `tool_result`。
- plan approval pending/rejected 时继续作为可恢复 tool error 返回模型。
- Hook stop 仍结束当前 assignment 和 teammate；tool denial 仍允许模型继续。
- 所有退出路径最终释放任务并触发 `Stop` Hook。

## 7. 风险控制

- 每一步完成后先跑相关测试，通过后才进入下一步。
- 不把 task release 全部推迟到 disposer，避免改变任务可见时序。
- 不把 progress 事件完全移出运行层，避免破坏 activity/task 关联。
- 不在本轮重新定义 pending plan approval 与 assignment completion 的产品语义。
- 如果抽取需要扩大到协议、TaskStore 或 Hook 公共类型，暂停并另行评审范围。

## 8. 实施结果

- assignment、activity、step 与 idle timer 已收口到 `TeammateRunState`。
- assignment 激活和进入 idle 的重复字段更新已集中处理。
- transcript 与 model messages 的 user、assistant、tool result 写入已通过 conversation helper 收口。
- idle 计时、轮询和任务认领已提取为 `pollForTeammateTask()`，通过显式 outcome 返回结果。
- 工具批处理已提取为 `executeTeammateToolBatch()`，通过 `continue / stop` outcome 影响顶层生命周期。
- 协议路由、任务释放时机、Hook 顺序和对外消息格式保持不变。
