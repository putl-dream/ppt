# Agent 持久化与恢复

> 文档类型：现行架构
> 最后核对：2026-07-25

## 1. 事实源

Agent 不依赖进程内 `Map` 作为可恢复事实源。

| 数据 | 文件后端 | 生命周期 |
|---|---|---|
| canonical Provider History | `.agent/threads/<threadId>.json` | thread |
| Query/Run checkpoint | `.agent/runs/<threadId>.json` | 当前/最近 Query |
| Service/UI state | `.agent/service/<threadId>.json` | session |
| 模型可恢复的大工具结果 | `.task_outputs/tool-results/<threadId>/` | workspace / thread |
| Context 压缩归档 | `.transcripts/` | workspace / query |
| teammate 协议 | `.agents/` | team session |
| task list | `.tasks/<identity>/tasks.json` | task list |
| 长期摘要 | `.memory/STATE.json`、`STATE.md` | workspace |

生产环境将 checkpoint、lease 等 Agent 内部状态放在 application-owned
`runtimeRoot`/SQLite。只有模型收到恢复路径后需要再次读取的大工具结果与 Context
归档落在 workspaceRoot，并继续受 `WorkspaceFileService` 的 containment、UTF-8 和
链接检查保护。内部 Runtime 状态不能通过模型可见文件 API 暴露。

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

普通 JSON/文本状态在目标目录使用：

```text
temp in same directory
  → write
  → file flush
  → rename/replace
  → directory flush where supported
```

Windows 替换目标时保留可回滚旧文件。JSON 主文件损坏时只使用已验证备份恢复，不能创建空状态覆盖原始证据。

业务文件的 guarded replacement 还增加：

```text
temp + manifest in canonical workspace root
  → manifest records target path and old/new inode + SHA-256
  → displace old inode to a unique backup
  → compare displaced inode with the ReadFile snapshot
  → hard-link and verify prepared inode
  → remove backup and manifest
```

进程崩溃后的首次读/写会读取 manifest。只有 target/backup fingerprint 能证明处于
“旧版本”或“已提交新版本”时才自动恢复/清理；未知外部 target、缺失材料或损坏
manifest 会保留证据并抛 `AtomicWriteConflictError(sideEffects="uncertain")`。回滚或
清理无法确认时也不能降级成 `WorkspaceFileError(sideEffects=none)`。

同一 target 的 recovery、读取和替换由跨进程锁包成一个临界区，活跃 writer 的
manifest 不会被第二个 reader 误当作崩溃材料。JSON backup 仅在主文件已成功读取但
解析失败时使用，且修复在同一 primary lock 内完成，不能覆盖已经排队的新 writer。

业务文件的 Glob/ReadFile/WriteFile/EditFile 还执行路径 identity、read-set 和
compare-and-commit 检查，见 [file-operations.md](./file-operations.md)。

## 8. 数据安全

- thinking/signature 只保存在 canonical History 和必要 checkpoint。
- Memory 只保存目标、状态和结果摘要。
- 最后一个不完整 transcript JSONL 行可忽略，但完整记录不能静默丢失。
- 大工具结果的持久化失败不改变已经发生的工具副作用；没有模型可读 workspace 时
  不得返回一个指向 application runtimeRoot 的不可达路径。
- 后台 Promise 不能假装跨进程恢复；重启后转换为明确通知。
- 原子替换的 manifest/backup 属于恢复证据；身份不明时优先保留，不静默删除。

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
- 任一 replacement 崩溃点恢复后，要么证明 old/new 状态，要么保留材料并显式
  `uncertain`；不能覆盖未知外部 writer。

## 11. 状态变更

| 旧边界 | 当前边界 |
|---|---|
| Session 可变字段承担 Query 恢复 | committed Query State 与 inflight Workspace 分离保存 |
| 模型、工具和终态使用模糊 checkpoint | durable phase 明确到 model/tool/finished 副作用边界 |
| thread writer 依赖单进程时序 | 文件锁/SQLite transaction + generation/revision CAS |
| Windows backup 仅按 target 是否存在清理 | manifest 同时验证 target、backup 和 old/new fingerprint |
| 不确定文件恢复可能被当成无副作用失败 | 普通/Atomic uncertain 错误上抛，禁止盲目重试 |
