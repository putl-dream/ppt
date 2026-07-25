# Agent Loop

> 文档类型：现行架构
> 最后核对：2026-07-25
> 核心实现：`src/main/agent/runtime/query/query.ts`

## 1. 为什么 Loop 必须独立

参考 Claude Code 的核心经验是：Agentic Loop 本身应是一个独立 `AsyncGenerator`。它接收已经准备好的 Query，产出可观察事件，并以显式 Terminal outcome 返回。

```ts
async function* query(
  run: PreparedAgentRun,
  driver?: AgentQueryDriver,
): AsyncGenerator<AgentQueryLoopEvent, AgentLoopTerminalOutcome>
```

这使循环：

- 不依赖 Renderer；
- 不拥有应用级资源创建；
- 可注入 Model/Tool runner；
- 可逐事件测试；
- 不需要通过大类私有字段观察状态；
- 能被 CLI、桌面 UI 或未来 SDK 复用。

## 2. 一圈的固定骨架

```text
读取 committed State
  ↓
创建 IterationWorkspace
  ↓
上下文预算处理
  ↓
模型流式调用
  ↓
收集 assistant ContentBlocks
  ├─ 无工具且满足终止条件 → commit completed State → Terminal
  ├─ 需要补充结果/恢复 → Continue
  └─ tool_use[] → Tool Batch
                      ↓
                validate / permission / hooks
                      ↓
                execute / normalize
                      ↓
                paired tool_result[]
                      ↓
reduce State ← 完整 Workspace
  ↓
checkpoint
  ↓
下一圈
```

模型的一次 `stop` 不是 Loop 的自然终止条件。是否结束由解析后的 outcome 决定。

## 3. 显式 outcome

Model turn 返回：

| outcome | 含义 |
|---|---|
| `terminal` | 已形成用户结果、问题或命令提案 |
| `tool_batch` | 有一批客户端工具需要执行 |
| `continue` | 需要通过 follow-up 再调用模型 |

Tool turn 返回：

| outcome | 含义 |
|---|---|
| `terminal` | `ask_user`、`command_proposal` 或策略终止 |
| 非 terminal | 工具结果完整，可 reduce 到 next State |

Query 的 terminal reason 至少区分正常终止与 step limit。模型错误、取消、prompt too long、Hook stop 等错误分类由 runner/finalizer 保留，不应折叠成含糊的“completed”。

## 4. 恢复路径

Loop 必须支持以下“继续而非失败”路径：

- 原生工具调用；
- required outcome 未满足；
- 后台任务结果；
- inbox 消息；
- max output tokens 升级或恢复提示；
- prompt too long 后的 compact；
- Hook 注入阻塞反馈；
- Provider fallback 后重放未提交 attempt。

恢复原因进入显式 transition，避免靠 transcript 文案猜测为什么继续。

## 5. 工具批次不变量

- 不依赖 `stopReason === "tool_use"`；直接检查真实 ContentBlock。
- 一个 assistant batch 的工具调用必须全部得到结果后才能提交。
- 已配对的 terminal tool 也必须先提交 completed State；不能只返回业务对象而遗留 inflight batch。
- 未知工具、参数错误、权限拒绝、异常、取消都生成 `isError` 结果。
- Terminal tool 不与普通写工具执行半个混合批次。
- Terminal/独占语义来自 ToolDefinition metadata；mixed batch 在任何工具执行前整批拒绝。
- 当前所有前台工具都按调用顺序串行执行。
- 只读并发需要未来新增显式 concurrency metadata，并保证结果仍按原调用顺序提交；当前契约没有这项元数据。

## 6. 流式 attempt

流式输出采用 attempt 语义：

```text
attempt_started
  → delta*
  → attempt_committed
       或
    attempt_reset(reason)
```

UI 可以乐观显示 delta，但 canonical assistant message 只有在 attempt commit 后进入 Workspace。Fallback 或恢复导致 reset 时，UI 删除该 attempt 的投影，History 不保存半条回复。

## 7. 取消和副作用

取消需要在三类边界检查：

1. 模型调用前/流式中；
2. 工具批次开始前；
3. 工具之间。

取消不能破坏调用/结果配对。已经向模型或 UI 暴露的调用必须得到 synthetic error result。

对文件写入、导出和 Presentation 应用等副作用，checkpoint 要先记录 `tool_running`。崩溃恢复默认不重放，而是检查持久化产物后由模型决定下一步。

## 8. 事件模型

Query yield 的事件描述控制流事实；Provider 流事件描述文本 attempt；`AgentEventPorts` 再把它们投影为：

- Renderer progress
- transcript/audit
- token usage
- diagnostics

所有 observer 都是 best-effort。事件处理器抛错不得进入 Query 的业务错误通道。

## 9. 禁止的耦合

Loop 内不应出现：

- React/IPC 调用；
- 固定 PPT 六阶段 switch；
- 读取 Skill 文件；
- 构建整段 System Prompt；
- 具体 FileWrite/Edit 实现；
- Presentation 坐标或 layout 规则；
- 通过普通文本解析工具 JSON；
- 直接写 UI transcript 当作 Provider History。

## 10. 验收场景

- 纯文本一圈结束。
- 多圈 tool_use → tool_result → final。
- 多工具批次中的参数错误仍保持完整配对。
- Provider fallback reset 流式 attempt。
- 模型流中断后恢复不提交半条 assistant 消息。
- `tool_running` 崩溃不重复写文件。
- observer 抛错、UI 断开不改变结果。
- step limit 产生明确终态和可继续会话。

## 11. 状态变更

| 旧行为 | 当前行为 |
|---|---|
| Runtime 私有循环同时推进状态和 UI | `query()` 只推进 Query，事件由 Runtime 投影 |
| terminal 工具按名称硬编码 | completion metadata 决定终止、独占和结果契约 |
| mixed batch 遇 terminal 后提前返回 | 执行前整批拒绝，所有 ID 都得到错误结果 |
| terminal tool 可能没有 canonical result | 终止前先记录成对 tool result；等待用户是明确 suspended workspace |
| max-output 续写丢掉第一段 | partial 进入临时 assistant history，多段累积并持续检查截断 |
