# Agent Runtime 薄层收敛方案

> 状态：核心实施完成（2026-07-23）；静态检查与单元测试通过，真实 Gateway 集成待凭证验证
>
> 范围：`src/main/agent/runtime/agent-runtime.ts`、直接协作者、应用装配入口与 Runtime 回归测试。
>
> 前置方案：[`agent-runtime-refactor-plan.md`](./agent-runtime-refactor-plan.md) 已完成 Session、checkpoint、工具执行、后台任务、输入源和事件端口的第一阶段拆分；本文只规划剩余的 `run()` 薄层收敛，不重做已落地模块。
>
> 原则：稳定的是执行协议与状态转换顺序，不是当前 1,000 余行方法的物理形态；先锁定行为，再移动职责。

## 1. 审核结论

将 `AgentRuntime.run()` 收敛为顶层生命周期薄层是合理方向，也符合现有架构演进。但实施时必须保留一个可完整阅读和测试的 `AgentLoopDriver`，不能把循环拆成相互回调的零散服务。目标不是追求行数，而是让 `run()` 只表达：打开运行域、准备、驱动循环、统一终态、释放资源。

当前代码已抽出 `AgentSession`、`CheckpointCoordinator`、`ToolPreflight`、`ToolExecutionEngine`、`PresentationCompletionPolicy`、`BackgroundTaskManager`、`LeadInboxInputSource` 和 `AgentEventPorts`，但 `run()` 仍负责以下不同层次的工作：

- 创建取消域、lease、Session、TaskStore、事件端口和后台任务，并决定资源释放；
- 构建 prompt、`ToolContext`、layout choice 短路和 TaskGraph worker；
- 恢复 checkpoint、兼容旧后台任务状态并拼接 continuation；
- 构造 checkpoint snapshot、应用 transition 和执行保存策略；
- 汇聚 Inbox、后台通知、pending tool results 并调用模型；
- 领取、预检、调度和解释前后台工具；
- 处理 step limit、成功/失败终态、Stop Hook 和清理告警。

因此，现状是“细节对象已经存在，但组合与控制流仍未分离”。继续抽象有明确收益，不过需要先解决以下边界问题。

### 1.1 生命周期所有权开始得过晚

`run()` 在进入覆盖全流程的 `try/finally` 之前已经注册 abort listener、打开 durable lease、恢复 session map、创建 TaskStore 和事件端口。若 lease 打开后的准备步骤抛错，统一关闭路径不会执行；若 lease 打开本身失败，abort listener 也不会移除。

结论：资源获取必须进入一个异常安全的 `AgentRunScope.open()`。`open()` 若中途失败，应自行回滚已创建资源；成功返回后由幂等 `close()` 统一释放。

### 1.2 准备阶段存在绕过统一终态的出口

`layoutChoice` 分支在 Session、`finish()` 和 Stop Hook 建立之前直接返回 message。它与正常文本结果走不同的 terminal/checkpoint 路径，后续继续增加准备期短路会扩大生命周期分叉。

结论：准备阶段只能返回 `ready | short_circuit` 数据，不得直接结束 `run()`；所有成功出口都交给同一个 finalizer。

### 1.3 Session 尚未成为唯一状态写入口

`queuedToolUses`、`pendingUserContent`、`modelMessages`、`transcript` 和 processed IDs 仍以可变引用暴露，并在 `run()`、Inbox、后台回调和事件适配器中直接修改。现有 transition 只覆盖部分状态变化。

结论：在搬移循环前先封闭写入。循环协作者返回 transition/outcome，由 `AgentSession.apply()` 或明确的 Session 命令更新可恢复状态；checkpoint snapshot 只能从 Session view 和受控 extension snapshot 生成。

### 1.4 循环决策与具体适配器耦合

模型调用、中文 UI 文案、Presentation 终止规则、TaskGraph discover 策略和后台展示文本都嵌在循环分支里。当前类还在每次运行中直接 `new` 多个协作者，使依赖边界难以替换和单测。

结论：Loop Driver 只处理队列优先级、模型/工具 turn 顺序、预算和 terminal outcome；领域策略及 I/O 由构造好的协作者提供。第一轮迁移使用具体类即可，只在外部 I/O 和策略替换点定义接口，避免为每个局部函数制造空抽象。

## 2. 必须保持的行为契约

本次重构默认不改变公开的 `AgentRuntimeOptions`、`AgentRuntimeResult`、`AgentService` 行为和 checkpoint version。下列顺序属于协议，必须由 characterization tests 锁定：

1. `before_model` checkpoint 在模型调用前提交；带工具的模型响应先完整保存 assistant batch，再开始领取工具。
2. `tool_running` 在解析、权限、PreToolUse 和 execute 之前提交，恢复时不得自动重放副作用不确定的工具。
3. 同一个 assistant tool batch 的全部 `tool_result` 必须位于紧随其后的同一个 user turn；Inbox 和后台通知不得拆断配对。
4. 后台工具先持久化 scheduled task 与 placeholder，确认成功后才 launch；后台完成不能并发终止 Session。
5. 成功终态遵循 candidate → terminal checkpoint → sealed → Stop Hook；失败/取消先分类，再提交 failure terminal，最后保留原始错误。
6. cleanup、Renderer、audit 和观测型 Hook 的失败不能覆盖已确定的主结果或主错误。
7. `requiredOutcome=command_proposal`、step limit、AskUser、SubmitCommands、纯文本和 layout choice 的现有可见结果保持兼容。

