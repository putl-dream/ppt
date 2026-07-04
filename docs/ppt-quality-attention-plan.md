# PPT 生成质量与模型注意力改进计划

> 版本：2026-07-05
> 状态：**P0-1 原生 tool-use 已落地**；P0-2 及 P1/P2 待排期
> 关联：[ppt-capability-status-plan.md](./ppt-capability-status-plan.md)（能力现状）、[ppt-style-capability-plan.md](./ppt-style-capability-plan.md)（样式方案）

---

## 1. 执行摘要

当前 Agent 工作流**能跑完整条链路并稳定落到 `SubmitCommands`**——流程是闭合的，一定有产出。但两个问题显著：

1. **成品 PPT 质量不佳**：版式单调、层级扁平、排版拥挤。
2. **模型注意力不集中、出现大量思考**：每步纠结格式与局部决策，推理开销大。

经排查，这两个问题**都是架构层面的结构性成因，不是模型能力问题**。本文档梳理根因并按性价比给出改进路线。

**结论**：流程能生成 PPT，但质量被四个结构性因素锁死；注意力问题主要由文本 JSON 协议与九阶段窄窗口造成。最高性价比的两项改动是 **原生 tool-use 改造** 与 **渲染反馈闭环**。

---

## 2. 现状链路回顾

```
AgentRuntime.run()
  ├─ probeWorkspaceArtifacts()   探测 brief/outline/storyboard/layout-plan
  ├─ resolvePromptStage()        计算 9 个阶段之一
  ├─ assembleSystemPrompt()      拼装 identity/tools/workspace/memory 四段
  └─ for step in maxSteps:
        模型返回单个文本 JSON → parseAgentJsonResponse 手写扫描
        tool_call → 仅 Core Tool 可直调；Deferred 须 Search→Execute 两跳
        message   → 结束（command_proposal 会拦截"口头描述未来工作"）
```

- **阶段机**：`prompt-stage.ts` 基于 deck 快照 + workspace 文件 + 请求分类推断 9 个阶段，每步重算。
- **提示词**：`prompt-sections.ts` 按阶段注入规则、技能白名单、命令示例；静态段（identity/tools）可缓存，动态段（workspace/memory）每次重算。
- **工具分层**：core 可直调；deferred 须发现后执行；runtime 仅系统内部。
- **两阶段建稿**：内容阶段禁 `set-theme`/`update-slide-layout`；排版阶段禁改写文案。

---

## 3. 质量差的根因（四项，均为架构层面）

### 3.1 没有视觉反馈闭环（最致命）

模型全程**看不到自己生成的幻灯片**。它输出 `layout: "concept"` + text 元素，真正的坐标、间距、配色由引擎 `applyLayout` 自动计算。`preview-slide` 仍是 deferred 工具，默认不加载。

结果：模型在**盲写**——不知道文字是否溢出、层级是否合理，也无法 render → critique → fix。没有观察就没有质量迭代，这是当前设计的最大天花板。`ValidateDeckLayout` 只做规则校验（节奏 / 重复），不等于"看见效果"。

### 3.2 版面是枚举驱动，质量上限 = 引擎模板质量

模型的全部视觉控制权就是从 11 个 layout 枚举挑一个 + variant（light/dark/hero）。真正决定观感的排版逻辑在引擎里。**只要引擎模板一般，模型再聪明输出也一般**。模型能"选对类型"，做不了"排得漂亮"。

### 3.3 两阶段 + Design Agent 委派 = 三次有损传话

```
内容 (context A) → layout-plan.json (子 Agent context B) → 执行 (主 Agent context C)
```

三个上下文各看局部，`layout-plan.json` 是一次有损序列化。子 Agent 被明令"结论 ≤3 句、不看全局"（见 `sub-system-prompt.ts`）。**没有任何一个上下文完整地对最终 deck 的整体观感负责**，质量死在交接缝里。

### 3.4 内容与排版强制解耦，但好排版恰恰依赖内容

`ppt-build` 强制"先写全、不压字数"，`ppt-layout` 又强制"不改文案只套版"。但一个 case 页放数字还是四栏文字、要点拆成 process 还是 concept，**本质是内容与版式的联合决策**。硬拆两阶段导致排版阶段拿到一堆"未考虑版式"的长文本，只能硬塞进模板 → 溢出、拥挤。

---

## 4. 注意力分散 + 大量思考的根因

### 4.1 文本 JSON 协议，而非原生 tool-use（核心）

`agent-runtime.ts` 中模型返回纯文本，再用 `parseAgentJsonResponse` 手写扫描 `{}`。系统提示强制"每步只返回一个 JSON 对象，不要 Markdown 包裹"。对 thinking 模型（当前跑 Opus thinking）这是**对抗性的**：

- 模型天然要推理，但输出被限制成裸 JSON，于是大量算力花在"想清楚 + 纠结格式合规" → 表现为"大量思考"。
- 一旦 JSON 崩了整步作废重来（`agent-runtime.ts:246`），进一步放大 thinking 开销。
- **原生 function calling 会让模型直接调工具**，格式由 API 保证，推理专注任务本身。此项对"注意力集中"收益最大。

### 4.2 九阶段机让模型每步只见树木

