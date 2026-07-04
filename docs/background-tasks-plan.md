# 后台任务（Background Tasks）落地计划

> 版本：2026-07-05
> 状态：待评审
> 关联：[ppt-quality-attention-plan.md](./ppt-quality-attention-plan.md)（原生 tool-use 已落地，本方案的前置）

---

## 1. 目标

慢操作（子 Agent 委派、导出渲染、截图预览）放到后台执行，主 Agent 不再 `await` 干等，可以在同一次 run 内继续发起其它工具调用；后台跑完后，结果在后续某一步作为通知注入回模型。

**价值边界（诚实说明）**：本项目是单线程 Node 事件循环 + 原生 tool-use（每步只允许一个工具调用）。收益只在「模型手上还有独立工作可做」时成立——典型场景：

- 并行 `Task` 委派（多个子 Agent 同时跑，最贵的慢操作）；
- 一边 `ExportPptx` 渲染，一边继续编辑其它页；
- `preview-slide` 截图返回前先做别的决策。

若模型的下一步动作**依赖**后台结果，那只是把等待推迟到 drain 阶段，并无净收益。这一点在方案里通过「finish 前强制 drain」保证正确性，不追求虚假的并发感。

---

## 2. 与 Python 草案的关键差异（先纠偏）

原始草案基于 Python 多线程，直接照搬会引入错误。本项目的真实约束：

| 草案假设 | 本项目现实 | 结论 |
|---|---|---|
| `threading.Thread` + `daemon=True` | 单线程事件循环，无真并行 | 后台任务 = **不 await 的 Promise**，在 await 点交错执行 |
| `threading.Lock` 保护共享 dict | 单线程，await 之间无抢占 | **不需要锁**，普通 `Map` 即可 |
| 模块级全局 `background_tasks` dict | `AgentRuntime.run()` 可被多 thread/会话重入 | 必须是 **per-run 实例**，全局会串话 |
| `tool_name == "bash"` + install/build/test 关键词启发式 | 本项目没有 bash 工具；慢的是 `Task` / `ExportPptx` / `preview-slide` | 启发式需**按本域重定义** |
| 一个占位 tool_result + 独立 text 通知 | 原生 tool-use 每个 `tool_use` 必须**恰好**配一个 `tool_result`；且 user 轮不能连续两条 | 占位思路正确，但通知须**并入**带 tool_result 的同一条 user 轮 |

草案中「先回带 bg_id 的占位 tool_result，通知后续作为独立 text block 注入」的核心思想是对的，且恰好契合 Anthropic 的 `tool_use`↔`tool_result` 配对语义——这部分保留。

---

## 3. 设计总览

```
step 循环（agent-runtime.ts）
  ├─ 回合开始：flush 上一轮 pendingToolResult（native）
  │            ⨁ 收集已完成后台任务通知 → 并入同一条 user 轮的文本块
  ├─ 调模型 → 得到单个 tool_call
  ├─ shouldRunBackground(tool, args)?
  │     ├─ 是：bgManager.start(promise)；立即 recordToolResult("[Background bg_xxxx started]")
  │     │       —— 不 await，Promise 在事件循环后台推进
  │     └─ 否：await tool.execute()（现有同步路径，原样保留）
  └─ 模型想 finish（message / SubmitCommands / step-limit）
        └─ 若 bgManager.hasPending()：drain 全部 → 注入通知 → 再给模型一步
           （而非丢弃后台结果）
```

后台任务的生命周期**严格绑定单次 `run()`**：不做跨 run、跨会话的持久化（与草案一致，`daemon=True` 的语义即「进程/run 退出即随之结束」）。

---

## 4. 组件设计

### 4.1 新增 `background-task-manager.ts`

`src/main/agent/runtime/background-task-manager.ts`——per-run 实例，无全局状态、无锁。

