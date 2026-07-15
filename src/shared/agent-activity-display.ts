export type AgentToolDisplayCategory =
  | "read"
  | "search"
  | "inspect"
  | "change"
  | "coordinate"
  | "other";

export type AgentToolActivityState =
  | "running"
  | "completed"
  | "failed"
  | "denied"
  | "invalid-input";

interface AgentToolDisplayCopy {
  action: string;
  category: AgentToolDisplayCategory;
}

/**
 * Tool names are protocol identifiers. Keep their user-facing copy centralized so
 * CamelCase/snake_case implementation details never need to reach the activity UI.
 */
const TOOL_DISPLAY_COPY = {
  AskUser: { action: "确认需求", category: "coordinate" },
  ExecuteExtraTool: { action: "执行扩展操作", category: "change" },
  ExecuteLayoutPlan: { action: "应用页面布局", category: "change" },
  GetSelection: { action: "读取当前选择", category: "read" },
  list_teammates: { action: "查看协作进度", category: "coordinate" },
  ListSlides: { action: "读取页面列表", category: "read" },
  PreviewCommands: { action: "检查修改方案", category: "inspect" },
  ReadCurrentSlide: { action: "读取当前页面", category: "read" },
  ReadPresentationSnapshot: { action: "读取演示文稿", category: "read" },
  respond_plan_approval: { action: "确认任务计划", category: "coordinate" },
  SearchExtraTools: { action: "查找可用能力", category: "search" },
  send_teammate_message: { action: "同步协作信息", category: "coordinate" },
  shutdown_teammate: { action: "结束协作任务", category: "coordinate" },
  spawn_teammate: { action: "启动协作任务", category: "coordinate" },
  SubmitCommands: { action: "提交修改方案", category: "change" },
  task_worker: { action: "分配任务步骤", category: "coordinate" },
  TaskGraphCreate: { action: "建立任务计划", category: "coordinate" },
  TaskGraphCreatePlan: { action: "建立任务计划", category: "coordinate" },
  TaskGraphList: { action: "读取任务计划", category: "read" },
  TaskGraphGet: { action: "读取任务详情", category: "read" },
  TaskGraphClaim: { action: "领取任务步骤", category: "coordinate" },
  TaskGraphComplete: { action: "完成任务步骤", category: "coordinate" },
  LoadSkill: { action: "准备专业能力", category: "coordinate" },
  WebSearch: { action: "查找在线资料", category: "search" },
  SearchSlideImages: { action: "搜索幻灯片图片", category: "search" },

  AddLayoutDecorations: { action: "添加版式装饰", category: "change" },
  AnalyzeDeckConsistency: { action: "检查整体一致性", category: "inspect" },
  ApplyDesignSystem: { action: "应用视觉主题", category: "change" },
  ApplyTypography: { action: "优化文字排版", category: "change" },
  AutoLayoutSlide: { action: "优化页面布局", category: "change" },
  BeautifyChart: { action: "优化图表样式", category: "change" },
  BeautifyTable: { action: "优化表格样式", category: "change" },
  CompressText: { action: "精简页面文字", category: "change" },
  DetectOverflowText: { action: "检查文字溢出", category: "inspect" },
  DetectRepeatedTitles: { action: "检查重复标题", category: "inspect" },
  ExportPptx: { action: "导出演示文稿", category: "change" },
  InsertSlideImage: { action: "添加页面图片", category: "change" },
  PreviewSlide: { action: "生成页面预览", category: "inspect" },
  RewriteSlideContent: { action: "改写页面内容", category: "change" },
  SelectStyleStrategy: { action: "选择视觉风格", category: "inspect" },
  UpdateSlideVariant: { action: "调整页面视觉节奏", category: "change" },
  ValidateDeckLayout: { action: "检查页面布局", category: "inspect" },

  read_file: { action: "读取工作文件", category: "read" },
  write_file: { action: "保存工作文件", category: "change" },
  ensure_dir: { action: "准备工作目录", category: "change" },
  edit_file: { action: "编辑工作文件", category: "change" },
  glob: { action: "查找工作文件", category: "search" },
  bash: { action: "执行本地操作", category: "change" },
  web_search: { action: "查找在线资料", category: "search" },
  recovery: { action: "恢复当前任务", category: "coordinate" },
} as const satisfies Record<string, AgentToolDisplayCopy>;

