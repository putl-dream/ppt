# Agent Query 生命周期与会话状态重构计划

> 状态：核心实施完成（2026-07-23）；类型检查与单元测试已通过，真实 Gateway 集成验证待凭证
>
> 范围：主 Agent 的会话历史、`AgentRuntimeOptions` 组装、Query loop、工具批次、checkpoint 与恢复语义。
>
> 主要对象：
>
> - `src/main/agent/service.ts`
> - `src/main/agent/runtime/agent-runtime.ts`
> - `src/main/agent/runtime/presentation-agent-run-factory.ts`
> - `src/main/agent/runtime/agent-loop-driver.ts`
> - `src/main/agent/runtime/turns/*`
> - `src/main/agent/runtime/lifecycle/*`
> - `src/main/agent/persistence/*`
> - `src/main/session-store.ts`
>
> 前置方案：
>
> - [`agent-runtime-refactor-plan.md`](./agent-runtime-refactor-plan.md) 已落地 Session、checkpoint、工具执行与事件端口的第一阶段拆分。
> - [`agent-runtime-thin-layer-refactor-plan.md`](./agent-runtime-thin-layer-refactor-plan.md) 已将 `AgentRuntime.run()` 收敛为 open → prepare → drive → finalize → close 的薄 facade。
>
> 本文不推翻上述成果，而是修正下一层状态边界：当前 `AgentSession` 和 durable checkpoint 仍同时承担 Conversation History、Query State 与单圈工具工作区，导致正常跨用户轮、暂停恢复与崩溃恢复共享同一条 `resumeThread` 路径。

## 1. 审核结论

目标生命周期应固定为：

```text
Session / Thread Identity
  → Conversation History
  → AgentRuntimeOptions
  → QueryParams
  → Initial Query State
  → while:
       State snapshot
       + Iteration Workspace
       + Model Attempt buffer
       → Terminal
       或完整工具批次结束后 state = next
```

各层不能互相替代：

1. `sessionId`、`threadId`、`runId` 负责身份和存储定位，不进入模型 loop 状态。
2. Conversation History 跨用户请求保存完整 `AgentModelMessage[]`。
3. `AgentRuntimeOptions` 是应用层原始输入。
4. `QueryParams` 是本次用户请求的一次性组装结果，进入 query 后保持稳定。
5. Query State 是同一次 query 多圈之间的已提交工作区。
6. Iteration Workspace 只保存当前一圈尚未提交的 assistant/tool 增量。
7. Model Attempt buffer 只保存当前 provider 尝试；fallback 或可恢复重试可以整体撤销。

核心改造不是把 `AgentRuntimeOptions` 改名为 `QueryParams`，也不是把当前 `AgentSession` 字段搬进一个新接口，而是建立明确的组装、提交和恢复边界。

## 2. 参考实现确认的语义

本方案参考 `E:\Coding\claude-code\src\query.ts`、`QueryEngine.ts` 与 conversation recovery 实现，采用以下已确认语义。

### 2.1 QueryParams 只组装一次用户请求

上层在每次用户提交时构造：

```ts
query({
  messages,
  systemPrompt,
  userContext,
  systemContext,
  canUseTool,
  toolUseContext,
  fallbackModel,
  querySource,
  maxTurns,
  taskBudget,
});
```

其中 `messages` 已包含 Conversation History 与本次用户输入。`request`、`messageHistory` 和 transcript 不再作为三份平行的模型上下文事实源。

### 2.2 QueryParams 在 while 前转为 State

Query loop 进入 `while (true)` 前创建一次 State：

```ts
let state = createInitialQueryState(params);
```

只有部分 QueryParams 字段进入 State：

- `messages`
- `toolUseContext`
- `maxOutputTokensOverride`

以下稳定策略继续从 QueryParams 读取：

- `systemPrompt`
- `userContext`
- `systemContext`
- `canUseTool`
- `fallbackModel`
- `querySource`
- `maxTurns`
- `skipCacheWrite`
- `taskBudget`
- `deps`

### 2.3 每圈先读取 State 快照

一圈开始时读取 State，随后只在局部变量中工作：

```ts
let { toolUseContext } = state;
const {
  messages,
  turnCount,
  transition,
  maxOutputTokensOverride,
  // ...
} = state;
```

`state.messages` 不在流式接收或单个工具完成时原地追加。

### 2.4 当前圈使用独立的局部暂存区

每圈新建：

```ts
let messagesForQuery = preprocess(messages);
const assistantMessages = [];
const toolUseBlocks = [];
const toolResults = [];
let needsFollowUp = false;
```

