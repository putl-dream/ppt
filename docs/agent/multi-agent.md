# Multi-Agent、Task 与后台工作

> 文档类型：现行架构与本轮目标契约

## 1. 定位

Multi-Agent 是可选能力，不是所有复杂请求的强制工作流。

Lead 可以：

- 直接使用完整工具集完成任务；
- 为可并行、边界清楚的工作创建持久化 Task；
- spawn 长驻 teammate；
- 通过 mailbox 追加指令或接收结果；
- 在 teammate idle 后继续分配。

是否委派由模型根据任务独立性、成本和并发收益判断，不由 Prompt stage 强制。

## 2. TaskStore 是持久化协调协议

Task 的维度保持正交：

- status：`pending / in_progress / completed`
- owner
- dependencies：`blocks / blockedBy`
- review
- routing / completion policy

规则：

- claim 只改变 owner；
- 开始工作显式更新 status；
- teammate 完成需要 review 时先 request；
- approve 原子完成并解锁下游；
- 普通工具成功不自动推导 Task completed；
- Query Loop 不内置 Task 状态机。

## 3. Teammate 生命周期

```text
idle
  → assigned
  → one model/tool turn
  → assigned | idle
  → stopping
  → stopped

任意 active phase
  → failed
```

一个 teammate 可以处理多个 assignment。单次 assignment 达到 step limit 后回到 idle，不等于整个 teammate 失败。

`TeammateRuntime.phase` 是进程内生命周期事实；TaskStore 是任务所有权事实，两者不能用同一个布尔值代替。

## 4. Conversation 与工具能力

Main 和 teammate 共享：

- Provider-neutral ContentBlock；
- tool_use/result 配对；
- 文件路径和原子写入服务；
- Permission profile；
- Hook 和错误归一化；
- Skill 加载语义。

teammate 可以拥有更小的 resolved tool pool，但不应维护语义不同的 Write/Edit 实现。

Assignment prompt 必须自包含目标、输入、输出和验收，不依赖 lead 的隐藏聊天上下文。

## 5. Message Bus

Mailbox 是 durable append-only 输入：

- agent 名规范化为跨平台安全文件名；
- append、claim、consume 分离；
- claim 先持久化再删除原 mailbox；
- 崩溃后可恢复 processing claim；
- 未知 teammate 不创建孤儿 mailbox；
- protocol response 与普通消息保持原顺序。

Lead/teammate 在下一次模型调用前消费 inbox。Tool batch 内不增加破坏原子批次的抢占点。

## 6. Idle 调度

Idle scheduler 只负责：

- inbox 优先级；
- task board 扫描；
- 原子 claim；
- poll/timeout；
- 转换到 assigned/stopping。

它不调用模型、不消费工具结果，也不修改 Task status。

## 7. Background Task

后台任务与 teammate 不同：

| 背景工具 | Teammate |
|---|---|
| 当前 Query 的一个慢工具调用 | 独立对话和多 turn worker |
| 结果作为 task notification 回到 lead | 通过 mailbox/task review 协作 |
| 不跨进程保存 Promise | 状态和 assignment 可持久化 |
| 适合导出、预览等单个慢操作 | 适合独立研究、写作、设计 |

后台启动采用两阶段：

1. 持久化 scheduled placeholder；
2. placeholder 成功后 launch。

重启时未完成后台任务变为明确失败通知，不伪装成仍在运行。

## 8. 终态清理

Assignment finalizer：

- 完成当前 activity；
- 处理 review/step limit；
- 释放当前 assignment 的 owned tasks；
- teammate 继续存活。

Terminal finalizer：

- shutdown、abort、failure、idle timeout；
- best-effort 发送生命周期摘要；
- 释放所有 ownership；
- flush protocol state；
- 最后公开 stopped/failed。

清理失败进入审计，但不能让同名旧实例在仍清理时被提前重新 spawn。

## 9. 关键实现

- `src/main/agent/task/task-store.ts`
- `src/main/agent/tools/core/task-tools.ts`
- `src/main/agent/teammate/teammate-runtime.ts`
- `src/main/agent/teammate/spawn-teammate.ts`
- `src/main/agent/teammate/message-bus.ts`
- `src/main/agent/teammate/teammate-conversation.ts`
- `src/main/agent/runtime/background/background-task-manager.ts`
- `src/main/agent/runtime/background/lead-inbox-input-source.ts`

## 10. 验收

- Lead 不委派也能直接读写 workspace。
- 两个 teammate 原子认领不同任务。
- inbox 消息在下一 turn 前按序进入 conversation。
- teammate step limit 后仍可接新 assignment。
- shutdown/abort/failure 均释放 ownership。
- 后台任务重启后产生可见失败通知，不重复执行副作用。
