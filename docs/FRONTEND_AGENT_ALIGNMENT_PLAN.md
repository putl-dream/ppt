# 前端工作台与 Agent 能力对齐计划

## 背景

项目已经从早期“对话驱动生成 PPT”的形态，迭代到“以项目沙箱为核心的 PPT 创作工作台”。这意味着前端不再只是承载聊天输入和 PPT 预览，而要成为用户管理创作阶段、文件产物、Agent 建议和最终 Deck 生成的主界面。

当前后端 Agent 会话能力已经形成基本闭环：

- `FileSessionStore` 负责会话、消息、转录链、项目沙箱和 PPT 快照持久化。
- `AgentService` 负责 Agent Runtime、Commit Gate、审批恢复和 `CommandBus` 写入。
- `AgentRuntime` 已具备核心工具、延迟工具、流式文本、`ask_user`、`command_proposal` 等运行协议。
- `ProjectFileService` 已能读写项目沙箱文件、计算 artifact diff、传播下游 stale 状态。

但前端工作台已经演化成「Brief / Outline / Research / Design / Slides / Deck」多阶段产物编辑体验，两者还没有真正打通。现在前端更多是在本地 React 状态和 `localStorage` 中模拟项目产物，后端 Agent 则主要围绕会话消息和 PPT `PresentationCommand` 工作，导致事实源、审批对象、运行进度和用户预期不一致。

本文档用于重新校准方向和目标：把 Agent 会话能力接入真实的文件原生工作台，而不是继续叠加临时模拟逻辑。

## 方向校准

### 原方向的问题

早期产品更像一个“聊天触发的 PPT 自动生成器”：

```txt
用户输入需求
  -> Agent 生成大纲或 PPT 命令
  -> 前端展示审批
  -> 后端应用 PresentationCommand
  -> PPT 预览更新
```

这条链路可以验证最小闭环，但不适合真实 PPT 创作。真实创作会反复修改目的、受众、大纲、资料、逐页方案、设计风格和最终 Deck。如果这些中间产物只存在于前端状态、聊天消息或一次性 workflow 中，用户无法稳定地管理、回溯和复用它们。

### 新方向

新的产品方向是：

> 以前端工作台为入口，以项目沙箱文件为事实源，以 Agent 为协作执行者，围绕阶段产物持续推进 PPT 创作。

这意味着：

- 前端展示的 Brief、Outline、Research、Design、Slides、Deck 都必须来自真实项目文件。
- Agent 不再只回答聊天或直接生成 PPT 命令，而要能围绕当前阶段读取文件、提出 patch、等待确认并写回沙箱。
- PPT 生成是产物链路的最后阶段，而不是所有请求的默认落点。
- 审批对象要从单一 `PresentationCommand[]` 扩展为文件 patch 与 PPT command 两类变更。
- 所有可见能力都应可追踪、可恢复、可审阅，避免“看起来能用、实际只改本地状态”的假入口。

## 当前链路梳理

### 后端已有能力

关键文件：

- `src/main/index.ts`
  - 暴露 `session:*`、`presentation:*`、`agent:*` IPC。
  - 运行时按 session 隔离：每个 session 拥有自己的 `CommandBus` 和 `AgentService`。
  - Agent 入口包括 `agent:start`、`agent:continue`、`agent:confirm-outline`、`agent:resume`。

- `src/main/session-store.ts`
  - 会话快照包含 `session`、`project`、`transcript`、`presentation`、`messages`。
  - 已有项目文件能力：`listProjectArtifacts`、`readProjectArtifact`、`writeProjectArtifact`、`getProjectArtifactDiff`、`markProjectArtifactStatus`。
  - 这些能力目前未通过 IPC 暴露给 renderer。

- `src/main/project/project-file-service.ts`
  - 支持项目沙箱文件读写。
  - 支持目录读取、路径越界保护、artifact diff、下游 stale 传播。

- `src/main/agent/service.ts`
  - Agent 结果类型集中在 chat、outline-required、approval-required、completed、rejected。
  - 对真实 PPT 的写入只通过 `PresentationCommand` 和 Commit Gate。
  - `ask_user` 被映射为 outline-required。