```ts
export interface BackgroundTaskRecord {
  bgId: string;
  toolName: string;
  label: string;          // 供 UI / 通知展示（如 "Task: 生成大纲"）
  status: "running" | "completed" | "failed";
  startedAt: number;
}

export interface BackgroundNotification {
  bgId: string;
  toolName: string;
  label: string;
  status: "completed" | "failed";
  content: string;        // 成功为工具结果 JSON；失败为错误消息
  isError: boolean;
}

export class BackgroundTaskManager {
  private counter = 0;
  private readonly tasks = new Map<string, BackgroundTaskRecord>();
  private readonly done: BackgroundNotification[] = [];   // 待收割队列

  /** 启动一个后台任务。不 await——Promise 在事件循环后台推进。 */
  start(input: {
    toolName: string;
    label: string;
    run: () => Promise<unknown>;
  }): string {
    this.counter += 1;
    const bgId = `bg_${String(this.counter).padStart(4, "0")}`;
    this.tasks.set(bgId, {
      bgId, toolName: input.toolName, label: input.label,
      status: "running", startedAt: Date.now(),
    });

    // 关键：不 await。catch 兜底，保证 rejection 落到 done 队列而非全局未捕获。
    void input.run().then(
      (result) => this.settle(bgId, JSON.stringify(result ?? null), false),
      (error) => this.settle(bgId, error instanceof Error ? error.message : String(error), true),
    );
    return bgId;
  }

  private settle(bgId: string, content: string, isError: boolean): void {
    const task = this.tasks.get(bgId);
    if (!task) return;
    task.status = isError ? "failed" : "completed";
    this.done.push({
      bgId, toolName: task.toolName, label: task.label,
      status: task.status, content, isError,
    });
  }

  hasRunning(): boolean {
    return [...this.tasks.values()].some((t) => t.status === "running");
  }

  /** 收割已完成任务的通知（收割后从队列移除，不重复注入）。 */
  collect(): BackgroundNotification[] {
    const ready = this.done.splice(0, this.done.length);
    for (const n of ready) this.tasks.delete(n.bgId);
    return ready;
  }

  /** finish 前调用：等待全部在跑任务结算，返回全部剩余通知。 */
  async drain(signal?: AbortSignal): Promise<BackgroundNotification[]> {
    while (this.hasRunning()) {
      if (signal?.aborted) break;
      // 让出事件循环，等后台 Promise 推进；无忙等。
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return this.collect();
  }
}
```

**为什么不用锁**：Node 单线程，`settle` 与 `collect` 之间不存在 `await`，不会被抢占，`Map`/数组的读改写是原子的。草案的 `threading.Lock` 在此纯属噪声。

**为什么 `void ...then()` 而非裸 Promise**：不 await 的 Promise 若 reject 会触发 `unhandledRejection`。用 `.then(onOk, onErr)` 把成功和失败都收敛进 `done` 队列，异常也变成一条 `isError: true` 的通知，模型能看到「后台任务失败了」而非静默丢失。

### 4.2 通知的注入格式

沿用草案的 `<task_notification>` 语义，但**并入带 tool_result 的同一条 user 轮**（原生 tool-use 约束：user 轮不能连续两条，且每个 tool_use 必配 tool_result）。

在 `agent-runtime.ts` 回合开始、flush `pendingToolResult` 的位置扩展：

```ts
if (useNativeToolUse) {
  const notifications = bgManager.collect();
  const userTurn: AgentModelMessage = { role: "user" };

  if (pendingToolResult.current) {
    userTurn.toolResults = [{
      toolCallId: pendingToolResult.current.id,
      content: pendingToolResult.current.content,
      isError: pendingToolResult.current.isError,
    }];
    pendingToolResult.current = null;
  }
  if (notifications.length > 0) {
    userTurn.content = notifications.map(formatBackgroundNotification).join("\n");
  }
  if (userTurn.toolResults || userTurn.content) {
    nativeMessages.push(userTurn);
  }
}
```

> 需求：`AgentModelMessage` 已同时支持 `content` 与 `toolResults`（见 `gateway/types.ts:26-39`），且 `toAnthropicMessages` 对 `toolResults` 分支目前**只输出 tool_result 块、忽略 content**（`anthropic.ts:36-43`）。**这是必须改的一处**：当 `toolResults` 与 `content` 同时存在时，要把文本块一并放进同一条 user content 数组。openai.ts 的对应分支同样处理。

`formatBackgroundNotification`：

```
<task_notification>
  <task_id>bg_0001</task_id>
  <status>completed</status>
  <tool>Task</tool>
  <label>生成大纲</label>
  <result>...(截断到 ~500 字)...</result>
</task_notification>
```

### 4.3 后台判定 `shouldRunBackground`

显式请求优先，启发式兜底——但**按本域重定义**，且默认保守（宁可同步，避免误判打乱依赖链）。

```ts
// 仅这几个工具支持后台执行（其结果不阻塞 nativeMessages 结构、无副作用竞争）
const BACKGROUND_ELIGIBLE = new Set(["Task", "ExportPptx"]);

export function shouldRunBackground(toolName: string, args: Record<string, unknown>): boolean {
  if (!BACKGROUND_ELIGIBLE.has(toolName)) return false;
  if (args.run_in_background === true) return true;        // 模型显式请求
  // 启发式兜底：并行 Task（descriptions[] 多项）天然是最贵、最该后台化的
  if (toolName === "Task" && Array.isArray(args.descriptions) && args.descriptions.length > 1) {
    return true;
  }
  return false;
}
```

