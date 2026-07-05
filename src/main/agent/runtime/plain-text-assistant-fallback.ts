import type { AgentRuntimeResult } from "./runtime-types";

export type PlainTextFallbackRequestType =
  | "greeting"
  | "informational"
  | "conversation-memory"
  | "explicit-non-ppt";

export const PLAIN_TEXT_ASSISTANT_FALLBACK_TYPES: ReadonlySet<PlainTextFallbackRequestType> =
  new Set([
    "greeting",
    "informational",
    "conversation-memory",
    "explicit-non-ppt",
  ]);

const EXPLICIT_NON_PPT_PATTERNS = [
  /先不做\s*(?:ppt|演示|幻灯片|deck)?/i,
  /暂(?:时)?不做\s*(?:ppt|演示|幻灯片|deck)?/i,
  /先别做\s*(?:ppt|演示|幻灯片|deck)?/i,
  /不用做\s*(?:ppt|演示|幻灯片|deck)?/i,
  /不要做\s*(?:ppt|演示|幻灯片|deck)?/i,
  /先(?:讲解|解释|介绍|了解|聊聊|讨论)/,
];

const PRESENTATION_ACTION_PATTERNS = [
  /(?:做|制作|生成|创建|新建|整理|输出|产出).{0,12}(?:ppt|演示|幻灯片|deck|汇报)/i,
  /(?:做|整理).{0,6}成.{0,8}(?:ppt|演示|幻灯片|deck|汇报)/i,
  /(?:ppt|演示|幻灯片|deck).{0,12}(?:做|制作|生成|创建|新建|导出|下载|排版|修改|更新|调整)/i,
  /(?:导出|下载).{0,8}(?:pptx|ppt|pdf|html)/i,
  /(?:执行|开始).{0,8}(?:排版|第二阶段|导出)/,
  /(?:改|修改|调整|替换|删除|新增|加).{0,12}(?:第\s*\d+\s*页|这页|当前页|幻灯片|ppt)/i,
  /(?:layout-plan|update-slide-layout|set-theme|submitcommands)/i,
];

const GREETING_PATTERNS = [
  /^(?:hi|hello|hey|你好|您好|嗨|哈喽|在吗)[!！。.\s]*$/i,
];

const CONVERSATION_MEMORY_PATTERNS = [
  /我(?:刚才|之前|上面)说了什么/,
  /(?:刚才|之前|上一条|上面).{0,8}(?:说|聊|问|提到)/,
  /你(?:刚才|之前).{0,8}(?:说|回复|讲)/,
];

const INFORMATIONAL_PATTERNS = [
  /我想了解/,
  /了解一下/,
  /讲解(?:一下)?/,
  /解释(?:一下)?/,
  /介绍(?:一下)?/,
  /说明(?:一下)?/,
  /科普(?:一下)?/,
  /(?:什么是|什么叫|是什[么麽]|是什么)/,
  /(?:核心|概念|背景|原理|含义|定义|方法|区别|为什么|怎么看|如何理解)/,
  /(?:在做什么|做什么的|讲的是什么|主要内容)/,
];

function normalizeRequest(request: string): string {
  return request.trim().replace(/\s+/g, " ");
}

function hasAnyMatch(request: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(request));
}

function looksLikeBrokenAgentProtocol(text: string): boolean {
  return /^\s*(?:```(?:json)?\s*)?\{\s*"type"\s*:/i.test(text);
}

export function classifyPlainTextFallbackRequest(
  request: string,
): PlainTextFallbackRequestType | null {
  const normalized = normalizeRequest(request);
  if (!normalized) return null;

  if (hasAnyMatch(normalized, EXPLICIT_NON_PPT_PATTERNS)) {
    return "explicit-non-ppt";
  }

  if (hasAnyMatch(normalized, PRESENTATION_ACTION_PATTERNS)) {
    return null;
  }

  if (hasAnyMatch(normalized, GREETING_PATTERNS)) {
    return "greeting";
  }

  if (hasAnyMatch(normalized, CONVERSATION_MEMORY_PATTERNS)) {
    return "conversation-memory";
  }

  if (hasAnyMatch(normalized, INFORMATIONAL_PATTERNS)) {
    return "informational";
  }

  return null;
}

export function canWrapPlainTextAssistantMessage(input: {
  request: string;
  responseText: string;
  requiredOutcome?: "any" | "command_proposal";
}): boolean {
  if (input.requiredOutcome === "command_proposal") return false;

  const content = input.responseText.trim();
  if (!content) return false;
  if (looksLikeBrokenAgentProtocol(content)) return false;

  const requestType = classifyPlainTextFallbackRequest(input.request);
  return requestType !== null && PLAIN_TEXT_ASSISTANT_FALLBACK_TYPES.has(requestType);
}

export function maybeWrapPlainTextAssistantMessage(input: {
  request: string;
  responseText: string;
  requiredOutcome?: "any" | "command_proposal";
}): AgentRuntimeResult | null {
  if (!canWrapPlainTextAssistantMessage(input)) return null;

  return {
    type: "assistant.message",
    data: { content: input.responseText.trim() },
  };
}