## 3. 目标结构

```text
AgentService
  └── AgentRuntime.run()                 # 薄 Facade：open → prepare → drive → finalize → close
        ├── AgentRunFactory              # 异常安全地创建 PreparedRun/RunScope
        ├── AgentLoopDriver              # 唯一稳定循环，推进 turn 与 transition
        │     ├── ModelTurnRunner         # 封口输入、checkpoint、模型调用、响应归一化
        │     └── ToolTurnRunner          # claim、preflight、前后台 dispatch、结果解释
        └── AgentRunFinalizer             # success/failure/cancel、terminal、Stop Hook

AgentRunScope                            # 拥有 abort、lease、checkpoint、Session、后台任务和 cleanup
PresentationAgentRunFactory             # 构建 prompt/ToolContext、TaskGraph、layout choice 准备结果
```

期望的顶层形态如下，具体命名可在实现时按现有目录约定调整：

```ts
async run(options: AgentRuntimeOptions): Promise<AgentRuntimeResult> {
  const scope = await this.runFactory.open(options); // open 自身异常安全
  try {
    const prepared = await scope.prepare();
    const outcome = prepared.type === "short_circuit"
      ? prepared.result
      : await this.loopDriver.run(prepared.run);
    return await this.finalizer.complete(scope, outcome);
  } catch (error) {
    await this.finalizer.fail(scope, error);
    throw error;
  } finally {
    await scope.close(); // 幂等、best effort、不覆盖主结果
  }
}
```

这段伪代码只定义所有权和顺序，不要求新增同名接口。实现时优先复用当前类，并避免出现同时拥有 Session 写权限的多个 coordinator。

## 4. 职责边界

| 组件 | 应负责 | 不应负责 |
|---|---|---|
| `AgentRuntime` | 稳定顶层生命周期、公开兼容入口 | prompt、工具分支、checkpoint 字段拼装、UI 文案 |
| `AgentRunFactory` / `AgentRunScope` | 资源创建、恢复、准备、异常回滚、幂等清理 | 模型/工具循环决策 |
| `AgentLoopDriver` | 队列优先级、turn 顺序、预算、terminal outcome | Presentation 结果解释、具体网关/Store 实现 |
| `ModelTurnRunner` | 输入封口、模型调用、响应去重与 transition | 修改工具执行状态、直接完成 Runtime |
| `ToolTurnRunner` | tool claim 到 tool processed 的完整事务 | 保存最终 terminal、直接修改 Presentation |
| `AgentRunFinalizer` | success/failure/cancel 终态与 Stop Hook | 重新解释模型或工具业务结果 |
| `AgentSession` | 可恢复协议状态的唯一写边界和 snapshot view | 外部 I/O、UI 投影 |

`ToolTurnRunner` 应保持为一个完整事务边界，不再按 parse、approval、hook、execute、presentation policy 各建一层 coordinator。`ModelTurnRunner` 也应返回显式联合类型，例如 `tool_batch | text | continue`，避免用回调跳转控制流。

## 5. 实施计划（五步）

每一步必须独立验证通过后再进入下一步；不得通过修改旧断言来迁就新结构。

### 步骤 1：锁定协议与架构边界

- 为 layout choice 短路、lease 打开后准备失败、abort listener 清理、纯文本/AskUser/SubmitCommands 终态补 characterization tests。
- 为 assistant/tool-result 批次、`tool_running` 保存点、后台两阶段 launch、取消优先分类补缺口测试。
- 增加轻量架构测试：`agent-runtime.ts` 不再直接导入具体 Presentation/TaskGraph/模型内容解析模块，且不允许新增直接 Session 集合写入。

验收：新增用例能在重构前证明现有契约或明确暴露上述生命周期缺口；现有测试断言不放松，相关 Runtime 测试全部通过。

### 步骤 2：建立异常安全的 RunScope 与准备边界

- 提取 `AgentRunScope`，统一拥有 abort forwarding、lease/checkpoint、Session、BackgroundTaskManager、TaskStore、事件端口和清理动作。
- 提取 `PresentationAgentRunFactory.prepare()`，负责 prompt、`ToolContext`、session 恢复兼容、TaskGraph 初始化和 `ready | short_circuit`。
- 让 layout choice 只返回 short-circuit outcome，并进入统一 finalizer；`open()` 中途失败必须回滚 listener 和已取得 lease。

验收：故障注入证明每个资源只关闭一次；准备期成功、短路、失败和取消均无 lease/listener 泄漏；模型循环和工具 checkpoint 时序不变。

### 步骤 3：封闭 Session，并提取单 turn 执行器