**排除项与理由**：
- `SubmitCommands` / `AskUser`：本身就是 finish 信号，后台化无意义。
- `TaskGraph*`、`Read*`、`ListSlides`：快操作，后台化只增加复杂度。
- `preview-slide` / `ExecuteExtraTool`：deferred，须经 `SearchExtraTools`→`ExecuteExtraTool` 两跳，暂不纳入首期（见 §7 未决问题）。

**`run_in_background` 参数如何暴露给模型**：给 `Task` 与 `ExportPptx` 的 `inputSchema` 增加可选布尔字段 `run_in_background`（`.optional().describe("true 时后台执行，主流程继续，结果稍后作为通知返回")`）。原生 tool-use 下模型可显式设置。

### 4.4 循环集成（`agent-runtime.ts`）

在工具执行分叉处（当前 `agent-runtime.ts:446` 的 `await tool.execute(...)`）改为：

```ts
if (shouldRunBackground(tool.name, args.data as Record<string, unknown>)) {
  const label = describeToolForBackground(tool.name, args.data);
  const bgId = bgManager.start({
    toolName: tool.name,
    label,
    run: () => tool.execute(args.data, context),
  });
  options.onProgress?.({ type: "background-started", toolName: tool.name, bgId, message: `后台任务 ${bgId} 已启动：${label}` });
  transcript.push({ role: "tool", toolName: tool.name, result: { background: bgId } });
  recordToolResult(`[Background task ${bgId} started] Result will arrive as a task_notification when complete. Continue with other independent work; do not block on it.`);
  continue;   // 不 await，进入下一步
} else {
  const result = await tool.execute(args.data, context);
  // ...现有同步路径原样保留...
}
```

**finish 前 drain**（正确性关键）——在三个 finish 出口前统一拦截：`message` 正常结束、`SubmitCommands`/`AskUser` 提前返回、以及 step-limit 兜底。逻辑：

```ts
// 模型给出 message 型最终回复，但仍有后台任务在跑 → 不能丢结果
if (bgManager.hasRunning() || bgManager.collect_peek()) {
  const notifications = await bgManager.drain(options.signal);
  if (notifications.length > 0) {
    nativeMessages.push({ role: "user", content: notifications.map(formatBackgroundNotification).join("\n")
      + "\n后台任务已全部完成，请基于以上结果给出最终回复或继续操作。" });
    continue;   // 再给模型一步消化
  }
}
return finish(normalized);
```

> 注意 `SubmitCommands` / `AskUser` 是硬 finish（`agent-runtime.ts:463`）。若此时仍有后台 `Task` 在跑，其结果将被丢弃——首期策略：**在 finish 前 drain 并将通知并入，但 SubmitCommands 的命令已定，通知仅记录/日志**。见 §7。

### 4.5 `run()` 内实例化

`bgManager` 在 `run()` 顶部创建（per-run），`finally` 块无需清理（随 run 生命周期 GC）；但 abort 时应停止注入新通知：drain 内已检查 `signal.aborted`。


---

## 5. 落地步骤（按依赖顺序，每步可独立验证）

| # | 改动 | 文件 | 验证 |
|---|------|------|------|
| 1 | 新增 `BackgroundTaskManager` + 通知格式化函数 | `runtime/background-task-manager.ts`（新） | 单测：start→settle→collect / drain / 失败转 isError 通知 |
| 2 | `shouldRunBackground` + `describeToolForBackground` | 同上文件或 `runtime/background-policy.ts`（新） | 单测：显式 flag、并行 Task 启发式、排除项 |
| 3 | `AgentModelMessage` 同时携带 `toolResults` + `content` 时正确合并 | `gateway/anthropic.ts:36-43`、`gateway/openai.ts` 对应分支 | 单测：断言生成的 content 数组含 tool_result 块 + text 块 |
| 4 | `Task` / `ExportPptx` schema 增加可选 `run_in_background` | `tools/core/task.ts`、`tools/deferred/export-pptx.ts` | typecheck + 现有工具测试不回归 |
| 5 | 循环集成：分叉执行 + 回合起始注入 + finish 前 drain | `runtime/agent-runtime.ts` | 集成测试（见 §6） |
| 6 | 进度事件：`background-started` / `background-finished` 透传 UI | `runtime-types.ts` 的 `onProgress`、`shared/agent-activity.ts`（可选新增 trace kind） | 手测 UI 或快照测试 |

**先做 1–3**（纯新增 + 一处 gateway 修复，零行为变更、可全绿），再做 4–5（接入循环），最后 6（UI 可视化，非必需可延后）。

