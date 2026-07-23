# Agent 持久化与恢复

## 事实源

Agent 不再依赖进程内 `Map` 作为可恢复事实源。每个会话沙箱包含：

- `.agent/threads/<threadId>.json`：跨 query 的 canonical `AgentModelMessage[]`，完整保留 thinking/signature、image、tool_use/tool_result。
- `.agent/runs/<threadId>.json`：当前 query 的 committed State、inflight Iteration Workspace、工具副作用边界、Skill/工具发现状态和终止状态；不再兼任 completed conversation history。
- `.agent/service/<threadId>.json`：文本对话、模型、执行策略和完整命令审批。
- `.agent/tool-results/<threadId>/`：超过上下文预算的完整工具结果。
- `.agents/protocol-state.json`：teammate 的 shutdown/plan approval 协议状态。
- `.tasks/*.json`：任务图和进程认领标识。
- `.memory/STATE.json`、`.memory/STATE.md`：从已提交 Service 状态生成的目标与结果摘要；不保存隐藏思维链。

所有 JSON 状态通过临时文件写入、文件 flush、rename 和目录 flush 提交。Windows 不允许目录句柄时跳过目录 flush，但仍保证临时文件在 rename 前已 flush。

## Checkpoint 边界

Runtime 在以下边界提交 checkpoint：

1. 模型调用前；
2. 模型 ContentBlock 响应和全部 `tool_use` 入队后；
3. 工具执行前，状态为 `tool_running`；
4. `tool_result` 写入本地队列后；
5. AskUser、命令提案或普通回复完成时。

一次正常工具圈固定为 model → 完整 assistant tool batch → 全部 tool results → 原子 next State。
每个工具执行前仍保存 `tool_running`，工具返回后保存 inflight workspace；只有整个批次完成后才替换 committed State。

如果进程停在 `tool_running`，恢复时不会重放工具。Runtime 会补一个 `isError` 的结构化 `tool_result`，要求模型读取持久化产物进行对账。这样优先避免重复写文件、重复导出或重复执行命令。

后台任务无法跨进程保留 Promise。未提交的后台任务在恢复上下文中变成明确的失败通知，并要求检查产物后再决定是否重试。

## 冷启动恢复

- renderer 在发起模型调用前同步保存 user 消息和带稳定 threadId 的 assistant 占位消息。
- 正常 continue 从 canonical Conversation History 创建新的 QueryParams/State，turnCount、render feedback 和 recovery counter 重置。
- 只有 waiting_user、interrupted 或 crash recovery 才装载 Runtime query checkpoint；旧 version 1 checkpoint 仍可读取，并在首次成功完成后迁移出独立 History。
- 待审批命令跨重启保留，应用时重新检查 Presentation revision 并重新运行 CommitGate。
- transcript 忽略被强杀造成的最后一个不完整 JSONL 行；冷启动可沿 parent 链追回 leaf 指针之后已经完整追加的消息。
- 全局会话和工作区索引维护校验备份。主文件损坏时恢复备份；主文件和备份都无效时停止启动并保留原文件，不创建空状态覆盖。
- Task claim 包含进程实例 ID，新进程会把旧进程遗留的 `in_progress` 任务恢复为 `pending`。

## 数据安全

Provider thinking ContentBlock 会保留在 thread checkpoint，用于同一 thread 的协议级恢复。长期记忆只保存目标、结果和状态，不把隐藏 chain-of-thought 汇总到跨会话 Memory。
