# Harness 多 Agent 协作与消息总线修复方案

> 状态：待实现  
> 范围：Harness 层；团队协作、多 Agent 生命周期、文件消息总线、lead/teammate 双向通信。

## 1. 背景

本次 diff 引入了长驻 teammate agent、文件 backed `MessageBus`、`spawn_teammate` 工具、lead inbox 自动轮询与 teammate 权限请求转发。整体方向正确：lead 与 teammate 可以通过 mailbox 解耦，teammate 可以异步工作并把结果送回 lead。

当前实现仍有几个会影响闭环可用性的 Harness 层问题：

1. lead 只能 `spawn_teammate`，没有向已有 teammate 发普通消息、列出 teammate、请求关闭 teammate 的工具。
2. `TeammateManager.spawn()` fire-and-forget 启动后台 Promise，失败路径会 rethrow，可能变成主进程 unhandled rejection。
3. teammate 进入 `idle` 后仍受同一个 `maxSteps` 循环条件限制，预算用尽时会被静默停掉，无法真正 long-lived。
4. `sanitizeAgentName()` 允许 `:`，在 Windows mailbox 文件名中不安全。

## 2. 目标

- lead 和 teammate 之间形成可用的双向消息闭环。
- teammate 失败不会冲击 Electron 主进程稳定性。
- teammate `idle` 状态是真正等待 inbox，而不是达到 step limit 后退出。
- mailbox 文件名跨平台安全，尤其兼容 Windows。
- 修复均可由单元测试覆盖，不依赖真实模型或 UI 手测。

## 3. 非目标

- 不引入网络消息队列、数据库或独立 daemon。
- 不实现跨设备/跨进程的完整 team orchestration UI。
- 不改变现有 `Task` 一次性子 Agent 语义。
- 不扩大 teammate 可用工具权限；仍复用现有 `PreToolUse` policy。

## 4. 修复设计

### 4.1 Lead 侧 teammate 管理工具

新增 main runtime core tools：

| 工具 | 作用 | 权限建议 |
|------|------|----------|
| `send_teammate_message` | lead 向指定 teammate 发送普通消息或 shutdown 以外的结构化消息 | `approval: never`，`effects: ["workflow.delegate"]` |
| `list_teammates` | 返回当前 session 的 teammate handle 列表 | `approval: never`，只读 |
| `shutdown_teammate` | 请求 teammate 优雅退出 | `approval: never` 或 low-risk approval hint |

实现要点：

- 工具挂到 `createDefaultToolRegistry()`，使用 `context.messageBus` 和 `context.teammateManager`。
- `send_teammate_message` 默认发送 `type: "message"`，只允许 lead 发送到已知 teammate；如目标不存在，应返回清晰错误。
- `shutdown_teammate` 调用 `TeammateManager.requestShutdown(name)`，并返回当前 handle 状态。
- `list_teammates` 暴露 `name / role / status / startedAt / lastActiveAt`，不暴露 controller/promise。

### 4.2 Teammate 后台 Promise 安全收口

修改 `TeammateManager.spawn()`：

- `state.done` 不应裸接 `runTeammate(...).finally(...)` 后继续 rethrow。
- 在 manager 内部 `.catch()` 记录错误、设置 `status = "failed"`、缓存 `lastError`，并尽力发送 `type: "error"` 到 lead。
- `waitFor(name)` 可以选择 resolve，不把内部后台异常传播成未处理 rejection；如果调用者需要错误，可新增 `getLastError(name)` 或在 handle 中给出 `lastError?: string`。

建议状态结构：

```ts
type TeammateState = TeammateHandle & {
  controller: AbortController;
  done: Promise<void>;
  lastError?: string;
};
```

### 4.3 Idle 生命周期与 step budget 分离

当前问题来自：

```ts
while (!signal.aborted && modelSteps < maxSteps) {
  ...
  state.status = "idle";
}
```

修复方向：

- 外层循环只受 `signal.aborted` 控制。
- 当 `state.status === "idle"` 且 inbox 为空时，只 sleep/poll，不消耗模型 step，也不因 step limit 退出。
- 每次收到新的非 shutdown inbox 消息后，把它视为一个新 assignment，并为该 assignment 重置 `modelSteps = 0`。
- 如果单个 assignment 达到 `maxSteps`，向 lead 发送 `type: "error"` 的 step-limit 消息，然后进入 idle 或 stopped，需明确选择。

推荐语义：

1. 初始 prompt 是第一个 assignment。
2. 每次 inbox 有新 lead 指令，开始一个新的 assignment。
3. assignment 达到 step limit 后发送错误并进入 idle，等待 lead 决定下一步。
4. 只有收到 `shutdown_request`、abort 或不可恢复初始化错误时才 stopped/failed。