完整 assistant message 和 tool result 有两条通路：

```text
yield / event → 外层 Conversation History
局部数组       → 本圈结束时构造 next State
```

provider fallback 时可以 tombstone 已发出的失败 attempt 消息，并清空本地数组，不污染已提交 State。

### 2.5 State 只在需要下一圈时更新

无工具的最终回复直接返回 completed。最后一条 assistant message 已由外层 History 消费，不需要在 terminal 前再次写入 State。

有工具时，必须等待同一 assistant response 的完整工具批次结束，再执行：

```ts
const next: QueryState = {
  ...,
  messages: messagesForQuery.concat(assistantMessages, toolResults),
  turnCount: state.turnCount + 1,
  transition: { reason: "next_turn" },
};
state = next;
```

上下文压缩、输出截断恢复和阻塞型 Hook 也必须构造完整 `next`，而不是零散修改旧 State。

### 2.6 Resume 恢复 History，不恢复旧 JavaScript State

正常 continue/resume 的主路径是：

```text
持久化消息链
  → 重建有效分支
  → 清理 unresolved tool_use、孤立 thinking、空 assistant
  → 必要时注入 synthetic continuation
  → initialMessages
  → 新 QueryParams
  → 新 State
```

中断续跑仍通过一次新的 query 完成。旧 loop State 不跨进程反序列化。

本项目需要比参考实现更强的工具副作用 checkpoint，但应把它表示为 committed State 之外的 inflight facts，而不是让未完成工具批次提前进入下一圈 State。

## 3. 当前实现的问题

### 3.1 State 创建早于 QueryParams 组装

当前顺序：

```text
AgentRunScope.open(options)
  → 创建 AgentSession、modelMessages、tool queue
PresentationAgentRunFactory.prepare(scope)
  → 构建 systemPrompt、ToolContext、tool schemas
AgentLoopDriver.run(prepared)
```

即先创建工作区，再完成 query 参数组装。目标应为：

```text
open resources / load raw recovery data
  → assemble QueryParams
  → create or restore Query State
  → enter loop
```

### 3.2 `AgentSession` 同时承担三种生命周期

当前 `AgentSession` 同时保存：

- 跨用户请求需要的 canonical `modelMessages`
- query 多圈状态
- 单个 assistant tool batch 的队列和逐个工具结果
- transcript、terminal 和 lifecycle phase

因此一次模型响应会立即 push assistant message，一次工具完成会立即写 pending result。当前没有“State 保持不变，局部 batch 完成后生成 next”的提交点。

### 3.3 Driver 的一圈不是 agentic turn

当前 Driver 每圈只执行以下二者之一：

```text
一次模型调用
或
一个 queued tool
```

目标 query loop 的一圈应为：

```text
一次模型调用
  → 完整 assistant response
  → 完整 tool batch
  → next State
```

这也是当前混合 AskUser/普通工具批次、tool result 配对和 step/turn 语义容易出错的根源。

### 3.4 `resumeThread` 混合两种恢复

当前 `continueAgentRun()` 对正常下一次用户请求也传递 `resumeThread: true`。Runtime 随后从旧 checkpoint 恢复：

- `modelMessages`
- `queuedToolUses`
- `pendingToolResults`
- `phase`
- `renderFeedbackUsed`
- `activeToolUse`
- background task 状态

这混合了：

1. continue conversation：旧 History + 新用户消息 → 新 Query。
2. resume query：同一 query 在 waiting_user/interrupted/inflight 边界继续。

### 3.5 缺少独立的 canonical Conversation History

`DurableServiceThread.messages` 只保存 `{ role, content: string }`，不包含：

- `tool_use`
- `tool_result`
- thinking/signature
- image block
- compact boundary
- provider 配对结构

完整 `AgentModelMessage[]` 只存在于 Runtime checkpoint。旧 checkpoint 因而被迫同时充当 thread history。

### 3.6 Context 预处理存在双事实源

当前模型调用同时构造：

- `promptPayload.request`
- `promptPayload.conversation`
- `promptPayload.transcript`
- canonical `messages`

provider 在 `messages` 存在时优先使用 canonical messages，但部分压缩逻辑只改写 payload/transcript。目标实现必须让 `prepareMessages()` 直接返回最终发送给 provider 的 `AgentModelMessage[]`。

### 3.7 流式 attempt 缺少撤销/提交语义

