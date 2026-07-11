# 前端 App 控制层后续拆解方案

## 1. 背景与当前基线

前端已经完成第一阶段拆分：工作台布局、通知、应用壳层、Workspace/Settings 视图和设置控制器均已从 `App.tsx` 抽离。

当前基线：

| 指标 | 拆分前 | 当前 |
|------|--------|------|
| `App.tsx` 行数 | 2179 | 1769 |
| `App.tsx` 本地状态 | 49 | 29 |
| `App.tsx` effect | 17 | 6 |

已形成的模块：

- `app/AppShell.tsx`：窗口标题栏、通知视口和工作区容器。
- `app/WorkspaceView.tsx`：左侧导航、对话区、PPT 预览与分栏。
- `app/SettingsView.tsx`：设置导航和设置控制台组合。
- `app/useWorkbenchLayout.ts`：折叠、拖拽、宽度约束与布局持久化。
- `app/useNotificationCenter.tsx`：全局通知生命周期。
- `app/useSettingsController.ts`：模型、主题、外观、生成参数及其持久化。

剩余复杂度主要集中在两条链路：

1. 工作区、会话、沙箱、项目产物和启动恢复。
2. 对话消息、Agent 流式运行、权限、问题卡片和 PPT 同步。

## 2. 最终目标

`App.tsx` 最终只作为 Composition Root，负责：

- 初始化顶层控制器。
- 将控制器提供的 view model 传给视图。
- 连接少量跨域事件。
- 渲染 loading/error/主界面三种根状态。

目标指标：

| 指标 | 目标 |
|------|------|
| `App.tsx` 行数 | 200–350 |
| `App.tsx` 本地状态 | 不超过 5 个 |
| `App.tsx` effect | 不超过 2 个 |
| Agent stream event 分支 | 不出现在 `App.tsx` |
| `desktopApi` 直接调用 | 仅存在于 controller/service 层 |

目标目录结构：

```text
src/renderer/src/app/
├─ AppShell.tsx
├─ WorkspaceView.tsx
├─ SettingsView.tsx
├─ appContracts.ts
├─ useNotificationCenter.tsx
├─ useWorkbenchLayout.ts
├─ useSettingsController.ts
├─ useWorkspaceController.ts
├─ usePresentationController.ts
├─ useChatController.ts
├─ useAgentRunController.ts
├─ agent/
│  ├─ agentRunReducer.ts
│  ├─ agentStreamReducer.ts
│  ├─ agentResultHandlers.ts
│  └─ agentRunPorts.ts
└─ workspace/
   ├─ sessionStateReducer.ts
   ├─ sessionSnapshotMapper.ts
   └─ workspacePorts.ts
```

## 3. 拆分原则

### 3.1 按状态所有权拆，不按代码段拆

每个状态只能有一个 owner。视图只接收值和 action，不得复制 controller 状态。

例如：

- `activeSessionId` 只能由 `useWorkspaceController` 管理。
- `presentation` 和 `selectedSlideId` 只能由 `usePresentationController` 管理。
- `busy`、`activeRunId`、权限等待状态只能由 `useAgentRunController` 管理。
- `chatMessages` 只能由 `useChatController` 管理。

### 3.2 控制器之间通过 port/event 协作

禁止 controller 互相 import 并直接调用内部 setter，否则只是把单体 App 变成循环依赖的 hooks。

推荐：

```ts
interface AgentRunPorts {
  getActiveSessionId(): string | null;
  getProjectContext(): ProjectContext | null;
  replacePresentation(next: Presentation): void;
  appendAssistantMessage(message: ChatMessage): void;
  notify(message: string): void;
}
```

依赖方向保持为：

```text
App Composition Root
├─ controller
│  ├─ reducer / pure helpers
│  └─ ports
├─ desktopApi adapter
└─ view
```

视图不能依赖 `desktopApi`，纯 reducer 不能依赖 React、Electron 或 Zustand。

### 3.3 优先 reducer，避免继续堆叠 `useState`

Agent 与会话恢复具有明确状态转换，适合 reducer/state machine：