- `src/shared/ipc.ts`
  - `DesktopApi` 已覆盖 session、presentation、agent、export。
  - 缺少 project artifact 的 IPC 契约。
  - `AgentRunResult` 缺少 artifact patch、stage progress、tool activity、file diff 等前端工作台需要的结构。

### 前端已有能力

关键文件：

- `src/renderer/src/App.tsx`
  - 维护会话、PPT、聊天、审批、大纲确认、模型选择、阶段工作区等状态。
  - 首次发送消息时可从草稿创建 session。
  - `startAgent` 仍主要面向 Agent 文本请求和 PPT 命令结果。

- `src/renderer/src/components/project-store.ts`
  - 使用 Zustand 维护阶段产物。
  - artifact 内容从 `localStorage` 恢复。
  - 内置默认内容和本地 stale 传播。
  - `proposePatch`、`acceptPatch`、`rejectPatch` 只在前端内存和 localStorage 中生效。

- `src/renderer/src/components/ContextualAgentPanel.tsx`
  - 能感知当前阶段，展示 stale 提示和上下文 placeholder。
  - 但提交给 Agent 的仍是普通请求，没有结构化传递当前阶段和 artifact 上下文。

- `src/renderer/src/components/UnifiedAgentInput.tsx`
  - 组装了 `compositePayload`，包含 prompt、策略、模型、项目目录等。
  - 当前父组件回调签名没有消费该 payload，实际 Agent IPC 仍接收普通字符串。
  - 上传、语音、项目目录选择等为模拟行为。

## 不适配点

### 1. 项目产物有两套事实源

后端已在 session project sandbox 中创建并维护真实文件：

- `brief.md`
- `outline.md`
- `research/`
- `slides/`
- `design/`
- `deck/`
- `history/`

前端却用 `project-store.ts` 的默认内容和 `localStorage` 作为主要事实源。结果是：

- 前端编辑不会写入真实项目沙箱。
- 后端 stale 状态不会准确反映到前端内容。
- Agent 无法基于前端实际编辑内容可靠运行。
- 关闭、切换 session、迁移环境时会出现内容不一致。

### 2. IPC 能力没有覆盖项目文件工作流

`FileSessionStore` 已有项目文件读写能力，但 `DesktopApi` 没有暴露：

- list artifacts
- read artifact
- write artifact
- get artifact diff
- mark artifact status
- accept / reject artifact patch

因此前端只能自己模拟 patch 和状态。

### 3. Agent 请求缺少阶段上下文

前端有当前阶段、当前产物、选中 slide、选中 element、模型、策略、项目目录等信息，但 Agent 请求实际只有：

- `request: string`
- `model`
- `executionStrategy`
- `runId`
- `editorContext`

这不足以表达：

- 当前请求作用于 brief、outline、research、design、slides 还是 deck。
- 需要读取哪些项目文件作为上下文。
- 用户希望产出 artifact patch、PPT command proposal，还是纯聊天建议。
- 用户上传的资料或选中的引用素材是什么。

### 4. Agent 结果类型偏向 PPT 命令，不适合多阶段文件产物

现有 `AgentRunResult` 中只有 `approval-required` 可以承载变更审阅，但审批对象是 `PresentationCommand[]`。对于 Brief、Outline、Research、Design、Slides 这些文件产物，前端需要的是：

- 目标文件路径。
- 修改前后内容。
- diff。
- 影响的下游 artifact。
- 是否需要用户确认。
- 接受后写入项目沙箱，而不是执行 PPT command。

当前只能在 `App.tsx` 中用 `proposePatch` 手动模拟 outline patch。

### 5. 流式事件粒度不足

现有 `AgentStreamEvent` 只有：

- `request-status`
- `workflow-progress`
- `text-chunk`

前端工作台需要更具体的运行态：

- 当前阶段任务。
- 正在读取或写入的 artifact。
- 工具调用摘要。
- diff 准备中、等待审批、已应用。
- 可取消、可重试、可恢复的 run 状态。

### 6. 前端存在多处占位能力

以下能力目前主要是演示效果：

- 文件上传按钮只触发 toast。
- 语音输入为定时追加文本。
- 项目目录选择使用 `prompt`，未关联后端项目路径。
- 全局一键美化直接改本地 React 状态，没有通过 `CommandBus` 和持久化。
- 输入框组装的 `compositePayload` 没有被使用。