当前 text delta 直接追加到 Renderer。输出截断、fallback 或其他可恢复重试发生时，失败 attempt 的文本可能已经展示，而 Session 最终只记录成功 attempt。

目标事件协议至少需要：

- `attemptId`
- delta
- commit
- reset/tombstone
- 完整 message committed

## 4. 目标身份与生命周期

### 4.1 ID 定义

```ts
type SessionId = string; // PPT 项目/UI 会话
type ThreadId = string;  // Agent Conversation History
type RunId = string;     // 一次 IPC 执行、stream、trace、取消
type QueryId = string;   // 可选：一个逻辑 query 跨 waiting_user 暂停时稳定
```

短期可以保持首轮 `threadId === runId` 的兼容行为，但内部类型和命名必须区分，禁止依赖二者相等。

### 4.2 正常下一轮

```text
load Thread History
  → append current user input
  → assemble QueryParams
  → createInitialState(params)
  → query loop
```

不得读取上一轮 completed Query State。

### 4.3 Query 暂停

AskUser 等需要跨 IPC 等待的工具不视为 completed conversation turn，而是：

```text
Query suspended
  → 保存 committed State + suspended Iteration Workspace
  → 用户回答
  → 恢复同一 workspace
  → 完成工具批次
  → 构造 next State
```

AskUser 第一阶段应要求是 batch 中唯一的终止型工具；在支持完整 suspended batch 前，混合 batch 应生成成组错误结果并要求模型重新调用。

### 4.4 崩溃/中断恢复

恢复输入分为：

```ts
type QueryStartMode =
  | { type: "new_query" }
  | {
      type: "resume_query";
      reason: "waiting_user" | "interrupted" | "crash_recovery";
    };
```

禁止继续使用含义不明确的 `resumeThread: boolean` 作为最终接口。

## 5. 目标类型

类型名称可以在实现时调整，但职责不可重新混合。

### 5.1 应用入口

```ts
interface AgentRuntimeOptions {
  threadId: ThreadId;
  runId: RunId;
  startMode: QueryStartMode;

  request: string;
  presentationSnapshot: Presentation;
  currentSlideId?: string;
  selectedElementIds: string[];

  model?: AgentModelSelection;
  executionStrategy?: AgentExecutionStrategy;
  requiredOutcome?: "any" | "command_proposal";
  layoutChoice?: LayoutChoice;

  workspaceRoot?: string;
  runtimeRoot?: string;
  signal?: AbortSignal;

  onProgress?: AgentProgressHandler;
  onStreamEvent?: AgentStreamEventHandler;
  requestToolApproval?: ToolApprovalHandler;

  messageBus?: MessageBus;
  teammateManager?: TeammateManager;
}
```

兼容迁移期可以保留旧字段，但旧字段只能在 assembler 外层读取，turn runner 不得访问 `scope.options`。

### 5.2 QueryParams

```ts
interface AgentQueryParams {
  messages: readonly AgentModelMessage[];
  systemPrompt: SystemPrompt;

  userContext: Readonly<Record<string, string>>;
  systemContext: Readonly<Record<string, string>>;

  canUseTool: CanUseToolFn;
  toolUseContext: ToolUseContext;

  model?: AgentModelSelection;
  fallbackModel?: AgentModelSelection;
  querySource: AgentQuerySource;

  maxOutputTokensOverride?: number;
  maxTurns?: number;
  skipCacheWrite?: boolean;
  taskBudget?: { total: number };

  deps: AgentQueryDeps;
}
```

未实现真实行为前不为空对齐参考接口而添加 `skipCacheWrite` 或 `taskBudget`；它们是预留的能力位置，不是本轮强制范围。

### 5.3 Query State

```ts
interface AgentQueryState {
  messages: AgentModelMessage[];
  toolUseContext: ToolUseContext;

  turnCount: number;
  transition?: AgentQueryContinue;

  maxOutputTokensOverride?: number;
  maxOutputTokensRecoveryCount: number;
  hasAttemptedReactiveCompact: boolean;

  renderFeedbackUsed: boolean;
  validationFailuresByTool: ReadonlyMap<string, number>;
}
```

累计 usage、budget tracking 若跨圈影响决策，也属于 State。参考实现中个别变量因迁移成本保留为 loop-local，不应据此制造第二套隐式状态。

### 5.4 Iteration Workspace

```ts
interface AgentIterationWorkspace {
  messagesForQuery: AgentModelMessage[];

  assistantMessages: AgentModelMessage[];
  toolUseBlocks: AgentModelToolUseBlock[];
  toolResults: AgentModelToolResultBlock[];

  needsFollowUp: boolean;
  updatedToolUseContext: ToolUseContext;
}
```

