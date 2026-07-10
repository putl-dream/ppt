import type { AgentResponseContract } from "./types";

const MARKDOWN_SUMMARY_MARKER = "<!-- RESPONSE_CONTRACT:markdown-summary -->";

/** Main-agent guidance for the sole native ContentBlock protocol. */
export function buildContentBlockResponseGuidance(): string {
  return [
    "## 响应协议",
    "",
    "- 普通最终回复直接输出 Markdown 文本；不要包装 JSON、kind/format/type/data 或代码块。",
    "- 调用能力必须使用 provider 原生 tool_use；不要在文本中伪造工具调用 JSON。",
    "- 请求用户补充必须调用 AskUser。",
    "- 提交幻灯片修改必须调用 SubmitCommands 或返回 command proposal 的受控工具。",
    "- 每个 tool_use 由系统按 ID 回填一个 tool_result；不要自行输出 tool_result。",
  ].join("\n");
}
function buildMarkdownSummaryResponseContract(): string {
  return [
    MARKDOWN_SUMMARY_MARKER,
    "## Response Contract",
    "",
    "Return plain Markdown summary text only. Do not call tools or wrap the response in JSON.",
  ].join("\n");
}

export function buildResponseContract(contract: AgentResponseContract): string {
  if (contract === "markdown-summary") return buildMarkdownSummaryResponseContract();
  return "";
}

export function applyResponseContract(
  systemPrompt: string | undefined,
  contract: AgentResponseContract | undefined,
): string | undefined {
  if (!contract || contract === "none") return systemPrompt;
  const contractText = buildResponseContract(contract);
  const currentPrompt = systemPrompt?.trim() ?? "";
  if (!contractText || currentPrompt.includes(MARKDOWN_SUMMARY_MARKER)) return systemPrompt;
  return currentPrompt ? `${currentPrompt}\n\n${contractText}` : contractText;
}
