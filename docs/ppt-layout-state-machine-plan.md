# PPT 排版状态机优化方案

> 状态：实施中  
> 目标：把“模型自由发挥的排版流程”改成“状态机 + 结构化产物 + 校验器 + 执行器”。

## 1. 根问题

当前排版日志暴露的最大问题不是模型反复读取或推理，而是中间产物没有成为唯一事实源。

坏路径：

```text
Task 写 slides/layout-plan.json
  ↓
Task 只返回：路径 + layout 种类数
  ↓
主 Agent 没有真正消费 plan
  ↓
主 Agent 凭当前上下文重新猜 layout 并 SubmitCommands
```

这会让 Design Agent 的设计阶段失效；一旦上下文压缩，主 Agent 更容易丢失 plan 细节并重新判断。

## 2. 目标状态机

```text
snapshot
  ↓
slides/layout-plan.json
  ↓
ExecuteLayoutPlan
  ├─ parseLayoutPlan
  ├─ validateLayoutPlanAgainstPresentation
  ├─ validateLayoutPlan
  ├─ validateLayoutPlanRhythm
  └─ buildLayoutPlanCommands
      ↓
command_proposal
      ↓
render feedback / commit gate / deck-review
```

关键原则：

- `slides/layout-plan.json` 是 layout 决策唯一事实源。
- Design Agent 只做设计决策并写 plan，禁止 `SubmitCommands`。
- Executor 不重新推理版式，不手写 theme/layout 命令。
- 执行命令只能由 `buildLayoutPlanCommands` 从已校验 plan 生成。

## 3. 结构化产物契约

`layout-plan.json` 必须满足：

- `slides[]` 与当前 `ReadPresentationSnapshot` 一一对应。
- slide 数量一致。
- slideId 一致。
- slide 顺序一致。
- theme / palette / styleMode 明确。
- 每页包含 `narrativeRole`、`layout`、`rationale`。
- `enhancements` 只能使用 schema 中可执行类型。

不可执行的氛围描述只能进入 `designNotes` 或 `rationale`，不能进入 commands。

## 4. 校验分层

硬性约束：

- 至少 3 种 layout。
- 无连续 3 页完全相同 layout。
- 具备 cover / section / summary。
- plan 与 snapshot 完全对齐。

审美约束：

- 8 页文档模式建议 3–5 种 layout。
- 主内容页 layout 不超过 3 种。
- 同类内容优先复用同类 layout。
- 用 `slideVariant` 做轻微节奏变化，不追求每页完全不同。

硬性错误阻断执行；审美问题作为 warning 暴露给模型和测试，不阻断 v1 执行。

## 5. 执行入口

新增 Core Tool：`ExecuteLayoutPlan`。

默认输入：

```json
{ "path": "slides/layout-plan.json" }
```

行为：

1. 从 workspace 读取 layout-plan。
2. 解析 schema。
3. 校验 plan 与当前 presentation snapshot 对齐。
4. 执行 Rubric 和节奏校验。
5. 若存在 error，返回结构化阻断结果，要求修复或重建 plan。
6. 若无 error，生成本地 `command_proposal` 结果。

这样即使 Task 仍只返回短结论，主流程也能消费实际文件，而不是依赖聊天上下文。

## 6. v1 边界

本轮不改变 `Task` 的全局返回契约：子 Agent 仍只返回 conclusion，避免影响 brief / outline / storyboard。

本轮先让 `ExecuteLayoutPlan` 处理核心命令：

- `set-theme`
- `update-slide-layout`
- `update-slide-variant`

`layout-plan.enhancements` 继续由后续 `ExecuteExtraTool` 处理；未来可以并入统一 executor。