这些字段在每圈开始时创建，在正常 batch 完成后一次性归并到 next State。

### 5.5 Checkpoint

```ts
interface AgentQueryCheckpoint {
  version: 2;
  threadId: ThreadId;
  queryId: QueryId;
  lastRunId: RunId;

  committedState: AgentQueryState;

  inflight?: {
    phase:
      | "model_streaming"
      | "model_received"
      | "tool_running"
      | "waiting_user";
    workspace: AgentIterationWorkspaceSnapshot;
    activeToolUse?: AgentModelToolUseBlock;
  };
}
```

`tool_running` 仍必须在真实执行前持久化。恢复时不得盲目重放副作用不确定的工具。

## 6. 目标执行结构

```ts
async run(options: AgentRuntimeOptions): Promise<AgentRuntimeResult> {
  const scope = await this.runFactory.open(options);
  try {
    const prepared = await this.runFactory.prepareQuery(scope, options);
    const terminal = await this.loopDriver.run(prepared);
    return await this.finalizer.complete(scope, terminal);
  } catch (error) {
    await this.finalizer.fail(scope, error);
    throw error;
  } finally {
    await scope.close();
  }
}
```

```ts
async run(prepared: PreparedAgentQuery): Promise<AgentQueryTerminal> {
  const { params, host } = prepared;
  let state = prepared.initialState;

  while (true) {
    const workspace = await this.prepareIteration(params, state);
    const modelOutcome = await this.modelTurns.run(params, state, workspace);

    if (modelOutcome.type === "terminal") {
      return modelOutcome.terminal;
    }

    const toolOutcome = await this.toolTurns.runBatch(
      params,
      state,
      workspace,
    );
    if (toolOutcome.type === "suspended") {
      await host.checkpointSuspended(state, workspace, toolOutcome);
      return toolOutcome.terminal;
    }
    if (toolOutcome.type === "terminal") {
      return toolOutcome.terminal;
    }

    const next = reduceQueryState(state, workspace);
    await host.commitNextState(next);
    state = next;
  }
}
```

Driver 不读取：

- `AgentRuntimeOptions`
- Presentation snapshot
- Renderer callback
- Durable store
- 具体 Tool 名

这些能力通过已组装的 params、deps 与 host 提供。

## 7. 不变量

实施中必须由测试锁定：

1. 一次用户提交只组装一次 QueryParams。
2. `request` 已进入 `messages` 后，不再通过 prompt payload 重复传递。
3. State 在同一圈内保持已提交快照语义。
4. 同一 assistant tool batch 的全部结果进入同一个紧随其后的 user message。
5. 工具批次全部结束前不得执行正常 `state = next`。
6. 无工具 completed 不要求更新 State；完整 assistant message 必须已进入外层 History。
7. fallback attempt 可以撤销/tombstone，不得污染成功 attempt 或 next State。
8. `maxTurns` 统计模型—工具 agentic turn，不统计单个工具数量。
9. 正常 continue conversation 创建新 State，turnCount 从 1 开始。
10. 只有 waiting_user/interrupted/crash recovery 可以恢复 Query checkpoint。
11. `tool_running` 恢复不得自动重放副作用不确定的工具。
12. Conversation History 永远保持 provider 合法的 tool_use/tool_result 配对。
13. Renderer、audit 和 History 消费失败不得覆盖 Runtime 主结果。
14. Session、Thread、Run、Query 身份不得通过字符串相等关系推断。

## 8. 五阶段实施计划

每阶段必须单独完成、验证通过后再进入下一阶段。

### 阶段 1：锁定现有行为并建立术语边界

改动：

- 新增 `AgentQueryParams`、`AgentQueryState`、`AgentIterationWorkspace`、`QueryStartMode` 的类型骨架。
- 为 `SessionId`、`ThreadId`、`RunId` 增加内部 branded types 或明确 mapper。
- 建立 `AgentQueryAssembler`，首阶段只包装现有 Factory 输出，不改变行为。
- 增加架构测试，禁止 `ModelTurnRunner`、`ToolTurnRunner` 新增对 `AgentRuntimeOptions` 的读取。
- 为当前正常多工具 batch、AskUser、completed 后继续、waiting_user 恢复、崩溃恢复建立 characterization tests。

验收：