### 4.4 Mailbox 文件名跨平台安全

调整 `sanitizeAgentName()`：

- 不允许 `:` 进入 mailbox 文件名。
- 建议 allowlist：`/[a-zA-Z0-9_.-]+/`。
- 对空名仍 fallback 到 `"agent"`。
- `spawn_teammate` fallbackName 同步使用同一 sanitizer，避免两套规则分叉。

示例：

```ts
export function sanitizeAgentName(name: string): string {
  const sanitized = name.trim().replace(/[^a-zA-Z0-9_.-]+/g, "_");
  return sanitized || "agent";
}
```

## 5. 建议改动清单

| 优先级 | 文件 | 改动 |
|--------|------|------|
| P1 | `src/main/agent/tools/core/send-teammate-message.ts` | 新增 lead 出站消息工具 |
| P1 | `src/main/agent/tools/core/list-teammates.ts` | 新增 teammate 列表工具 |
| P1 | `src/main/agent/tools/core/shutdown-teammate.ts` | 新增关闭请求工具 |
| P1 | `src/main/agent/tools/tool-registry.ts` | 注册以上工具 |
| P1 | `src/main/agent/teammate/spawn-teammate.ts` | 捕获后台失败；重构 idle/step-limit 生命周期 |
| P2 | `src/main/agent/teammate/message-bus.ts` | 修复 sanitizer，保证 Windows 文件名安全 |
| P2 | `src/main/agent/tools/core/spawn-teammate.ts` | fallbackName 改用 shared sanitizer |
| P2 | `src/main/agent/teammate/teammate-system-prompt.ts` | 明确 idle 后等待 lead 消息、step-limit 后汇报 |

## 6. 测试计划

新增或扩展 `tests/teammate-message-bus.test.ts`：

1. **lead 可以给 idle teammate 发送第二条任务**  
   - spawn teammate，第一个 assignment 完成并进入 idle。
   - lead 通过 `send_teammate_message` 发送第二条指令。
   - teammate 再次调用模型并把第二个 result 发回 lead。

2. **idle 不因 maxSteps 耗尽而 stopped**  
   - 设置 `maxSteps: 1`。
   - teammate 完成第一步并进入 idle。
   - 断言 manager list 中 status 仍为 `idle`，直到 shutdown。

3. **后台失败不产生 unhandled rejection**  
   - gateway 抛错。
   - 等待 manager 状态变 `failed`。
   - 断言 lead inbox 有 `type: "error"`，测试进程不出现未处理 rejection。

4. **Windows unsafe agent name 被安全归一化**  
   - 输入 `design:agent/one`。
   - 断言 mailbox path basename 不包含 `:`、`/`、`\`。

5. **lead 工具目标校验**  
   - 对不存在 teammate 调用 `send_teammate_message`，断言返回明确错误，不创建孤儿 mailbox。

回归命令：

```bash
npm run typecheck
npm test
```

## 7. 验收标准

- lead 模型可通过工具完成：spawn -> 收 result -> 追问/补充任务 -> teammate 继续执行 -> shutdown。
- teammate 在 idle 状态不消耗模型调用，不因旧 assignment 的 step budget 自动退出。
- teammate 内部异常不会形成 unhandled rejection。
- mailbox 文件路径在 Windows/macOS/Linux 均合法。
- 所有新增行为有单元测试，`typecheck` 与非集成测试全绿。

## 8. 实施顺序

1. 修 `sanitizeAgentName()` 与 fallbackName，先补跨平台单测。
2. 修 `TeammateManager.spawn()` Promise 收口，补失败单测。
3. 重构 idle/step-limit 生命周期，补 idle 持久化与第二任务单测。
4. 新增 lead 侧 teammate 管理工具，补工具级单测。
5. 最后调整 teammate system prompt 与工具卡描述，保证模型知道如何使用双向链路。

## 9. 风险与注意事项

- `MessageBus.readInbox()` 是消费式读取；权限等待中的 teammate 会把非匹配消息 push back 到内存 buffer。重构 idle 时要避免把 shutdown 或后续任务消息吞掉。
- lead inbox poller 会触发隐藏 run；新增 lead 出站工具后，应避免每次 `peekInbox("lead")` 只因同一条未消费消息反复触发。实际消费仍应只发生在 runtime `readInbox("lead")`。
- 如果 future UI 展示 teammate 列表，manager 状态必须来自 session runtime，而不是全局单例，避免跨项目串话。