每步重算 stage，提示词只注入当前阶段规则与技能白名单。模型**从来看不到完整工作流与完整 deck 目标**，只能在窄窗口内局部决策 → 表现为"注意力不集中"。这不是分心，是**系统故意不给全局视野**。

### 4.3 发现-执行两跳（SearchExtraTools → ExecuteExtraTool）

每个美化/排版能力都要"先搜再执行"，凭空多一轮模型调用和推理，纯属注意力与步数的消耗。

---

## 5. 改进路线（按性价比排序）

| 优先级 | 改动 | 解决什么 | 主要触及 |
|--------|------|----------|----------|
| ~~**P0-1**~~ ✅ | 改用**原生 tool-use** 替代文本 JSON 协议 | 消除"大量思考"与 JSON 崩溃重试 | `agent-runtime.ts`、`gateway/*` |
| **P0-2** | 引入**渲染反馈闭环**：排版后自动 `preview-slide` 截图回喂模型，做一轮 critique → fix | 打破质量天花板 | `preview-slide`、runtime 回合 |
| **P1-1** | 提升引擎 layout 模板视觉质量（间距/层级/配色） | 抬高枚举驱动上限 | `design/layout-policy.ts`、渲染 |
| **P1-2** | 内容与版式**联合决策**（storyboard 阶段即标注 narrativeRole/layout 意图） | 减少排版阶段硬塞溢出 | `ppt-storyboard`、`prompt-stage` |
| **P2-1** | 合并阶段、给模型更多全局视野 | 减少窄窗口局部决策 | `prompt-stage.ts`、`prompt-sections.ts` |
| **P2-2** | 高频 Deferred 工具直接提升为 Core | 减少发现-执行两跳 | `tool-registry.ts` |

---

## 6. 建议的落地顺序

**推荐先做 P0-1（原生 tool-use 改造）**：同时压下"大量思考"与 JSON 重试两个问题，改动集中在 `agent-runtime.ts` + gateway 层，风险可控、收益立竿见影。

**若更在意成品观感，先做 P0-2（渲染反馈闭环）**：这是打破质量天花板的唯一途径——没有"看见效果"，任何其他优化都是盲调。

两项互相独立，可并行。P1/P2 建议在 P0 验证有效后再排期。

---

## 6.1 P0-1 落地记录（2026-07-05）

采用**双路径共存、增量扩展**策略，未改动任何现有文本协议行为，测试全绿（297 passed）。

**改动清单**：

| 文件 | 改动 |
|------|------|
| `gateway/types.ts` | 新增 `AgentToolSchema` / `AgentModelMessage` / `AgentModelToolCall` / `AgentModelToolResult`；`AgentModelRequest` 增量加可选 `tools` / `messages`；`AgentModelResponse` 与 stream chunk 加 `toolCalls`；接口加 `supportsNativeToolUse?()` 能力开关 |
| `tools/tool-schema.ts`（新增） | `toToolSchema` / `toToolSchemas`：用 zod v4 `z.toJSONSchema({unrepresentable:"any", io:"input"})` 把工具 inputSchema 转 JSON Schema，剥离 `$schema`，保证顶层 object |
| `gateway/anthropic.ts` | `request.tools` 存在时走原生分支：透传 tools、用 `messages` 构造 `tool_use`/`tool_result`、抽取 tool_use block；流式在 `finalMessage` 收敛 toolCalls |
| `gateway/openai.ts` | 统一用 Chat Completions 承载 tool-use（responses 模式的 tool schema 差异大）；流式降级非流式后在 complete chunk 挂 toolCalls |
| `gateway/index.ts` | `AgentGateway.supportsNativeToolUse()` 返回 true |
| `model-call-recovery.ts` | 透传 `tools` / `messages`；返回 `toolCalls`；返回工具调用即视为完整响应，跳过截断续写逻辑 |
| `agent-runtime.ts` | native 模式把 `toolCalls[0]` 归一成与文本协议一致的 `{type:"tool_call"}`，下游校验/hooks/执行/finish 全部复用；并行维护 `nativeMessages`（每个 tool_use 必配 tool_result，含校验失败/拒绝/报错路径）；流式文本直出不喂 JSON 抽取器 |

**关键设计**：`supportsNativeToolUse()` 能力开关——真实 gateway 返回 true 走原生；测试 mock 无此方法自动回退文本路径，零破坏。

**测试**：新增 `tests/native-tool-use.test.ts`（schema 转换 + 结构化 toolCall 多轮循环 + 无工具纯文本回复）。

**遗留**：Anthropic 流式的 tool_use 目前依赖 `finalMessage()` 一次性收敛，未做增量 `input_json_delta` 逐块回显（不影响正确性，仅工具参数不流式展示）。

---

## 7. 待确认问题

1. 当前 gateway（`gateway/anthropic.ts`、`gateway/openai.ts`）是否已支持原生 tool-use 的请求/响应结构？改造范围需据此评估。
2. `preview-slide` 截图能力当前完成度如何（能否稳定产出可回喂模型的图像）？决定 P0-2 的启动成本。
3. 是否接受在 storyboard 阶段引入轻量版式意图标注，作为 P1-2 的前置？