- 旧公开接口与 Renderer 行为不变。
- 新类型能够表达目标边界，但不复制状态事实源。
- 测试明确记录当前 `resumeThread` 行为及后续将替换的契约。
- `npm.cmd run typecheck`、`npm.cmd test` 通过。

### 阶段 2：建立 canonical Conversation History

改动：

- 新增 `ConversationHistoryStore` 接口，保存 thread 级完整 `AgentModelMessage[]`。
- SQLite 与文件 fallback 使用同一逻辑模型；不得只保存可见文本。
- 外层 query event consumer 在完整 assistant/user/tool message 到达时追加 History。
- terminal completed 后提交 History，释放 Query State。
- 将 `findRecoverableConversation` 的“找到可继续 thread”和“恢复 suspended query”职责分开。
- 正常 follow-up 从 History 组装 messages，不再读取 completed checkpoint 作为模型历史。

兼容：

- 旧 Service text messages 继续用于 UI 展示。
- 旧 checkpoint 缺少独立 History 时提供一次性迁移读取；成功写入新 History 后不再依赖旧 completed checkpoint。

验收：

- 新用户请求可在不恢复旧 Query State 的情况下获得完整 tool history。
- thinking/signature、image、tool_use/tool_result 能原样回放。
- completed 后的新 query 的 `turnCount`、render feedback 和 recovery counters 全部重置。
- 冷启动后正常 continue conversation 通过。
- `npm.cmd run typecheck`、`npm.cmd test` 通过。

### 阶段 3：完成 QueryParams → Initial State 边界

改动：

- `PresentationAgentRunFactory.prepare()` 改为返回 `PreparedAgentQuery`：
  - params
  - initialState
  - host
- QueryParams 统一包含 canonical messages、system prompt、contexts、permission function、tool context、model policy、query source 与 maxTurns。
- `ModelTurnRunner` 不再读取 `scope.options.request/messageHistory/model/runtimeRoot/onStreamChunk`。
- context compact 直接处理并返回 canonical messages。
- `resumeThread` 迁移为 `QueryStartMode`；正常 query 与 resume query 走不同 state initializer。

验收：

- QueryParams 在进入 loop 后保持稳定。
- fresh query 只调用一次 `createInitialQueryState(params)`。
- resume query 只从允许的 suspended/interrupted checkpoint 恢复。
- provider 最终收到的 messages 与 context compact 测试输出一致。
- `npm.cmd run typecheck`、`npm.cmd test` 通过。

### 阶段 4：引入单圈 Workspace 与原子 next State

改动：

- Driver 的一圈调整为 model → complete tool batch → next State。
- `ModelTurnRunner` 返回局部 assistant content/tool blocks，不直接写 committed State。
- `ToolTurnRunner` 接收完整 batch，保守串行执行，但统一返回结果数组。
- 全部工具完成后由 reducer 一次构造 next State。
- terminal tool 建立 batch 级策略；AskUser 第一阶段要求独占调用。
- checkpoint 拆分 committed State 与 inflight workspace。
- 保留工具执行前 `tool_running` 持久化和副作用不确定恢复策略。

验收：

- 普通多工具 batch 仅产生一个配对完整的 user result turn。
- AskUser + 普通工具混合调用不会拆分结果或丢失真实结果。
- 单个工具完成不会提前改变 committed `state.messages`。
- maxTurns 在完整 batch 后、next State 前判断。
- 故障注入覆盖 model received、tool claimed、tool returned、state committed 四个边界。
- `npm.cmd run typecheck`、`npm.cmd test` 通过。

### 阶段 5：收敛流式、恢复和旧状态兼容

改动：

- 流事件增加 attempt identity 与 reset/tombstone/commit 语义。
- fallback、输出截断与 context recovery 不再把失败 attempt 拼接到最终 UI 内容。
- aborted streaming/tools 返回显式 Query terminal，不把用户取消作为普通 model failure。
- waiting_user 保存 suspended workspace；用户回答后完成同一 batch 再生成 next State。
- checkpoint payload 升级并提供旧 version reader。
- 删除完成迁移后不再需要的 `resumeThread`、重复 prompt payload 和 AgentSession 状态别名。
- 更新 `agent-persistence-recovery.md` 与 `agent-data-pipeline.md` 的最终事实源描述。

验收：

- 正常 continue、交互式 waiting_user、进程重启、provider fallback、工具中断和用户取消均有端到端测试。
- 流式展示内容与最终持久化 assistant content 一致。
- 旧 checkpoint 可读取并迁移；新 writer 不再生成旧混合结构。
- diff 不包含无关 Presentation/Renderer 重构。
- `npm.cmd run typecheck`、`npm.cmd test` 通过。
- 有凭证时运行 `npm.cmd run test:integration:agent`；无凭证时按第 10 节手动验证。