---

## 6. 测试计划

沿用现有 `tests/native-tool-use.test.ts` 的 mock gateway 模式（gateway 声明 `supportsNativeToolUse()` 返回 true，脚本化多轮 toolCalls）。新增 `tests/background-tasks.test.ts`：

1. **不阻塞**：模型第 1 步发起后台 `Task`，第 2 步立刻发起 `ReadPresentationSnapshot`——断言两步之间主循环没有等待后台完成（后台 Promise 用可控 deferred 挂起）。
2. **通知注入**：后台任务在第 3 步前结算，断言第 3 步的 `nativeMessages` 里出现 `<task_notification>` 且 `bgId` 正确、只注入一次。
3. **finish 前 drain**：模型第 2 步就想 `message` 结束，但后台仍在跑——断言 drain 后模型多拿到一步、通知已注入、最终才 finish。
4. **失败转通知**：后台 `run` reject——断言生成 `status=failed` 且 `isError` 的通知，主循环不崩。
5. **回退路径**：mock gateway 不实现 `supportsNativeToolUse`（文本协议）——断言 `shouldRunBackground` 逻辑被跳过或安全降级为同步（首期后台仅在 native 路径启用）。
6. **配对不变量**：断言每个后台 `tool_use` 仍恰好回配一个 `tool_result`（占位串），不破坏原生 tool-use 的结构约束。

`npm run test`（排除 integration）须全绿；`npm run typecheck` 通过。

---

## 7. 未决问题（需你拍板）

1. **SubmitCommands 语义**：模型在后台 `Task` 未完成时就调 `SubmitCommands` 定稿。选项：
   - (A) 首期允许——drain 后仅日志记录后台结果，不回喂（后台 Task 结果对本次定稿无影响时正确）；
   - (B) 保守——若有后台任务在跑，`SubmitCommands` 被拦一步，先 drain+回喂再让模型确认定稿。
   倾向 **(B)**，语义最安全，代价是多一步。

2. **是否纳入 `preview-slide` / deferred 工具**：deferred 须走 `ExecuteExtraTool` 两跳，后台化要在 `ExecuteExtraTool` 内部判定而非顶层。首期建议**只做 core 的 `Task` + `ExportPptx`**，deferred 留二期。

3. **文本协议路径**（非 native gateway）是否也支持后台：文本协议每步一个 JSON、无 tool_use/tool_result 配对约束，注入方式不同。建议**首期仅 native 路径启用**，文本路径直接降级为同步（`shouldRunBackground` 在 `!useNativeToolUse` 时恒返回 false）。

4. **并发上限**：是否限制同时在跑的后台任务数（如 ≤3）避免一次 run 里 `descriptions[]` 炸开太多子 Agent？倾向加一个软上限，超出的同步执行。

5. **UI 呈现**：`background-started/finished` 是否需要在活动时间线（`agent-activity.ts`）画成独立卡片，还是先只发 `onProgress` 文本？倾向首期只发文本，UI 卡片二期。

---

## 8. 风险与规避

- **正确性 > 并发感**：最大风险是「模型以为后台结果已在手，实际还没回」。规避：占位 tool_result 明确写「结果稍后以 task_notification 返回，勿阻塞等待」；finish 前强制 drain 兜底，任何路径都不丢结果。
- **原生 tool-use 结构破坏**：user 轮连续两条、tool_use 无配对 tool_result 都会被 Anthropic 拒。规避：通知一律并入带 tool_result 的同一条 user 轮；§6 测试 6 专门守这个不变量。
- **未捕获 rejection**：不 await 的 Promise。规避：`start()` 内 `.then(onOk, onErr)` 双分支收敛，无裸 Promise。
- **abort 竞争**：run 被用户中断时后台 Promise 仍在跑。规避：drain 检查 `signal.aborted` 即停；后台任务本身接收同一个 `context.signal`，工具内部（如 `spawnSubAgent`）已支持中断。
- **per-run 隔离**：`bgManager` 必须在 `run()` 内实例化，绝不能模块级全局（会跨会话串话）——这是草案照搬 Python 全局 dict 的最大坑。

---

## 9. 一句话总结

保留草案「占位 tool_result + 后续 task_notification 注入」的核心思想，但把 Python 多线程模型换成**单线程不 await 的 Promise + per-run 管理器**，去掉无意义的锁，按本域（`Task`/`ExportPptx`）重定义启发式，并用 **finish 前强制 drain** 保证「异步不丢结果」。首期只在原生 tool-use 路径、core 工具上启用，风险可控、可全绿增量落地。