这些能力会让用户误以为已接入 Agent 或文件系统，实际结果不可恢复或不可追踪。

## 目标状态

### 产品目标

前端工作台成为 PPT 创作的主操作面。用户在 Brief、Outline、Research、Design、Slides、Deck 任一阶段发起请求时，Agent 都能理解当前阶段、读取相关项目文件，并生成可审阅的文件 patch 或 PPT command proposal。

用户确认后，变更统一由主进程写入真实项目沙箱或 PPT 快照，并同步刷新会话、artifact 状态、预览和聊天记录。

最终体验应接近：

```txt
用户在某个阶段提出修改
  -> 前端提交结构化 AgentRunRequest
  -> 后端读取相关 artifact
  -> Agent 生成文件 patch 或 PPT command proposal
  -> 前端展示 diff / 审批
  -> 用户确认
  -> 主进程写入项目沙箱或 deck snapshot
  -> 前端刷新状态与预览
```

### 体验目标

- 用户能清楚知道当前正在编辑哪个阶段产物。
- 用户能看到 Agent 正在读取、分析或准备修改哪些文件。
- Agent 产出的修改必须先可审阅，再写入真实文件或 PPT。
- 切换 session、重启应用后，项目文件、消息、PPT 快照保持一致。
- 前端不再用模拟数据制造“已经接入后端”的错觉。

### 技术目标

- 单一事实源：
  - 项目 artifact 内容以主进程项目沙箱文件为准。
  - renderer 只缓存当前展示状态，不再把 `localStorage` 作为产物持久化事实源。

- 统一请求契约：
  - Agent 输入从 `request: string` 扩展为结构化 `AgentRunRequest`。
  - 包含 session、stage、artifact、selection、model、strategy、attachments、intent。

- 统一变更契约：
  - PPT 变更继续走 `PresentationCommand` + Commit Gate。
  - 文件产物变更走 `ArtifactPatch` + diff review + project write。

- 可恢复运行态：
  - pending outline、pending approval、pending artifact patch 都能进入消息和 transcript。
  - 应用重启后无效的运行审批明确过期，不留下可点击的假按钮。

### 非目标

- 不在这一轮重写整个 UI。
- 不一次性移除旧 `PresentationCommand` 和 Commit Gate 链路。
- 不让 renderer 直接读写任意本地文件。
- 不把上传、语音、目录选择等模拟入口继续包装成真实能力。
- 不让 Agent 绕过 diff review 直接改写 brief、outline、research、design 或 slides。

## 建议契约设计

### 新增 Project IPC

在 `src/shared/ipc.ts` 扩展：

```ts
export interface ProjectArtifactReadResult {
  path: string;
  type: "file" | "directory";
  content?: string;
  entries?: string[];
}

export interface ArtifactDiff {
  path: string;
  before: string;
  after: string;
  changed: boolean;
  unifiedDiff: string;
}

export interface ProjectArtifactWriteResult {
  path: string;
  changed: boolean;
  changedArtifactId?: string;
  staleArtifactIds: string[];
}

export interface DesktopApi {
  listProjectArtifacts(sessionId: string): Promise<ProjectArtifact[]>;
  readProjectArtifact(sessionId: string, artifactIdOrPath: string): Promise<ProjectArtifactReadResult>;
  writeProjectArtifact(sessionId: string, relativePath: string, content: string): Promise<ProjectArtifactWriteResult>;
  getProjectArtifactDiff(sessionId: string, relativePath: string, nextContent: string): Promise<ArtifactDiff>;
  markProjectArtifactStatus(sessionId: string, artifactId: string, status: ProjectArtifactStatus): Promise<ProjectArtifact>;
}
```

主进程在 `src/main/index.ts` 添加对应 `project:*` handlers，preload 在 `src/preload/index.ts` 暴露。

### 统一 Agent 请求

建议新增：

