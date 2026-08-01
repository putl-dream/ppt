/** Main-agent guidance for the sole native ContentBlock protocol. */
export function buildContentBlockResponseGuidance(): string {
  return [
    "## 响应协议",
    "",
    "- 普通最终回复直接输出 Markdown 文本；不要包装 JSON、kind/format/type/data 或代码块。",
    "- 调用能力必须使用 provider 原生 tool_use；不要在文本中伪造工具调用 JSON。",
    "- 请求用户补充或提交幻灯片修改时，必须使用本 Query 工具清单中对应的受控能力；能力不可用时不得伪造结果。",
    "- 每个 tool_use 由系统按 ID 回填一个 tool_result；不要自行输出 tool_result。",
  ].join("\n");
}