```ts
type AgentRunState =
  | { status: "idle" }
  | { status: "running"; runId: string; trace: AgentActivityItem[] }
  | { status: "awaiting-tool-approval"; runId: string; approvalId: string }
  | { status: "awaiting-question"; runId: string; questionId: string }
  | { status: "cancelling"; runId: string }
  | { status: "failed"; error: string };
```

不要继续使用 `busy + activeRunId + isCancellingRun + pendingApproval` 等布尔组合表达状态。

### 3.4 不建立全局万能 Store

工作台布局、通知、会话、Agent 运行仍优先使用局部 controller。现有 Zustand project store 继续承担项目产物领域状态，不应扩大为整个前端的全局状态容器。

只有满足以下条件才考虑进入全局 store：

- 至少三个无共同父组件的区域需要读写。
- 状态需要跨页面/跨会话长期保留。
- 状态无法通过明确的 controller port 表达。

## 4. 后续实施阶段

### 4.1 Phase 2：抽离 Workspace/Session Controller

#### 目标

把启动加载、会话列表、当前会话、沙箱绑定和会话切换从 `App.tsx` 移入 `useWorkspaceController`。

#### 迁移状态

- `startupError`
- `sessions`
- `activeSessionId`
- `sessionLoaded`
- `isSessionSwitching`
- `isDraftChat`
- `workspacePath`
- `localStoragePath`

#### 迁移行为

- `enterDraftChat`
- `applySessionState`
- `handleNewSession`
- `handleNewSessionInWorkspace`
- `handleSelectSession`
- `handleDeleteSession`
- `handleSelectWorkspaceFolder`
- `handleOpenWorkspace`

#### 必须先抽出的纯函数

- `sessionSnapshotMapper.ts`：把 `SessionBootstrap` 映射为前端 session state。
- `sessionStateReducer.ts`：表达 loading、draft、active、switching、error。

#### Controller 契约草案

```ts
interface WorkspaceController {
  status: "loading" | "draft" | "active" | "switching" | "error";
  error?: string;
  sessions: SessionSummary[];
  activeSessionId: string | null;
  sandboxPath: string | null;
  isDraftChat: boolean;
  createSession(): Promise<void>;
  createSessionInWorkspace(path: string): void;
  selectSession(id: string): Promise<void>;
  deleteSession(id: string): Promise<void>;
  openWorkspace(): Promise<void>;
}
```

#### 跨域 port

Workspace controller 不直接修改 PPT、聊天和 project store 的内部状态，而是接收：

```ts
interface WorkspacePorts {
  resetPresentation(): void;
  restorePresentation(snapshot: SessionBootstrap): void;
  resetChat(): void;
  restoreChat(snapshot: SessionBootstrap): void;
  resetProject(): void;
  restoreProject(snapshot: SessionBootstrap): Promise<void>;
  notify(message: string): void;
}
```

#### 验收标准

- App 不再持有任何 session/workspace 状态。
- 新建、切换、删除和恢复会话行为不变。
- 沙箱仍在会话创建前确定，创建后不可修改。
- 切换运行中会话仍被禁止。
- 为 reducer 和 snapshot mapper 增加单元测试。

### 4.2 Phase 3：抽离 Presentation Controller

#### 目标

统一管理 PPT 数据、选择、预览模式、同步和导出。

#### 迁移状态

- `presentation`
- `selectedSlideId`
- `selectedElementId`
- `isMirrorOpen`
- `isMirrorExpanded`
- `isDeckPreviewOpen`
- `isExportingDeck`
- `maxRevision`
- `highlightSlideId`

#### 迁移行为

- `syncPresentation`
- `handleOpenMirror`
- `handleCloseMirror`
- `handleOpenDeckPreview`
- `handleExportDeck`
- 元素新增、更新、删除和选择逻辑
- 演示文稿 revision 与高亮逻辑

#### 设计要求

- 使用单一 `previewMode: "closed" | "split" | "expanded" | "modal"`，替代三个预览布尔值。
- `selectedSlideId` 只负责预览导航，不进入 Agent 默认作用域。
- 导出结果通过事件返回，不直接写入聊天消息。

```ts
type PresentationEvent =
  | { type: "export-completed"; path: string }
  | { type: "export-cancelled" }
  | { type: "export-failed"; error: string }
  | { type: "presentation-updated"; revision: number };
```

