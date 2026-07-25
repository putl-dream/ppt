# Query、QueryParams 与状态

> 文档类型：现行架构
> 最后核对：2026-07-25
> 核心实现：`src/main/agent/runtime/query/`

## 1. Query 的定义

一个 Query 是“一次逻辑用户请求从开始到显式终态”的完整执行。它可以包含多次模型调用、多个工具批次、上下文压缩、后台通知和用户等待。

Query 不是：

- 一次 Provider 请求；
- 一条 UI 消息；
- 一个 `runId`；
- 一份长期 Session；
- PPT 工作流中的一个固定阶段。

项目中的正式术语是 `query`、`AgentQueryParams`、`AgentQueryState` 和 `AgentIterationWorkspace`。参考项目不存在 `queryOramas/queryOrama` 契约；不在本项目中虚构这一层。

### 1.1 `queryOramas` 术语核对

对 `/mnt/e/Coding/claude-code` 的源码核对结果如下：

| 参考符号 | 责任 | 本项目映射 |
|---|---|---|
| `query()` / `queryLoop()` | 主 Agent 多圈编排 | `runtime/query/query.ts` |
| `queryModelWithStreaming()` | 流式 Provider 调用 | Gateway + `ModelTurnRunner` |
| `queryModelWithoutStreaming()` | 消费同一模型流并返回最终消息 | Gateway 一次性调用边界 |
| `sideQuery()` | 权限分类、记忆相关性、会话搜索等脱离主 Loop 的小查询 | 按用途放在窄 service；不得共享/修改主 Query State |

因此，若 `queryOramas` 原意是“Query Orchestration”，对应的是本章的
`QueryParams → State → IterationWorkspace → transition`；若原意是旁路模型查询，
对应参考项目的 `sideQuery()`。旁路查询只能返回有界结果，不能偷偷推进主
`turnCount`、写入主 History 或执行副作用工具。

## 2. 身份边界

| ID | 生命周期 | 用途 |
|---|---|---|
| `sessionId` | UI 会话 | 用户可见会话和项目选择 |
| `threadId` | 多个 Query | canonical Conversation History |
| `queryId` | 一个逻辑请求 | 暂停/恢复同一请求 |
| `runId` | 一次执行尝试 | lease、审计、失败重启 |

同一 `queryId` 可以因为崩溃或等待用户而经历多个 `runId`。正常的下一条用户消息创建新 Query，但沿用 `threadId`。

## 3. QueryParams：只组装一次

`AgentQueryParams` 是 Query 的稳定调用边界：

```ts
interface AgentQueryParams<TDeps> {
  messages: readonly AgentModelMessage[];
  systemPrompt: string;
  userContext: Readonly<Record<string, string>>;
  systemContext: Readonly<Record<string, string>>;
  canUseTool: CanUseToolFn;
  toolUseContext: ToolContext;
  model?: AgentModelSelection;
  fallbackModel?: AgentModelSelection;
  querySource: "user" | "continuation" | "recovery";
  maxOutputTokensOverride?: number;
  maxTurns: number;
  deps: TDeps;
}
```

约束：

- 在进入 `query()` 前完成 History、Prompt、工具解析、模型和依赖装配。
- Query Loop 不重新解释原始 `AgentRuntimeOptions`。
- `messages` 是 Query 初始 canonical History，不是可见 transcript。
- 依赖通过 `deps` 注入，便于不启动完整应用测试 Query。
- Query 运行期间不得就地修改 Params。

## 4. QueryState：只保存跨圈事实

`AgentQueryState` 是最近一次完整提交后的快照：

- canonical `messages`
- `toolUseContext`
- `turnCount`
- `transition`
- 输出截断与 reactive compact 恢复计数
- render feedback 使用标记
- 按工具统计的校验失败次数

State 不保存：

- 当前流式 attempt 的半条消息；
- 未配对的 `tool_use`；
- 已开始但未返回的工具 Promise；
- UI loader、toast 或临时文案；
- PPT 的长期业务阶段。

每次继续都创建 next State，不把同一个 State 作为可变容器传遍 Runtime。

## 5. IterationWorkspace：单圈未提交区

每一圈从 State 创建独立 `AgentIterationWorkspace`：

```text
State.messages
  → messagesForQuery
  → assistantMessages
  → toolUseBlocks
  → toolResults
  → followUpMessages / userContent
  → reduceQueryState()
  → next State
```

Workspace 负责：