- 扩展 `AgentTransition` 覆盖恢复修正、pending input、Inbox 消费、render feedback 和后台 notification 等可恢复状态变化。
- 移除对 Session 内部数组/Set 的可变引用别名，提供只读 view、显式 take/append/apply 和统一 snapshot mapper。
- 提取 `ModelTurnRunner` 与 `ToolTurnRunner`，复用现有 Preflight、Executor、CompletionPolicy、InputSource 和 BackgroundTaskManager。

验收：除 `AgentSession` 外没有代码直接写入可恢复集合；两个 runner 的 outcome 联合类型覆盖全部分支；恢复、Inbox、前后台工具和 render feedback 测试通过。

### 步骤 4：落地稳定 Loop Driver 与统一 Finalizer

- `AgentLoopDriver` 保留单一可线性阅读的循环：提交待持久化状态 → 选择 queued tool 或 model turn → apply outcome → 判断 continue/terminal。
- `AgentRunFinalizer` 统一普通成功、AskUser、proposal、step limit、失败和取消；保持 candidate/checkpoint/seal/Hook 顺序。
- 将 UI/audit 文案映射移入事件 adapter；Driver 只发语义事件，不拼接展示文本。

验收：`AgentRuntime.run()` 只剩顶层生命周期；Driver 不导入 Presentation DTO、TaskGraph 工具、具体 Tool 名或 Renderer 文案；所有 terminal path 的 checkpoint 与 Stop Hook 各至多一次。

### 步骤 5：装配、收口与完整验证

- 在 composition root 创建默认协作者，保持现有 `new AgentRuntime(registry, gateway, skillRegistry, database)` 调用兼容，待测试迁移后再考虑显式依赖对象。
- 删除已迁出的局部闭包、重复状态别名和兼容桥，不顺带修改 Gateway 协议、Tool schema 或 Renderer 状态模型。
- 复核 diff、依赖方向和文档状态，执行完整验证。

验收命令：

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run test:integration:agent
git diff --check
```

`test:integration:agent` 只覆盖真实 Gateway，不覆盖完整 Runtime 生命周期。若缺少 API Key 或网络，还需手动验证：纯文本问答、AskUser 后继续、SubmitCommands 提案、layout choice 短路、后台工具完成后再 finish、运行中取消、`tool_running` checkpoint 恢复。无法执行的真实验证必须在实施总结中明确列出。

## 6. 非目标

- 不为减少行数而改写 checkpoint version、消息 ContentBlock 协议或 Tool schema。
- 不把 `AgentService`、CommitGate 或真实 Presentation mutation 合并进 Runtime。
- 不同时重构 teammate runtime、Gateway recovery、Renderer store 或全部 Hook 系统。
- 不引入通用工作流框架、依赖注入容器或“一类一个函数”的包装层。
- 不以 mock 单测通过替代 lease、恢复、后台副作用和真实模型链路验证。

## 7. 完成定义

- `AgentRuntime.run()` 只表达 open、prepare、drive、finalize、close 五个顶层动作；
- 一个 `AgentLoopDriver` 集中表达稳定循环，不存在跨 service 的隐式控制流；
- `AgentSession` 是可恢复状态唯一写入口，checkpoint snapshot 不读取散落的可变别名；
- 所有准备期短路与正常循环出口共享 finalizer；
- 任意资源获取阶段失败都不会泄漏 abort listener、lease、后台回调或 TaskGraph ownership；
- 新增 Presentation 策略、事件展示文案或输入源不需要修改 Driver；
- typecheck、全量单测、适用的真实集成测试和手动生命周期验证均有实际结果记录。

## 8. 实施记录（2026-07-23）

- `AgentRuntime.run()` 已收敛为 open → prepare → drive → finalize → close 顶层生命周期；默认构造签名保持兼容。
- 新增异常安全、幂等关闭的 `AgentRunScope`，统一取消转发、lease/checkpoint、Session、后台任务、TaskStore、事件端口和清理。
- 新增 `PresentationAgentRunFactory`、`PreparedAgentRun`、`ModelTurnRunner`、`ToolTurnRunner`、`AgentLoopDriver` 与 `AgentRunFinalizer`；稳定 Driver 不导入 Presentation、TaskGraph、具体 Tool 名或展示文案。
- `AgentSession` 的可恢复数组与 Set 已改为只读 view，通过显式命令或 transition 更新；Inbox、事件审计和 user turn 组装不再直接写集合。
- layout choice 短路已进入统一 terminal checkpoint 与 Stop Hook；lease busy、准备失败、abort listener 回收增加了故障注入测试。
- 验证结果：`npm.cmd run typecheck` 通过；`npm.cmd test` 为 115 个测试文件、672 个用例全部通过；`git diff --check` 通过。
- 未执行 `npm.cmd run test:integration:agent`：当前环境未配置 `OPENAI_API_KEY` 或 `ANTHROPIC_API_KEY`。真实验证仍需按第 5 节列出的纯文本、AskUser、SubmitCommands、layout choice、后台完成、取消与 checkpoint 恢复路径手动执行。
