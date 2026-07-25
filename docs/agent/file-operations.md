# Glob、ReadFile、WriteFile 与 EditFile

> 文档类型：现行架构
> 最后核对：2026-07-25
> 参考：Claude Code 的 read-set、乐观并发与原子替换

## 1. 目标

Main Agent 与 teammate 已共享同一 `WorkspaceFileService`，本轮重构消除了以下旧问题：

- Main Agent 只能让 teammate 代写文件；
- 两套工具对路径、权限和写入安全有不同解释；
- Write/Edit 仅靠 Prompt 约束“先读文件”；
- Edit 静默替换第一个相似片段；
- 写入过程中留下半文件。

模型可见工具统一为：

- `Glob`
- `ReadFile`
- `WriteFile`
- `EditFile`

teammate 的 `read_file/write_file/edit_file` 保留名称兼容层，但调用同一服务，不维护
第二套读写语义。`WorkspaceFileService` 由 RunFactory 按 thread/workspace 复用，使
read receipt 能跨同一 Query 的连续工具调用生效。

## 2. 路径解析

工具输入可以是 workspace-relative 或位于同一 workspace 的绝对路径。执行前：

1. 解析为规范化绝对路径；
2. 用 `path.relative` 和 `realpath` 检查目录穿越与 containment；
3. 拒绝 symlink/junction workspace root、路径组件和特殊文件；
4. 捕获 workspace 到父目录每一层的 `dev/ino`，在读写和 Glob 临界点重复验证；
5. workspace 外路径直接拒绝。

不能通过字符串前缀判断路径是否在 workspace。Glob 在每次 `readdir` 前后和递归
进入子目录时验证 inode/realpath，目录交换只会导致拒绝，不会返回外部文件名。

## 3. ReadFile 与读集

`ReadFile` 除内容外返回稳定收据：

```ts
interface FileReadReceipt {
  path: string;
  version: `sha256:${string}`;
  mtimeMs: number;
  size: number;
  encoding: "utf8";
  newline: "lf" | "crlf" | "mixed" | "none";
}
```

Service 在当前 thread/workspace 实例中记录最近收据及完整 inode snapshot。收据用于
证明 Write/Edit 的基线，不要求模型手工计算 hash；可选 `expected_version` 只能匹配
当前 service 已签发的 receipt，不能代替一次真实读取。

Read 行为：

- 只读取普通 UTF-8 文本；非法 UTF-8 返回 `INVALID_UTF8`；
- 通过 handle 前后 stat 与路径 lstat 验证同一 inode 和稳定大小/时间；
- 目录、FIFO/device、symlink/junction 返回 `UNSAFE_FILE_TYPE`；
- 当前返回完整内容，尚未实现大文件窗口或截断协议；
- 如发现未完成的受保护替换，先依据 durable manifest 恢复或显式报
  `uncertain`，再建立 receipt。

## 4. Read-before-write

### 覆盖已有文件

WriteFile 覆盖已有文件前必须存在当前 service 的有效 read receipt。

若文件在读取后发生变化：

工具返回 `STALE_FILE`，不覆盖新内容，并要求模型重新 ReadFile 后合并。

### 创建新文件

新文件无需先读，但必须在写入临界区再次确认目标仍不存在。若另一个进程已创建，返回冲突而不是覆盖。

## 5. WriteFile

WriteFile 接收完整目标内容。写入流程：

```text
resolve + authorize
  → inspect current file
  → verify read receipt / creation precondition
  → capture directory identities
  → write temp in canonical workspace root
  → flush temp
  → persist replacement manifest
  → displace and verify the exact old inode
  → hard-link the prepared inode into place
  → verify path identities and committed content
  → clean backup/manifest and flush directories where supported
  → return the commit-verified receipt
```

父目录可由工具明确创建。teammate 的 `bash` 不再启动 shell，而是 fail-closed
direct-exec 诊断白名单；重定向、管道、解释器代码和任意可执行文件在启动前拒绝。
`mkdir` 兼容输入转交 `ensureWorkspaceDir`。

Windows 和 guarded replacement 使用带 old/new fingerprint 的 durable manifest 与
唯一 backup。恢复只在 inode/hash 能证明 old/new 身份时自动完成；未知 target 保留
manifest/backup 并上报 `uncertain`，不会静默删除原文件。

## 6. EditFile

EditFile 是确定性的精确编辑：

```ts
{
  path: string;
  oldString: string;
  newString: string;
  replaceAll?: boolean;
}
```

规则：

