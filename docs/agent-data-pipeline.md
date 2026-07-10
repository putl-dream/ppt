# Agent 数据链路设计

本文定义模型输出、工具执行、会话消息和持久化之间的稳定边界。目标是让 provider 差异、UI 富展示和模型上下文预算彼此解耦，并保证任意工具失败都能作为协议数据回填。

## 两套分类

模型原生输出统一归一为 4 类 `AgentModelContentBlock`：

1. `text`：展示文本。
2. `thinking` / `redacted_thinking`：需原样回放的思考块。
3. `tool_use`：客户端工具调用，包含稳定 ID、名称和结构化输入。
4. `server_tool`：MCP、Web Search、代码执行等 provider 托管块；用 `providerType + data` 保留原始语义。

完整运行链路由 8 类数据组成：

| 层 | 当前结构 | 责任 |
|---|---|---|
| 1. 流式协议 | `AgentModelStreamChunk` | 接收增量文本、thinking 和完成事件 |
| 2. 内容块 | `AgentModelContentBlock` | provider-neutral 的模型内容协议 |
| 3. 会话消息 | `AgentModelMessage`、`TranscriptMessage` | 保存 assistant/user/system/tool 历史 |
| 4. 工具定义 | `ToolDefinition` | 输入/输出 Schema、风险、执行和模型结果映射 |
| 5. 控制上下文 | `ToolContext`、Hook、权限策略 | 快照、会话、取消、审批、任务状态 |
| 6. 执行结果 | `PreparedToolResult<T>` | 分离本地富结果与模型紧凑结果 |
| 7. PPT/文件数据 | `Presentation`、commands、workspace artifacts | 真实业务数据与受控写入 |
| 8. 持久化 | transcript JSONL、`.agent/tool-results/` | 会话恢复与大结果完整保存 |

`AgentModelResponse.text/toolCalls/thinkingBlocks` 暂时保留为兼容字段；新 provider 适配器同时提供 `contentBlocks`。模型调用恢复层可以从内容块反推兼容字段，因此迁移不要求一次性修改全部调用方。

## 工具调用闭环

```text
provider stream / response
  -> AgentModelContentBlock[]
  -> tool_use(id, name, input)
  -> Zod inputSchema.safeParse
  -> PreToolUse hooks + permission
  -> tool.execute
  -> optional outputSchema.safeParse
  -> PreparedToolResult<T>
       data: 本地富结构
       modelContent: 有预算的紧凑结果
  -> tool_result(toolCallId === tool_use.id)
  -> next user turn
```

核心不变量：

- 不依赖 `stop_reason` 判断是否有工具调用，直接检查内容中的 `tool_use`。
- 同一 assistant 轮的多个 `tool_use` 会保守地串行执行，全部完成后合并成一个 user 结果轮。
- 每个调用 ID 必须恰好有一个结果；缺失结果补 synthetic error，孤立结果删除，重复 ID 去重。
- OpenAI 工具参数 JSON 解析失败不会退化为可执行的空对象，而是生成 `isError` 结果让模型重试。
- 工具异常、参数错误、权限拒绝和输出 Schema 错误都进入相同的错误结果通道。

## 本地富结果与模型结果

工具 `execute()` 返回的完整对象用于 Hook、运行轨迹和本地恢复。发给模型的内容通过以下优先级产生：

1. 工具声明的 `mapResultToModelContent()`。
2. 字符串结果直接使用。
3. 其他结果 JSON 序列化。
4. 空结果注入明确的完成标记。

默认超过 6000 字符的结果不会整段进入模型上下文：完整值原子写入 `.agent/tool-results/<thread>/`，模型只收到大小、路径和有界预览。写入失败不会把成功的工具执行改判为失败，失败原因只保留在本地结果元数据中。

## Schema 使用约定

新工具至少声明 `inputSchema`；稳定结构的输出应同时声明 `outputSchema`。`outputSchema` 在中央 Runtime 边界执行，而不是由各工具自行选择是否校验。`ReadPresentationSnapshot` 和 `ListSlides` 已作为参考实现接入。

当工具的本地结果不适合直接发给模型时，应提供：

```ts
mapResultToModelContent(result) {
  return `Created ${result.count} slides.`;
}
```

不要为了 UI 展示修改模型协议；UI 所需 diff、缩略图、完整 Presentation 或诊断信息应留在本地富结果中。

## 关键实现

- `src/main/agent/gateway/types.ts`：内容块、消息和 provider 兼容字段。
- `src/main/agent/gateway/message-pairing.ts`：调用/结果配对修复。
- `src/main/agent/gateway/content-blocks.ts`：内容块到兼容字段的投影。
- `src/main/agent/runtime/agent-runtime.ts`：批量调用编排、权限、执行和错误回填。
- `src/main/agent/runtime/tool-result-data.ts`：富结果/模型结果分离与大结果持久化。
- `src/main/agent/tools/tool-validation.ts`：中央输出 Schema 校验。

