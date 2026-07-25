# Glob、ReadFile、WriteFile 与 EditFile

> 文档类型：本轮目标契约
> 参考：Claude Code 的 read-set、乐观并发、原子写入与结构化 diff

## 1. 目标

Main Agent 与 teammate 应共享同一套文件工具和底层文件操作，不再出现：

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

teammate 旧的 `read_file/write_file/edit_file` 可在兼容边界映射到同一实现，不能长期维护第二套语义。

## 2. 路径解析

工具输入可以是 workspace-relative 或明确的绝对路径，但执行前必须：

1. 解析为规范化绝对路径；
2. 检查空路径、NUL、目录穿越和 symlink 逃逸；
3. 判断是否位于 workspace；
4. 对 workspace 外访问执行明确的 deny/approval；
5. 检查 Secret、系统目录和受保护路径策略。

不能通过字符串前缀判断路径是否在 workspace，必须使用规范化后的 path relation。

## 3. ReadFile 与读集

`ReadFile` 除内容外返回稳定收据：

```ts
interface FileReadReceipt {
  path: string;
  contentHash: string;
  mtimeMs: number;
  size: number;
  encoding: "utf8";
  newline: "lf" | "crlf" | "mixed" | "none";
}
```

Runtime 在当前 Query 的 file read-set 中记录最近收据。收据用于证明 Write/Edit 的基线，不是让模型手工计算 hash。

Read 行为：

- 文本采用 UTF-8，并保留原换行风格信息；
- 大文件按行或字节窗口读取，返回是否截断；
- 二进制文件返回明确错误或交给专用工具；
- 不存在、目录、权限失败使用稳定错误码；
- 返回内容经过模型预算限制，但本地收据基于完整文件。

## 4. Read-before-write

### 覆盖已有文件

WriteFile 覆盖已有文件前必须存在当前 Query 的有效 read receipt，或输入携带由系统签发的等价 expected revision。

若文件在读取后发生变化：

```text
FILE_CHANGED_SINCE_READ
```

工具不覆盖新内容，并要求模型重新 ReadFile 后合并。

### 创建新文件

新文件无需先读，但必须在写入临界区再次确认目标仍不存在。若另一个进程已创建，返回冲突而不是覆盖。

## 5. WriteFile

WriteFile 接收完整目标内容。写入流程：

```text
resolve + authorize
  → inspect current file
  → verify read receipt / creation precondition
  → preserve required encoding/newline policy
  → write temp in same directory
  → flush temp
  → atomic rename/replace
  → flush directory where supported
  → re-read metadata
  → return receipt + diff summary
```

父目录可由工具明确创建。不得通过 Shell `mkdir/cat/echo >` 绕过写入协议。

Windows rename replacement使用“旧文件移到可回滚位置 → 新文件 rename → 清理旧文件”的恢复协议；失败时尽量恢复旧目标。

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
- 0 次匹配返回 `MATCH_NOT_FOUND`；
- 多次匹配返回 `MATCH_NOT_UNIQUE`，要求扩大上下文或显式 `replaceAll`；
- `oldString === newString` 或结果未变化返回 `NO_OP_EDIT`；
- 在写临界区重新读取并验证 hash/mtime；
- 使用与 WriteFile 相同的原子提交；
- 保留文件原换行风格；
- 返回结构化 diff 和新 receipt。

不做模糊匹配，不自行“猜”模型想改哪一段。

## 7. 临界区与并发

验证基线和写入之间不能存在可被另一个写者插入的窗口。至少按规范化文件路径使用进程内锁；跨进程共享 workspace 时使用文件锁或等价事务。

```text
acquire(path lock)
  → re-read
  → compare receipt
  → atomic replace
  → record new receipt
release
```

同一 Query 中连续编辑成功后，read-set 自动更新为最新 receipt，模型不必为了工具刚刚完成的确定性写入再读一次。

## 8. 写后反馈

成功结果至少包含：

- normalized path
- created / updated
- old/new hash
- bytes
- line additions/deletions
- 有界 structured diff
- 新 receipt

失败结果包含稳定 code、可行动说明和 `sideEffects`：

- `none`
- `uncertain`
- `committed`

写入后可选触发：

- file history snapshot；
- Project Artifact validation；
- LSP/IDE 通知；
- watcher/inbox 事件。

这些后处理失败不能让 Runtime 盲目重试已成功的文件写入。

## 9. 权限

| 操作 | workspace 内 | workspace 外 |
|---|---|---|
| ReadFile | 默认允许或按配置 | ask/deny |
| 新建文件 | 按 workspace-write 策略 | ask/deny |
| 覆盖/Edit | read-set + workspace-write | ask/deny |
| Secret/系统路径 | deny 或专用审批 | deny |

权限通过代码检查。Prompt 中“只能写 workspace”只是解释，不是安全边界。

## 10. 实现收敛

目标代码组织：

```text
src/main/agent/tools/files/
└─ workspace-file-service.ts
```

Main ToolDefinition 位于 `src/main/agent/tools/core/workspace-files.ts`；teammate
兼容工具位于 `src/main/agent/subagent/workspace-tools.ts`。二者都调用上述同一服务。

底层原子替换复用并增强：

- `src/main/agent/persistence/atomic-json-file.ts`

最终 main 和 teammate 的 ToolDefinition 都调用同一底层服务。

## 11. 测试矩阵

- 新建、覆盖、唯一 Edit、replaceAll。
- 未读覆盖、读取后外部修改、并发创建。
- 0/多匹配和 no-op。
- CRLF/LF、Unicode、空文件、大文件。
- workspace escape、symlink escape、Secret 路径。
- temp 写失败、rename 失败、回滚。
- 成功写入后 post hook 失败不重复执行。