- 文件必须已 ReadFile；
- `oldString` 不能为空；
- 默认必须恰好匹配一次；
- 0 次匹配返回 `OLD_STRING_NOT_FOUND`；
- 多次匹配返回 `AMBIGUOUS_EDIT`，要求扩大上下文或显式 `replaceAll`；
- `oldString === newString` 返回 `INVALID_EDIT`；
- 在写临界区重新读取并验证 hash、mtime/ctime、size、dev/ino；
- 使用与 WriteFile 相同的原子提交；
- 未触及文本的换行保持原样；
- 返回 replacement 数和新 receipt。

不做模糊匹配，不自行“猜”模型想改哪一段。

## 7. 临界区与并发

同一进程先按规范化路径排队；随后同一 target 的跨进程文件锁覆盖
`recovery → stable read / guarded replace` 整个临界区。compare-and-commit 仍会把
被 displacement 的真实 inode 与 receipt 比较，再验证安装后的 inode、内容和每层
目录 identity；锁不是省略 stale 校验的理由。

```text
acquire(process queue + cross-process target lock)
  → recover or reject durable manifest
  → re-read
  → compare receipt
  → guarded compare-and-commit
  → record new receipt
release
```

同一 Query 中连续编辑成功后，read-set 自动更新为最新 receipt，模型不必为了工具刚刚完成的确定性写入再读一次。

## 8. 写后反馈

当前成功结果包含：

- normalized path
- `created`
- `characterCount`
- Edit 的 `replacements`
- 新 `version/mtimeMs/size/encoding/newline` receipt

`WorkspaceFileError` 只用于执行前失败或已经确认完整回滚的失败，因此中央执行器可标记
`sideEffects=none`。回滚、恢复或清理无法证明时抛普通/`AtomicWriteConflictError`
并标记 `uncertain`；不能把不确定副作用伪装成安全重试。

当前文件工具尚不返回结构化 diff、增删行或 file history snapshot；Presentation
artifact schema 由消费方在使用前验证，不由通用 WriteFile 自动推导 `ready`。

## 9. 权限

| 操作 | workspace 内 | workspace 外 |
|---|---|---|
| ReadFile / Glob | permission profile + path guard | deny |
| 新建文件 | workspace-write + guarded create | deny |
| 覆盖/Edit | workspace-write + read receipt + guarded replace | deny |
| teammate diagnostic | direct-exec allowlist | 不接受自定义 cwd/path root |

权限通过代码检查。Prompt 中“只能写 workspace”只是解释，不是安全边界。

## 10. 关键实现

共享服务：

```text
src/main/agent/tools/files/
└─ workspace-file-service.ts
```

Main ToolDefinition 位于 `src/main/agent/tools/core/workspace-files.ts`；teammate
兼容工具位于 `src/main/agent/subagent/workspace-tools.ts`。二者都调用上述同一服务。

底层原子替换复用并增强：

- `src/main/agent/persistence/atomic-json-file.ts`

Main 和 teammate 的 ToolDefinition 都调用同一底层服务。

## 11. 测试矩阵

- 新建、覆盖、唯一 Edit、replaceAll。
- 未读覆盖、读取后外部修改、并发创建。
- 0/多匹配和 no-op。
- CRLF/LF、Unicode、非法 UTF-8、特殊文件。
- workspace escape、内部 symlink、链接 root、父目录交换。
- same-content inode replacement、并发创建、commit-boundary 外部 writer。
- manifest crash recovery、未知 target 保留 backup、成功后清理。
- active transaction 不被另一个 reader/recovery 当成 crash，JSON fallback 不覆盖等待中的新 writer。
- Bash 重定向/任意解释器拒绝与只读 direct-exec。

核心回归位于 `tests/workspace-file-service.test.ts` 和
`tests/tool-execution-pipeline.test.ts`。

## 12. 状态变更

| 旧行为 | 当前行为 |
|---|---|
| Main Agent 依赖 teammate 写文件 | Main/teammate 都解析同一文件能力并共享 receipt service |
| “先读后写”主要靠 Prompt | `READ_REQUIRED`、`expected_version` 和完整 inode snapshot 由代码执行 |
| stale 检查后再无条件 rename | displacement 后比较真实旧 inode，再安装并验证 prepared inode |
| Windows `.old` 文件靠存在性猜测恢复 | durable manifest 记录 old/new fingerprint；歧义时保留证据并报 `uncertain` |
| Bash 只设置 cwd，仍可重定向越界 | 无 shell 的只读 direct-exec allowlist；文件 mutation 走结构化工具 |
| 文件存在即可参与工作流 | 通用写入不推导 artifact ready；消费方必须解析/验证 |