```ts
export type AgentIntent =
  | "chat"
  | "generate-artifact"
  | "revise-artifact"
  | "generate-deck"
  | "revise-deck";

export interface AgentRunRequest {
  prompt: string;
  sessionId: string;
  intent: AgentIntent;
  stage: "brief" | "outline" | "research" | "design" | "slides" | "deck";
  targetArtifactId?: string;
  targetPath?: string;
  referencedArtifactIds?: string[];
  editorContext?: AgentEditorContext;
  attachments?: Array<{
    id: string;
    name: string;
    path: string;
    mimeType?: string;
  }>;
}
```

兼容策略：

- 保留旧 `startAgentRun(request: string, ...)` 一段时间。
- 新增 `startAgentRunV2(request: AgentRunRequest, model?, strategy?, runId?)`。
- 稳定后移除旧入口或在前端内部统一适配。

### 新增 Artifact Patch 结果

建议扩展 `AgentRunResult`：

```ts
export interface AgentArtifactPatchRequest {
  threadId: string;
  targetPath: string;
  summary: string;
  before: string;
  after: string;
  diff: ArtifactDiff;
  changedArtifactId?: string;
  staleArtifactIds: string[];
  risk?: "low" | "medium" | "high";
}

export type AgentRunResult =
  | { status: "chat"; message: string }
  | { status: "outline-required"; outlineRequest: AgentOutlineRequest }
  | { status: "artifact-patch-required"; patch: AgentArtifactPatchRequest }
  | { status: "approval-required"; approval: AgentApprovalRequest }
  | { status: "completed"; presentation: Presentation }
  | { status: "artifact-updated"; write: ProjectArtifactWriteResult }
  | { status: "rejected"; presentation?: Presentation };
```

前端 `DiffReviewZone` 应优先消费 `artifact-patch-required`，接受后调用 project write 或新增 `agent:resume-artifact-patch`。

## 分阶段执行计划

### Phase 0：对齐边界与清理假入口

目标：先建立能力地图，避免继续把模拟功能伪装成真实能力。

任务：

1. 在 UI 上明确标注或隐藏尚未接入的能力：
   - 文件上传。
   - 语音输入。
   - 项目目录选择。
   - 全局一键美化。

2. 梳理并固定 artifact ID 与 kind 映射：
   - renderer 使用 `slides`。
   - shared schema 中 kind 为 `slide-plan`。
   - 后端 artifact path 中 `research/`、`slides/`、`design/`、`deck/` 是目录，前端默认 path 目前偏向单文件。

3. 写一组契约测试或类型测试，确保 shared schema、renderer store 和 project schema 不再漂移。

验收标准：

- 没有未接入能力看起来像真实已执行。
- artifact ID、kind、path 映射有单一文档或共享 helper。
- `npm run typecheck` 通过。

### Phase 1：打通 Project Artifact IPC

目标：让前端阶段工作区读写真实项目沙箱。

任务：

1. 扩展 `src/shared/ipc.ts` 的 `DesktopApi`。
2. 在 `src/main/index.ts` 添加：
   - `project:list-artifacts`
   - `project:read-artifact`
   - `project:write-artifact`
   - `project:get-artifact-diff`
   - `project:mark-artifact-status`
3. 在 `src/preload/index.ts` 暴露对应方法。
4. 修改 `project-store.ts`：
   - 初始化时从 `SessionSnapshot.project.artifacts` 得到 metadata。
   - 内容通过 `readProjectArtifact` 拉取。
   - 用户编辑通过 debounce 调用 `writeProjectArtifact`。
   - stale 状态使用后端返回结果更新。
   - `localStorage` 只可作为短期草稿缓存，不能作为事实源。
5. 为 `FileSessionStore` 的 project 方法补 IPC 集成测试或主进程 handler 单元测试。

验收标准：

- 切换 session 后，Brief / Outline / Research 等显示真实沙箱内容。
- 编辑某个 artifact 后，磁盘项目文件被更新。
- 下游 artifact stale 状态来自后端。
- 重启应用后内容与状态可恢复。

### Phase 2：统一前端 Agent 输入

目标：让 Agent 知道用户当前在哪个阶段、要改什么文件、引用哪些上下文。

任务：

1. 新增 `AgentRunRequest` 类型。
2. 修改 `UnifiedAgentInput`：
   - 不再生成未消费的 `compositePayload`。
   - 只负责收集输入和 UI 控制。