#### 验收标准

- App 不再直接调用 presentation 相关 `desktopApi`。
- 关闭、分栏、展开、弹窗预览由一个状态字段表达。
- `WorkspaceView` 只接收 presentation view model。
- 导出和同步失败有独立测试。

### 4.3 Phase 4：抽离 Chat Controller

#### 目标

把消息列表、编辑、重试、复制和持久化映射从 Agent 运行中分离。

#### 迁移状态与行为

- `request`
- `chatMessages`
- 消息追加、替换、编辑和 retry
- `toSessionChatMessages`
- inline artifact card 的解析与 resolved 状态
- 对话标题推导

#### 契约草案

```ts
interface ChatController {
  request: string;
  setRequest(value: string): void;
  messages: ChatMessage[];
  conversationTitle: string;
  append(message: ChatMessage): void;
  replaceStreamingMessage(runId: string, patch: Partial<ChatMessage>): void;
  editMessage(id: string, content: string): void;
  clear(): void;
  restore(messages: SessionChatMessage[]): void;
}
```

#### 约束

- Chat controller 不运行模型。
- Agent controller 通过 chat port 写入消息。
- 卡片确认产生 command/event，由 App 或 Agent controller 决定后续行为。

#### 验收标准

- `ChatWorkspace` 的 props 改为一个 `chatViewModel` 和一个 `chatActions`。
- 消息持久化映射拥有独立测试。
- retry、编辑和 streaming message 更新不依赖组件内部实现。

### 4.4 Phase 5：抽离 Agent Run Controller

#### 目标

把剩余最大、风险最高的 Agent 运行链路从 `App.tsx` 完整移走。

#### 内部再分层

```text
useAgentRunController
├─ agentRunReducer          # 运行状态机
├─ agentStreamReducer       # stream event → trace/message patch
├─ agentResultHandlers      # completed/rejected/question/approval
└─ agentRunPorts            # workspace/chat/presentation/notify
```

#### 迁移状态

- `busy`
- `activeRunId`
- `activityTrace`
- `thoughtProgress`
- `agentActivityMode`
- `activeToolName`
- `isCancellingRun`
- 各类 run/message/trace refs

#### 迁移行为

- `startAgent`
- `applyAgentResult`
- stream event 订阅与分发
- `handleCancelRun`
- `resolveToolApproval`
- `resolveApproval`
- `handleResolveQuestion`
- inbox poller 对 Agent 的触发

#### 事件处理策略

不要把当前巨大的 stream `if` 链原样搬入 hook。先将事件归一化：

```ts
function reduceAgentStream(
  state: AgentRunState,
  event: AgentStreamEvent,
): AgentRunState;
```

副作用由 controller 在 reducer 外执行：

- reducer 只计算状态。
- controller 调用 `desktopApi`。
- ports 更新 chat/presentation/workspace。

#### 并发与生命周期约束

- 每个 stream event 必须校验 `runId`。
- 会话切换前必须确认不存在 active run。
- unsubscribe 必须绑定 controller 生命周期。
- cancel 后迟到事件不得覆盖 cancelled 状态。
- 权限等待和问题等待必须可从持久化状态恢复。

#### 验收标准

- App 不再出现 `AgentStreamEvent` 分支。
- App 不再维护 run refs。
- Agent 状态机的每个状态转换有测试。
- 权限、问题、中止、恢复、完成和失败均有测试。
- inbox poller 只调用 controller 暴露的 `enqueuePrompt`。

### 4.5 Phase 6：收敛 View Model 与 Composition Root

完成各 controller 后，App 只组装：

```tsx
export function App() {
  const notifications = useNotificationCenter();
  const settings = useSettingsController(...);
  const presentation = usePresentationController(...);
  const chat = useChatController(...);
  const workspace = useWorkspaceController(...);
  const agent = useAgentRunController({
    workspace: workspace.port,
    chat: chat.port,
    presentation: presentation.port,
    notify: notifications.notify,
  });

  return (
    <AppShell {...shellProps}>
      <WorkspaceView
        workspace={workspace.viewModel}
        chat={chat.viewModel}
        agent={agent.viewModel}
        presentation={presentation.viewModel}
      />
    </AppShell>
  );
}
```