const FALLBACK_ACTIONS: Record<AgentToolDisplayCategory, string> = {
  read: "读取相关信息",
  search: "查找相关资料",
  inspect: "检查当前内容",
  change: "更新演示内容",
  coordinate: "协调处理任务",
  other: "处理当前任务",
};

function inferToolCategory(toolName: string): AgentToolDisplayCategory {
  if (/task|teammate|spawn|message|approval|skill/i.test(toolName)) return "coordinate";
  if (/search|find|web|glob/i.test(toolName)) return "search";
  if (/read|get|list|load/i.test(toolName)) return "read";
  if (/preview|validate|analyze|detect|inspect/i.test(toolName)) return "inspect";
  if (/submit|execute|apply|update|insert|rewrite|compress|beautify|export|write|edit/i.test(toolName)) {
    return "change";
  }
  return "other";
}

export function hasAgentToolDisplayCopy(toolName: string): boolean {
  return Object.prototype.hasOwnProperty.call(TOOL_DISPLAY_COPY, toolName);
}

export function getAgentToolDisplayCopy(toolName: string): AgentToolDisplayCopy {
  const known = TOOL_DISPLAY_COPY[toolName as keyof typeof TOOL_DISPLAY_COPY];
  if (known) return known;
  const category = inferToolCategory(toolName);
  return { action: FALLBACK_ACTIONS[category], category };
}

function completedAction(action: string): string {
  const replacements: Array<[string, string]> = [
    ["读取", "已读取"],
    ["查看", "已查看"],
    ["确认", "已确认"],
    ["检查", "已检查"],
    ["查找", "已查找"],
    ["应用", "已应用"],
    ["提交", "已提交"],
    ["执行", "已执行"],
    ["启动", "已启动"],
    ["结束", "已结束"],
    ["建立", "已建立"],
    ["领取", "已领取"],
    ["完成", "已完成"],
    ["准备", "已准备"],
    ["优化", "已优化"],
    ["精简", "已精简"],
    ["调整", "已调整"],
    ["导出", "已导出"],
    ["添加", "已添加"],
    ["保存", "已保存"],
    ["编辑", "已编辑"],
    ["同步", "已同步"],
    ["选择", "已选择"],
    ["生成", "已生成"],
    ["分配", "已分配"],
    ["改写", "已改写"],
    ["处理", "已处理"],
    ["恢复", "已恢复"],
  ];
  for (const [prefix, replacement] of replacements) {
    if (action.startsWith(prefix)) return `${replacement}${action.slice(prefix.length)}`;
  }
  return `${action}已完成`;
}

export function formatAgentToolActivity(
  toolName: string,
  state: AgentToolActivityState,
): string {
  const { action } = getAgentToolDisplayCopy(toolName);
  switch (state) {
    case "running":
      return `正在${action}…`;
    case "completed":
      return completedAction(action);
    case "failed":
      return `${action}未完成`;
    case "denied":
      return `${action}已取消`;
    case "invalid-input":
      return `${action}暂未执行：输入信息有误`;
  }
}

export function inferAgentToolActivityState(
  message: string | undefined,
  fallback: AgentToolActivityState,
): AgentToolActivityState {
  const normalized = message?.toLowerCase() ?? "";
  if (/参数|校验|解析失败|输入信息有误|暂未执行|validation|invalid|parse error/.test(normalized)) {
    return "invalid-input";
  }
  if (/拒绝|未授权|取消|denied|not approved|cancelled|canceled/.test(normalized)) {
    return "denied";
  }
  if (/失败|未完成|failed|error|exception/.test(normalized)) {
    return "failed";
  }
  return fallback;
}

function formatBackgroundTaskLabel(label: string): string {
  const toolMatch = label.match(/^([A-Za-z][\w-]*)(?::\s*.*)?$/);
  if (toolMatch) return getAgentToolDisplayCopy(toolMatch[1]!).action;
  return label;
}

