# 本地日志与运行诊断

状态：Implemented。

Agent PPT 使用主进程结构化 JSONL 日志进行本地诊断。日志是运行状态的观察投影，
不参与 Query、工具执行、审批或持久化决策；日志写入失败不得改变业务控制流。

## 存储与管理

- 日志目录由设置页“打开目录”进入，默认位于应用数据根的 `logs/`。
- 日志按系统本地自然日写入 `agent-YYYY-MM-DD.log`；同日重启继续追加，跨日自动切换。
- 每天严格只有一个文件，不按大小分片且不压缩；默认保留最近 7 个自然日。
- 旧版 `agent.log`、压缩轮转文件和历史元数据仍会计入状态，并可通过“清理日志”删除。
- `timestamp` 使用带本地 UTC 偏移的 ISO 8601 格式，便于直接阅读且仍可精确解析。
- `AGENT_LOG_LEVEL=debug|info|warn|error` 可覆盖最低记录级别；设置页配置优先。
- `AGENT_LOG_FILE=false` 可关闭文件写入，仅保留控制台。
- `AGENT_LOG_DETAIL=full` 保留为显式兼容开关；默认内容策略仍由日志级别控制。

## 关联身份

一次前台请求通过下列字段关联：

| 字段 | 含义 |
|---|---|
| `sessionId` | UI 会话 |
| `runId` | 一次可持久化运行 |
| `threadId` | 可继续的 Agent 对话 |
| `queryId` | Runtime 内的一次 Query 生命周期 |
| `toolCallId` | Provider 产生的单次工具调用 |
| `gatewayRequestId` | 单次模型网关请求 |

主进程在 Agent 操作入口建立异步日志上下文；Query、模型请求、并行工具和后台任务继承
同一组身份。事件显式数据不能覆盖上下文中的权威关联字段。

## 事件约定

| 事件 | 级别 | 内容 |
|---|---|---|
| `agent.request.received` | Info | 请求入口、长度和 160 字符摘要 |
| `agent.request.detail` | Debug | 脱敏、限长后的请求正文 |
| `agent.query.started/completed` | Info | Query 启动模式、结果和耗时 |
| `agent.query.failed` | Error | Query 异常；取消使用 `interrupted` Info |
| `model.request.*` / `model.stream.*` | Info/Error | Provider、模型、用量边界和耗时 |
| `tool.call.requested` | Info | 工具身份、参数结构和短摘要 |
| `tool.execution.started/finished` | Info/Warn | 执行状态和耗时 |
| `tool.result.delivered` | Info | 结果块数量、文本长度、图片数量和短摘要 |
| `tool.call.input/output` | Debug | 脱敏、限长后的工具参数和结果 |
| `teammate.tool.started/finished` | Info/Warn | 队友、任务、工具和结果状态 |
| `runtime.audit.persist-failed` | Warn | 审计事件无法持久化，但运行继续 |

## 内容与隐私

- Info 面向默认链路排查，只记录请求摘要和最多 512 字符的工具摘要。
- Debug 预览上限为 8 KiB，并限制对象深度、数组项目数和对象键数量。
- API Key、Authorization、密码、Secret、Token 和 Bearer 内容在序列化时脱敏。
- Base64、图片和可识别的二进制字段不写原文，只记录被省略的字符数量。
- Error 会保留名称、消息、堆栈和错误码，但同样执行凭据脱敏。
- 日志仅写本机，不进行远程遥测或上传。
