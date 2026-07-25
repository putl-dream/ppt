# Agent 持久化与恢复

> 文档类型：现行架构

## 1. 事实源

Agent 不依赖进程内 `Map` 作为可恢复事实源。

| 数据 | 文件后端 | 生命周期 |
|---|---|---|
| canonical Provider History | `.agent/threads/<threadId>.json` | thread |
| Query/Run checkpoint | `.agent/runs/<threadId>.json` | 当前/最近 Query |
| Service/UI state | `.agent/service/<threadId>.json` | session |
| 大工具结果 | `.agent/tool-results/<threadId>/` | runtime artifact |
| teammate 协议 | `.agents/` | team session |
| task list | `.tasks/<identity>/tasks.json` | task list |
| 长期摘要 | `.memory/STATE.json`、`STATE.md` | workspace |

生产环境优先将 Agent 内部状态放在 application-owned `runtimeRoot` 或 SQLite；为兼容本地 workspace，文件 Store 可使用 workspaceRoot。用户业务文件与 Runtime 内部状态必须通过不同服务访问。

## 2. History、Checkpoint 与 Transcript

三者不可互换：

- **Conversation History**：Provider 可重放的完整 ContentBlock 消息。
- **Checkpoint**：当前 Query 的 committed State、可选 inflight Workspace 和副作用边界。
- **Transcript**：用户可见文字、诊断和审计记录。

UI transcript 不能重建 thinking signature、image、tool ID 配对等 Provider 协议事实。

## 3. Checkpoint v2

Checkpoint 保存：

- thread/query/lastRun identity
- writer generation/revision
- status 和 durable phase
- committed Query State
- 可选 inflight Workspace
- loaded Skill / discovered tool state
- 后台任务和已消费 inbox
- terminalHistory fallback
- result/error

不再保存 Session 中与 Query State 重复的消息、工具队列或 render feedback 别名。

## 4. 提交边界

Runtime 至少在以下边界 checkpoint：

1. 模型调用前；
2. assistant response 已进入 Workspace；
3. 每个副作用工具执行前，标记 `tool_running`；
4. 工具结果写入 Workspace 后；
5. 完整批次 reduce 成 next State 后；
6. waiting user、proposal 或 terminal。

一次正常工具圈：

```text
committed State
  → inflight model_streaming
  → inflight model_received
  → tool_running
  → paired results
  → atomic next State
```

## 5. Writer lease 与 CAS

同一 thread 同时只有一个 writer：

- `openLease()` 原子返回 lease 和同一临界区观察到的 previous checkpoint。
- checkpoint 写入携带 generation 和精确 revision。
- terminal fence 后旧 owner 不能覆盖终态。
- close 只释放自己仍持有的 lease。

文件后端和 SQLite 后端必须提供等价语义。

## 6. 冷启动恢复

### 正常下一条用户消息

从 canonical History 创建新 Query，重置 turn 和恢复计数。

### waiting_user

恢复原 Query 与 inflight Workspace，把用户回答追加为同一批次的 user content。

### model_streaming

流式 attempt 尚未 commit。重放已准备的模型输入，不把空 Workspace reduce 成已完成 turn。

### tool_running

不自动重放工具。补充结构化错误结果，提示模型检查持久化产物后决定是否重试。

### terminal History 窗口

成功终态 checkpoint 先保存 `terminalHistory`，再写独立 History。若两步之间崩溃，下一次 Query 可从 terminal fallback 恢复并写回 History。

## 7. 原子文件写入

JSON 和文本状态使用：

```text
temp in same directory
  → write
  → file flush
  → rename/replace
  → directory flush where supported
```

Windows 替换目标时保留可回滚旧文件。JSON 主文件损坏时只使用已验证备份恢复，不能创建空状态覆盖原始证据。

业务文件的 Glob/ReadFile/WriteFile/EditFile 还需额外执行路径和 read-set 并发检查，见 [file-operations.md](./file-operations.md)。

## 8. 数据安全

- thinking/signature 只保存在 canonical History 和必要 checkpoint。
- Memory 只保存目标、状态和结果摘要。
- 最后一个不完整 transcript JSONL 行可忽略，但完整记录不能静默丢失。
- 大工具结果的持久化失败不改变已经发生的工具副作用；返回结果必须标记不确定性。
- 后台 Promise 不能假装跨进程恢复；重启后转换为明确通知。

## 9. 关键实现

- `src/main/agent/persistence/atomic-json-file.ts`
- `src/main/agent/persistence/conversation-history-store.ts`
- `src/main/agent/persistence/durable-run-store.ts`
- `src/main/agent/persistence/durable-service-store.ts`
- `src/main/agent/runtime/lifecycle/checkpoint-coordinator.ts`
- `src/main/agent/runtime/lifecycle/agent-run-scope.ts`

## 10. 验收

- terminal checkpoint 与 History 任一写入点崩溃均可恢复。
- `tool_running` 恢复不重复副作用。
- 两个 owner 不能同时推进同一 thread。
- checkpoint 不含与 Query State 重复的可变别名。
- Memory 不包含隐藏思维链。
