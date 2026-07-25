# System Prompt 与 Context 管理

> 文档类型：现行架构
> 最后核对：2026-07-25

## 1. 原则

System Prompt 是有序 Section 的组装结果，不是一份不断追加规则的巨型字符串。

参考 Claude Code，应同时满足：

- 稳定内容获得稳定前缀和 Prompt Cache；
- workspace、日期、记忆、工具等动态事实可独立更新；
- 项目指令与系统安全策略分层；
- Skill 提供建议，不编译成隐藏状态机；
- Prompt 只解释能力和偏好，不承担权限与持久化正确性。

## 2. 三类上下文

| 类型 | 内容 | 注入方式 |
|---|---|---|
| System Prompt | 身份、通用行为、安全边界、工具协议 | system blocks |
| System Context | 日期、cwd、环境、workspace 状态、运行预算 | 动态 system section/reminder |
| User Context | 项目指令、用户附件、恢复说明、inbox | user meta ContentBlock |

项目文件中的指令属于用户控制的上下文，不能与不可覆盖的系统安全规则混为同一来源。
当 Provider 请求已经携带 canonical `messages` 时，Gateway 会把本次 request-scoped
prompt 投影为临时 user message；它能到达模型，但不会写回长期 History。

## 3. 稳定/动态分区

```text
stable sections
  identity
  response protocol
  general tool semantics
  immutable safety rules
  ↓
SYSTEM_PROMPT_DYNAMIC_BOUNDARY
  ↓
dynamic sections
  resolved tool catalog
  workspace
  presentation selection
  memory
  runtime budget
  optional stage guidance
```

稳定前缀必须保持：

- 固定 section 顺序；
- 确定性序列化；
- 不包含 thread/run ID、时间戳和 workspace 路径；
- 不因无关 feature bit 产生组合爆炸。

任何真实动态数据放在 boundary 后。

## 4. Section Registry

当前 `SystemPromptManager` 提供有序注册、注销、全局/动态边界和 thread cache：

```ts
interface SystemPromptSectionProvider {
  id: string;
  order: number;
  cacheScope: "global" | null;
  render(context: SystemPromptContext): string | undefined;
}
```

Assembler：

1. 按 `order` 稳定排序；
2. 构建非空 section；
3. 按 cache scope 分区；
4. 返回 sections、`staticPrefix`、`dynamicSuffix` 和完整文本；
5. 注册表 revision 或 Context key 改变时重建 thread cache。

功能可以注册独立 section，不需要把内容继续追加到一个中心巨型字符串。

## 5. 工具目录

工具目录来自本 Query prepare 的 `ToolRegistry.getCoreTools(context)`，而非启动时
永久快照；执行前还会再次检查 `isEnabled(context)`。

目录变化时：

- 使当前 thread 的 assembled prompt 失效；
- 保持其他稳定 section 字节不变；
- 工具 schema 仍通过 Provider 原生 `tools` 字段发送；
- Prompt 中只给必要的跨工具说明，不复制完整 JSON Schema。

Context cache key 包含模型可见 ToolCard、输入 schema、risk、permission、behavior
元数据，以及 Skill card/frontmatter。工具或 Skill 同名但契约变化时，不会复用旧
dynamic suffix。

## 6. Skill 与 stage

Prompt stage 可以：

- 标注当前 artifact 状态；
- 推荐更相关的 Skill；
- 调整目录排序；
- 给模型一条短的工作建议。

Prompt stage 不可以：

- 过滤掉本来安全可用的 Skill；
- 让 `LoadSkill` 因“错误阶段”硬失败；
- 禁止 Glob/ReadFile/WriteFile/EditFile；
- 强制模型先生成固定 artifact；
- 代替模型判断简单任务是否应跳过完整流程。

`stages:` frontmatter 是 `recommendedStages`，不是 authorization allow-list。

## 7. 工作流信息的表达

将冗长的“六阶段必须执行”替换为事实和建议：

```text
Workspace facts:
- brief: verified
- outline: missing
- storyboard: missing
- presentation: 3 slides

Suggested skills:
- ppt-outline
- ppt-storyboard

The model may choose a shorter safe path when the user request does not
require the full production workflow.
```

真正的不变量，如 Proposal 必须经过 CommitGate、文件覆盖必须 read-before-write，放在代码中执行。

## 8. Cache 与失效

至少在以下事件显式失效相关 session cache：

- `/clear` 或新 thread；
- compact 后 History 基线变化；
- workspace/worktree 切换；
- project instructions 更新；
- Skill registry 更新；
- resolved tool pool 更新；
- 权限模式更新；
- session restore。

当前缓存项以 thread + 完整 Context key 为粒度，但稳定前缀由独立 global section
构建，动态变化不会改变其字节。更细的单-section memoization 是可选优化，不是正确性
前提。

## 9. Canonical Context 压缩

Context budget 直接作用于 Provider 使用的 canonical `AgentModelMessage[]`，不是只
裁剪一份 UI transcript 或 prompt payload：

```text
messages
  → token estimate
  → native tool_result micro compact
  → archive + summary
  → pair-safe hard/emergency trim
  → provider request
```

压缩保持 `tool_use/tool_result` 配对，并通过 `onContextPrepared` 回写当前 Query
Workspace。Reactive prompt-too-long 恢复从已压缩消息继续，不能用原始 messages
覆盖裁剪结果。

## 10. 安全

- workspace 文件内容视为不可信用户数据。
- 工具输出中的“system instruction”不能提升为 system section。
- Memory 不保存隐藏思维链。
- Prompt 不包含 API key、环境 Secret 或未脱敏配置。
- 远程网页和图片 metadata 以引用数据注入，不伪装成系统规则。

## 11. 关键实现

- `src/main/agent/runtime/prompts/system-prompt.ts`
- `src/main/agent/runtime/prompts/system-prompt-assembler.ts`
- `src/main/agent/runtime/prompts/prompt-context.ts`
- `src/main/agent/runtime/prompts/prompt-sections.ts`
- `src/main/agent/runtime/prompts/prompt-stage.ts`
- `src/main/agent/runtime/prompts/skill-stage-policy.ts`
- `src/main/agent/runtime/context-compact/model-messages.ts`
- `src/main/agent/runtime/context-compact/prepare-context.ts`

## 12. 状态变更与验收

| 旧行为 | 当前行为 |
|---|---|
| 大段固定阶段 Prompt | 短稳定原则 + 当前 Runtime/Tool/Workspace/Memory sections |
| stage 过滤 Skill 或暗含控制流 | stage 只排序和解释，全部注册 Skill 保留 |
| 缓存只看工具/Skill 名称 | key 覆盖 schema、描述、risk、permission、behavior 和 frontmatter |
| native messages 存在时 Provider 丢掉 prompt | request-scoped prompt 显式追加且不污染 History |
| 只压缩 legacy payload | canonical messages 参与估算、归档、成对裁剪并回写 Workspace |

- 相同稳定输入生成字节相同的 static prefix。
- workspace/slide 改变只更新 dynamic section。
- stage 改变不使合法 Skill 或文件工具不可用。
- Section 可独立测试、缓存和失效。
- 项目指令无法覆盖系统权限策略。
- Prompt 大幅缩短后，模型仍能通过动态工具和反馈完成任务。