- 当前模型 attempt 的已提交 ContentBlock；
- 当前 assistant batch 中的全部工具调用；
- 与调用 ID 配对的工具结果；
- inbox、后台结果和 Hook 产生的 follow-up；
- 只在本圈变化的恢复计数和工具上下文。

只有完整工具批次才能 reduce。数量相同但 ID 不匹配也必须拒绝提交。普通文本终态和
已完整配对的 `command_proposal` 终态同样先 reduce 为 `transition=completed`，
因此 terminal checkpoint 的 `turnCount` 和 History 不会停留在上一圈；
`ask_user` 终态则有意保留 inflight Workspace，等待同一 Query 恢复。具体由哪个工具
产生这些结果取决于 ToolDefinition capability/completion 元数据，不由 Query 按
工具名判断。

## 6. Query 入口与恢复

### 新 Query

1. 从独立 Conversation History 读取 thread 历史。
2. 追加当前用户 ContentBlock。
3. 组装 QueryParams。
4. 创建初始 State 和空 Workspace。

### Resume Query

仅用于：

- `waiting_user`
- `interrupted`
- `crash_recovery`

恢复读取持久化的 committed State 与可选 inflight Workspace，而不是恢复旧 JavaScript 对象引用。

| inflight phase | 恢复行为 |
|---|---|
| `model_streaming` | 保留已准备的模型输入，重放未提交 attempt |
| `model_received` | 从已提交 assistant batch 继续 |
| `tool_running` | 不盲目重放副作用；补错误结果并要求对账 |
| `waiting_user` | 将用户回答加入同一 suspended Workspace |

正常多轮对话不能走 `resume_query` 来复用上一 Query 的计数器和临时状态。

## 7. 可观察 Query 事件

`query()` yield provider-neutral 的控制流事实：

- `query_started`
- `workspace_recovered`
- `model_turn_completed`
- `tool_batch_completed`
- `state_committed`
- `query_completed`（包含最终 result type）
- `query_failed`（在错误继续向上传播前发出）

事件有三个用途：

1. Runtime/UI 投影进度；
2. audit 与诊断；
3. 架构测试直接断言状态推进。

事件不是第二份 State。消费者不能用回调结果影响 Query，也不能从丢失的事件重建恢复事实。

## 8. 不变量

- Params 在一个 Query 内不可变。
- State 只在完整一圈后替换。
- 一个 Workspace 只属于一个圈。
- 每个暴露给 Provider 的 `tool_use` 恰有一个 `tool_result`。
- Provider History 只由 ContentBlock 消息构造。
- Query observer 失败不能导致 Query 失败。
- 普通 `for await` 看不到 AsyncGenerator 的 return value，因此终态同时以
  `query_completed` 事件公开；Runtime 仍通过显式 `next()` 取得最终 outcome。
- `threadId/queryId/runId` 不可互相替代。
- PPT Artifact 状态不进入 Query State。

## 9. Context 与输出恢复

模型调用前的预算处理直接接收 `Workspace.messagesForQuery`。压缩后的 canonical
messages 会回写当前 Workspace，因此 reactive prompt-too-long 重试不会重新装回
原始超长历史。

`max_tokens` 恢复把已生成 partial assistant 内容作为临时 continuation history，
逐次合并去重；若重试仍持续截断并耗尽恢复次数，Query 失败，而不是把最后半段当成
成功终态。

`systemPrompt`、`userContext` 和 `systemContext` 是 request-scoped 输入。Gateway
负责把它们送到 Provider，但不把临时 Context 写入 `State.messages`。

## 10. 状态变更

| 旧结构 | 当前结构 |
|---|---|
| Runtime 内隐藏 while loop | 独立 `query()` AsyncGenerator，可注入 model/tool driver |
| Session 可变字段同时充当状态与临时区 | `Params → committed State → IterationWorkspace` |
| observer/UI 回调参与推进 | Query event 只读、best-effort |
| 模型 stop 或工具名决定完成 | 显式 model/tool outcome + ToolDefinition completion metadata |
| terminal 结果可能未提交最后一圈 | 非等待用户终态先验证配对、reduce、checkpoint |
| legacy payload 被压缩，canonical messages 不变 | canonical message 原生压缩并回写 Workspace |

## 11. 测试重点

- Params 只组装一次。
- reducer 拒绝缺失、孤立或 ID 不匹配的结果。
- 新 Query 重置 turn/recovery counter。
- 四种 inflight phase 按约定恢复。
- observer 抛错不改变 terminal result。
- canonical History 与 UI transcript 分离。