3. 在 `App.tsx` 或独立 adapter 中组装 `AgentRunRequest`：
   - `sessionId`
   - `currentStage`
   - `targetArtifactId`
   - `targetPath`
   - `referencedArtifactIds`
   - `editorContext`
   - `intent`
4. `ContextualAgentPanel` 根据 currentStage 设置 intent：
   - `brief`、`outline`、`research`、`design`、`slides` 默认为 artifact 生成或改写。
   - `deck` 默认为 PPT command proposal。
5. 主进程 Agent handler 支持 V2 请求，并在运行前读取必要 artifact 内容注入 Agent context。

验收标准：

- 同一句“帮我精简内容”在 outline 阶段修改 `outline.md`，在 deck 阶段生成 PPT 命令。
- Agent 日志能看到 stage、targetPath、referencedArtifactIds。
- 旧字符串入口仍可兼容基础聊天。

### Phase 3：支持 Artifact Patch 生成与审阅

目标：让 Agent 能对阶段文件提出 diff，而不是只能生成 PPT commands。

任务：

1. 扩展 runtime 输出协议：
   - `artifact_patch`
   - 包含 `targetPath`、`summary`、`content` 或 `patch`。
2. 在 `AgentService` 中处理 artifact patch：
   - 读取 before。
   - 计算 diff。
   - 返回 `artifact-patch-required`。
   - 记录 pending patch。
3. 新增 resume 入口：
   - `agent:resume-artifact-patch(threadId, approved)`
   - approved 时调用 `writeProjectArtifact`。
   - rejected 时清理 pending patch。
4. 修改 `DiffReviewZone`：
   - 展示真实 unified diff。
   - 接受后调用后端 resume 或 write。
   - 拒绝后写入聊天状态。
5. 扩展 `SessionChatMessage` metadata：
   - 支持 `artifactPatch`。
   - transcript 可恢复 pending patch 或在重启后标记过期。

验收标准：

- Agent 修改 brief / outline / design 时先进入 diff review。
- 用户接受后真实文件更新，状态传播。
- 用户拒绝后文件不变。
- 应用重启后 pending patch 不会保留可误点的应用按钮。

### Phase 4：把 Deck 生成接入项目产物链

目标：Deck 阶段从 artifacts 生成 PPT，而不是只依赖聊天历史。

任务：

1. Deck 生成时读取：
   - `brief.md`
   - `outline.md`
   - `research/notes.md`
   - `slides/`
   - `design/theme.json`
2. 将这些内容构造成 Agent Runtime 上下文。
3. 继续使用 `PresentationCommand` 和 Commit Gate 保护 PPT 写入。
4. `savePresentation` 后同步写入 `deck/snapshot.json`。
5. 接受 deck 变更后将 `deck` artifact 标记为 ready，并写 history 记录。

验收标准：

- Deck 阶段生成出的 PPT 与上游 artifact 内容一致。
- 改动 brief 或 outline 后 deck 自动 stale。
- 重新生成 deck 后 snapshot 与当前 `presentation` 一致。

### Phase 5：完善运行态与前端体验

目标：让用户能看懂 Agent 正在做什么，并能安全中断或恢复。

任务：

1. 扩展 `AgentStreamEvent`：
   - `stage-started`
   - `artifact-read`
   - `artifact-diff-ready`
   - `tool-started`
   - `tool-finished`
   - `approval-waiting`
2. 在 `ContextualAgentPanel` 中展示阶段化进度，而不是只展示通用“正在编排方案”。
3. 增加 run cancel：
   - 前端按钮。
   - 主进程 abort signal。
   - runtime/gateway 支持中断。
4. 增加并发保护：
   - 同 session 同一时间只允许一个 active run。
   - 切换 session 时不丢失其他 session 的运行状态，或明确禁止切换。
5. 将运行错误落入消息流，避免只显示 toast。

验收标准：

- 用户能看到 Agent 正在读哪个文件、准备哪个 diff、等待哪个确认。
- 用户能取消长任务。
- 错误可在对话中追踪并重试。

### Phase 6：真实化上传、目录和导出能力

目标：替换剩余模拟入口。

任务：

1. 上传：
   - 使用 Electron dialog 选择文件。
   - 复制到 `research/assets/` 或引用到 session attachments。
   - 对 PDF/Word/图片先记录 metadata，后续再接解析器。
