/** Progress events emitted while a Task sub-agent runs (UI only, not main transcript). */
export type SubAgentProgressEvent =
  | { type: "subagent-started"; taskId: string; description: string }
  | { type: "subagent-thinking-chunk"; taskId: string; chunk: string }
  | { type: "subagent-tool-started"; taskId: string; toolName: string; message: string }
  | { type: "subagent-tool-finished"; taskId: string; toolName: string; message: string }
  | { type: "subagent-finished"; taskId: string };

export type SubAgentProgressListener = (event: SubAgentProgressEvent) => void;

export function formatSubAgentToolLabel(toolName: string, args: unknown): string {
  if (!args || typeof args !== "object") return toolName;
  const record = args as Record<string, unknown>;
  if (toolName === "read_file" && typeof record.path === "string") {
    return `读取文件 ${record.path}`;
  }
  if (toolName === "write_file" && typeof record.path === "string") {
    return `写入文件 ${record.path}`;
  }
  if (toolName === "ensure_dir" && typeof record.path === "string") {
    return `创建目录 ${record.path}`;
  }
  if (toolName === "edit_file" && typeof record.path === "string") {
    return `编辑文件 ${record.path}`;
  }
  if (toolName === "glob" && typeof record.pattern === "string") {
    return `查找文件 ${record.pattern}`;
  }
  if (toolName === "bash" && typeof record.command === "string") {
    const command = record.command.length > 80
      ? `${record.command.slice(0, 77)}...`
      : record.command;
    return `执行命令：${command}`;
  }
  return toolName;
}