此阶段同时完成：

- 删除 controller 迁移过程中的临时 alias。
- 删除视图的巨型 props object。
- 把 `WorkspaceView`、`ChatWorkspace` props 分成 `viewModel` 和 `actions`。
- 确认 App 中没有可下沉的业务条件分支。

## 5. 每阶段标准迁移步骤

每个 controller 都按相同顺序实施：

1. 先定义公开 contract 和状态 owner。
2. 抽取纯 mapper/reducer，并先补测试。
3. 把 state/effect 移入 controller，但暂时保留旧调用接口。
4. 将一个调用方切换到 controller。
5. 运行 typecheck、build 和完整测试。
6. 删除 App 中重复状态、setter、ref 和 effect。
7. 再次检查状态是否存在双事实源。

禁止一次同时迁移 Workspace 和 Agent。两者共享恢复与运行约束，必须按阶段串行切换。

## 6. 测试策略

### 6.1 纯逻辑测试

- reducer 状态转换。
- snapshot mapper。
- stream event mapper。
- derived view model。

这类测试不依赖 DOM 或 Electron，放入现有 Vitest 套件。

### 6.2 Controller 测试

通过注入 ports 和 `desktopApi` adapter 测试：

- 成功路径。
- API 抛错。
- 迟到事件。
- 取消与恢复。
- 权限暂停与继续。

禁止在 controller 中直接读取不可替换的全局 `window.desktopApi`；应通过默认 adapter 注入，以便测试。

### 6.3 前端交互回归

至少覆盖：

- 新建会话选择沙箱。
- 切换与删除会话。
- 运行、取消、权限允许/拒绝。
- 打开、关闭、展开 PPT 预览。
- 设置保存与模型切换。
- 重启后恢复会话和等待中的权限。

每阶段必须通过：

```bash
npm run typecheck
npm run build
npm test
```

## 7. 主要风险与规避

### 7.1 状态双写

迁移期间旧 App state 与新 controller state 同时存在，最容易产生恢复后不一致。

规避：每迁移一个字段立即删除旧 state，不建立双向同步 effect。

### 7.2 stale closure

Agent stream、计时器和订阅容易捕获旧 session/run。

规避：事件携带并校验 `runId/sessionId`；必要的最新值由 controller 内部 ref 维护，不由视图维护。

### 7.3 Controller 循环依赖

Workspace 恢复需要更新 Chat 和 Presentation，Agent 完成又会更新 Session。

规避：使用 ports/event，不允许 controller 直接 import 另一个 controller。

### 7.4 巨型 Hook 平移

若把 App 的 1000 行 Agent 逻辑原样复制到 `useAgentRunController.ts`，只是改了文件名。

规避：Agent controller 必须同时拆 reducer、stream mapper、result handler 和 ports。

### 7.5 行为回归难定位

大规模抽取后，错误可能发生在恢复、持久化或视图映射任一层。

规避：每阶段只迁移一个状态域；在删除旧实现前完成 contract 测试。

## 8. 建议实施顺序

按风险和依赖关系执行：

1. Phase 2：Workspace/Session Controller。
2. Phase 3：Presentation Controller。
3. Phase 4：Chat Controller。
4. Phase 5：Agent Run Controller。
5. Phase 6：Composition Root 与 view model 收口。

预计 App 行数演进：

| 阶段 | 预计 App 行数 |
|------|--------------|
| 当前 | 1769 |
| Workspace 拆分后 | 1400–1500 |
| Presentation 拆分后 | 1100–1250 |
| Chat 拆分后 | 800–950 |
| Agent 拆分后 | 300–450 |
| 最终收口 | 200–350 |

## 9. 下一步建议

下一次实施从 `useWorkspaceController` 开始，首个提交只做三件事：

1. 建立 `sessionStateReducer` 和测试。
2. 迁移 session/workspace 状态及 snapshot mapper。
3. 迁移新建、切换、删除会话，不碰 Agent stream 逻辑。

完成后再单独迁移启动恢复与 project/presentation/chat ports，避免首个阶段同时跨越过多领域。