/**
 * Normalize runtime diagnostics and legacy persisted labels at the final display
 * boundary. The raw messages remain available to logs and context snapshots.
 */
export function formatAgentProgressMessage(message: string): string | null {
  const value = message.trim();
  if (!value) return null;

  if (/^L1\s+snip_compact\b/i.test(value)) return "已整理较早的对话内容";
  if (/^L2\s+micro_compact\b/i.test(value)) return "已精简较早的运行记录";
  if (/^L3\s+tool_result_budget\b/i.test(value)) return "已整理较大的运行结果";
  if (/^Persisted oversized tool result\b/i.test(value)) return "已整理较大的运行结果";
  if (/^L4\s+compact_history\s+skipped\b/i.test(value)) return null;
  if (/^L4\s+compact_history\b/i.test(value)) return "已总结较早的对话内容";
  if (/^L\d+\s+[a-z][\w-]*\s*:/i.test(value)) return "已整理较早的会话记录";

  if (/max_tokens|输出被截断|输出截断后启用续写/i.test(value)) {
    return "回复内容较长，正在继续生成…";
  }
  if (/上下文超限|prompt (?:is )?too long|context length/i.test(value)) {
    return "对话内容较多，整理后正在继续…";
  }
  if (/连续过载|备用模型|Retry-After|指数退避|临时故障/i.test(value)) {
    return "服务暂时繁忙，正在重试…";
  }

  const backgroundMatch = value.match(/^后台任务\s+\S+\s+已启动[：:]\s*(.+)$/);
  if (backgroundMatch) {
    return `已开始后台处理：${formatBackgroundTaskLabel(backgroundMatch[1]!)}`;
  }

  const legacyCompleted = value.match(
    /^(?:✅\s*)?工具\s+([A-Za-z_][\w-]*)\s+(?:运行完毕|执行完成)[。.]?$/,
  );
  if (legacyCompleted) return formatAgentToolActivity(legacyCompleted[1]!, "completed");

  const legacyStarted = value.match(
    /^(?:🛠️\s*)?(?:运行工具|正在调用工具|尝试调用)[：:]?\s*([A-Za-z_][\w-]*)/,
  );
  if (legacyStarted) return formatAgentToolActivity(legacyStarted[1]!, "running");

  const legacyFailed = value.match(/^工具\s+([A-Za-z_][\w-]*)\s+执行失败/i);
  if (legacyFailed) return formatAgentToolActivity(legacyFailed[1]!, "failed");

  return value;
}

export function formatAgentToolApprovalDetail(detail: string): string {
  const normalized = detail.trim().replace(/^path:\s*/gim, "位置：");
  if (/^[\[{]/.test(normalized)) return "此操作包含需要确认的高级设置";
  return normalized;
}

export function formatPublicErrorMessage(
  error: unknown,
  fallback = "处理时遇到问题，请稍后重试。",
): string {
  const value = error instanceof Error ? error.message.trim() : String(error ?? "").trim();
  if (!value) return fallback;
  if (/aborted|中断|取消/i.test(value)) return "操作已取消。";
  if (/api[_ -]?key|authentication|unauthorized|\b401\b/i.test(value)) {
    return "模型服务尚未正确配置，请在设置中检查连接信息。";
  }
  if (/rate.?limit|overload|too many requests|\b429\b|timeout|timed out|econn/i.test(value)) {
    return "服务暂时繁忙，请稍后重试。";
  }
  if (/\b(?:enoent|file not found|path not found|no such file)\b/i.test(value)) {
    return "未找到所需文件，请检查项目目录后重试。";
  }
  if (/\b(?:eacces|eperm|permission denied)\b/i.test(value)) {
    return "当前操作缺少必要权限，请检查项目目录权限。";
  }
  if (/zod|schema|validation|json|tool[_ -]?use|stack|\bat\s+\S+\s*\(/i.test(value)) {
    return fallback;
  }
  if (/^[\x00-\x7F]+$/.test(value)) return fallback;
  return value.length > 180 ? `${value.slice(0, 177)}…` : value;
}