## 9. 测试矩阵

| 场景 | 关键断言 |
|---|---|
| 纯文本 completed | History 收到最终 assistant；State 不需要 next |
| 单工具一圈 | assistant tool_use 与下一 user tool_result 完整配对 |
| 多工具 batch | 全部结果位于同一个 user turn |
| AskUser 独占 | 保存 suspended workspace；回答后再生成 next |
| AskUser 混合 batch | 不执行半批 terminal；产生完整错误配对并重试 |
| SubmitCommands | proposal terminal 不遗留未解释的 queued tool |
| fallback | 失败 attempt 被 reset/tombstone，成功 attempt 唯一提交 |
| max output recovery | partial 与 continuation 合并为一个正式 assistant message |
| prompt too long | 压缩直接作用于 provider 接收的 canonical messages |
| 用户取消 streaming | terminal 为 aborted_streaming；partial 展示与 History 策略明确 |
| 用户取消 tool | terminal 为 aborted_tools；悬空 tool_use 有匹配结果 |
| tool_running 崩溃 | 不自动重放；恢复结果标记副作用不确定 |
| completed 后下一请求 | 新 QueryParams、新 State、turnCount=1 |
| waiting_user 后回答 | resume query，不新建无关 State |
| 冷启动 continue | 从 canonical History 建立新 QueryParams |
| 旧 checkpoint | 兼容读取后迁移，新写入使用新结构 |
| 并发 run | 同 thread lease/CAS 行为保持不变 |

不得通过放松现有断言、删除失败用例或为固定输入写特判完成迁移。旧测试若表达了被替换的混合状态契约，必须在变更说明中指出替代它的新不变量。

## 10. 真实调用验证

单元测试无法证明以下真实行为：

- Anthropic thinking/signature 跨 query 回放合法；
- OpenAI/Anthropic 的多工具 batch 适配一致；
- provider 流式 fallback/tombstone 时序；
- 大 tool result 经 compact 后的真实 token/context 行为；
- AbortSignal 在真实网络流和长工具中的协作退出。

手动验证步骤：

1. 启动应用并完成“读取 PPT → 两个只读工具 → 文本总结”的多圈请求。
2. 发起 AskUser，请求回答后继续，确认没有 missing tool result。
3. 完成一次普通回复后再发新请求，确认新 query 的 turn limit 和 render feedback 状态已重置。
4. 模型流式输出时取消，重启应用并继续该 session。
5. 工具执行期间强制退出，重启后确认工具不自动重放，并要求检查持久化产物。
6. 使用大工具结果触发 context compact，确认真实 provider 请求成功。
7. 配置 fallback 或模拟可恢复错误，确认 UI 不重复失败 attempt 文本。

若缺少 `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` 或网络，实施总结必须明确列出未验证项目，不得以单元测试通过代替真实调用结论。

## 11. 非目标

本计划不包含：

- 重写全部 ToolDefinition 或 Presentation command 模型；
- 同时重构 teammate runtime；
- 为对齐参考实现而复制其全部 feature gate；
- 立即把公开 `AgentRuntime.run()` 改成 async generator；
- 把隐藏 thinking 内容写入长期 Memory；
- 删除现有 lease、CAS、terminal fence 或工具副作用恢复保护；
- 在同一阶段重构 Renderer 聊天组件。

事件通路可以先继续使用现有 callback/EventPort，只要能够表达完整 message commit 与 attempt reset；是否最终改为 async generator 另行决策。

## 12. 完成定义

全部满足后才算完成：

- `AgentRuntimeOptions` 只作为应用入口原始输入；
- QueryParams 是一次用户请求的唯一组装结果；
- Query State 在 while 前创建，并仅通过完整 next 替换；
- 单圈 assistant/tool 增量保存在 Iteration Workspace；
- provider attempt 可撤销，不污染 State 或 History；
- Conversation History 独立于 Query checkpoint；
- 正常 continue conversation 创建新 State；
- waiting_user/interrupted/crash recovery 才恢复 Query checkpoint；
- 同一工具 batch 始终保持 provider 合法配对；
- `sessionId`、`threadId`、`runId`、`queryId` 生命周期明确；
- 旧持久化格式有兼容读取与迁移路径；
- typecheck、单元测试和可执行的真实调用验证结果均已记录；
- 未修改无关测试或以特判绕过失败。
