import type { AgentResponseContract } from "./types";

const AGENT_PROTOCOL_MARKER = "<!-- RESPONSE_CONTRACT:agent-protocol -->";
const MARKDOWN_SUMMARY_MARKER = "<!-- RESPONSE_CONTRACT:markdown-summary -->";

export function buildAgentProtocolResponseContract(): string {
  return [
    AGENT_PROTOCOL_MARKER,
    "## 响应协议",
    "",
    "每次主 Agent 响应必须严格返回一个 JSON 对象，不要 Markdown 代码块包裹，不要在对象前后追加解释。",
    "",
    "- 普通最终回复：必须使用完整文本 envelope：{\"kind\":\"text\",\"format\":\"markdown\",\"type\":\"assistant.message\",\"data\":{\"content\":\"Markdown 内容\"}}",
    "- `format: \"markdown\"` 表示 `data.content` 的渲染格式；Markdown 只能放在 content 字符串里，不能直接裸返回。",
    "- 调用工具：{\"type\":\"tool.call\",\"data\":{\"toolName\":\"ToolName\",\"args\":{}}}",
    "- 请求用户补充：必须调用 AskUser 工具，例如 {\"type\":\"tool.call\",\"data\":{\"toolName\":\"AskUser\",\"args\":{\"message\":\"...\",\"missingFields\":[\"...\"]}}}",
    "- 提交幻灯片修改：必须调用 SubmitCommands",
  ].join("\n");
}

function buildMarkdownSummaryResponseContract(): string {
  return [
    MARKDOWN_SUMMARY_MARKER,
    "## Response Contract",
    "",
    "Return plain Markdown summary text only. Do not use the Agent JSON envelope, tool calls, code fences, or prose about these instructions.",
  ].join("\n");
}

export function buildResponseContract(contract: AgentResponseContract): string {
  if (contract === "agent-protocol") return buildAgentProtocolResponseContract();
  if (contract === "markdown-summary") return buildMarkdownSummaryResponseContract();
  return "";
}

function markerForContract(contract: AgentResponseContract): string | null {
  if (contract === "agent-protocol") return AGENT_PROTOCOL_MARKER;
  if (contract === "markdown-summary") return MARKDOWN_SUMMARY_MARKER;
  return null;
}

export function applyResponseContract(
  systemPrompt: string | undefined,
  contract: AgentResponseContract | undefined,
): string | undefined {
  if (!contract || contract === "none") return systemPrompt;

  const contractText = buildResponseContract(contract);
  if (!contractText) return systemPrompt;

  const marker = markerForContract(contract);
  const currentPrompt = systemPrompt?.trim() ?? "";
  if (marker && currentPrompt.includes(marker)) return systemPrompt;

  return currentPrompt ? `${currentPrompt}\n\n${contractText}` : contractText;
}