2. 项目目录：
   - 若允许自定义 root，需要主进程提供设置项和迁移策略。
   - 否则移除前端“锚定目录”入口，只展示实际 sandbox path。
3. 语音：
   - 未接真实语音服务前隐藏。
   - 接入后输出普通 prompt，不直接伪造 Agent 运行。
4. 一键美化：
   - 改为 deck 阶段 Agent 请求。
   - 输出 `PresentationCommand` proposal。

验收标准：

- 所有可点击能力都有真实后端效果。
- 文件进入项目沙箱后可被 Agent 引用。
- 导出物和 history 可追踪。

## 推荐实施顺序

1. Phase 1：Project Artifact IPC。
2. Phase 2：AgentRunRequest V2。
3. Phase 3：Artifact Patch 审阅。
4. Phase 4：Deck 生成读取 artifacts。
5. Phase 5：运行态增强。
6. Phase 6：替换模拟入口。

原因：

- 没有真实 project IPC，前端阶段工作区无法成为事实源。
- 没有结构化 Agent 请求，runtime 无法理解当前阶段。
- 没有 artifact patch，diff review 只能继续模拟。
- Deck 生成必须建立在前面三个能力之上。

## 测试计划

### 单元测试

- `ProjectFileService`
  - 路径越界保护。
  - 文件读写。
  - 目录读取。
  - stale 传播。
  - diff 生成。

- shared schemas
  - `AgentRunRequest`
  - `AgentArtifactPatchRequest`
  - `SessionChatMessage` metadata。

- `project-store`
  - 从后端 metadata 初始化。
  - 写入结果更新状态。
  - 不再依赖 localStorage 作为事实源。

### 集成测试

- IPC project handlers：
  - create session 后 list/read/write artifact。
  - write brief 后 outline/slides/deck stale。

- Agent artifact patch：
  - outline 阶段请求返回 patch。
  - accept 后文件更新。
  - reject 后文件不变。

- Deck command proposal：
  - deck 阶段请求返回 approval。
  - approve 后 `presentation` 和 `deck/snapshot.json` 同步。

### 手工回归

- 新建草稿，首次提交后创建 session。
- 切换 session 恢复不同项目文件。
- 编辑 Brief 后 Outline/Slides/Deck 状态变化。
- Agent 修改 Outline，DiffReviewZone 审阅并接受。
- Agent 生成 Deck，审批后 PPT 预览更新。
- 重启应用后消息、文件、PPT 快照一致。

## 风险与注意事项

- 不要把 API key、模型配置密钥或上传文件敏感内容写入 transcript、renderer state 或 logs。
- `artifactPatch` 若进入 transcript，只保存必要摘要和路径；大文件内容可通过项目文件读取，避免日志膨胀。
- `localStorage` 迁移要小心：已有用户本地草稿可能只存在 renderer，需要提供一次性迁移或明确丢弃策略。
- `AUTO` 策略对 artifact patch 是否自动应用需要单独定义。建议第一阶段所有文件 patch 都要求确认。
- 大文件和目录读取要加大小限制，避免一次性把整个项目目录塞进模型上下文。
- 多 session runtime 已存在隔离，但 pending patch、pending approval、cancel signal 也必须按 session/thread 隔离。

## 第一批落地任务清单

建议先开一个小 PR 完成 Project IPC 和前端事实源迁移的基础骨架：

1. 在 `src/shared/ipc.ts` 增加 project 相关类型和 `DesktopApi` 方法。
2. 在 `src/preload/index.ts` 暴露 `project:*` invoke。
3. 在 `src/main/index.ts` 添加 handler，并调用 `FileSessionStore` 现有方法。
4. 改造 `project-store.ts`，增加 async hydrate/write action，保留当前同步 action 作为 UI 临时状态。
5. 在 `App.tsx` 的 `applySessionState` 后加载 artifact 内容。
6. 让 `BriefFormCollector` 和 `DraggableOutlineTree` 的保存动作写入后端。
7. 添加 project IPC 测试和 `npm run typecheck` 校验。

完成这一批后，前端工作台会先拥有真实文件事实源。随后再接 AgentRunRequest V2 和 Artifact Patch，收益最大，风险也最低。
