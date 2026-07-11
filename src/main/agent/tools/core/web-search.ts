import type { ToolDefinition } from "../tool-definition";
import {
  executeWebSearch,
  formatWebSearchOutput,
  webSearchSchema,
  type WebSearchOutput,
} from "../../search/web-search";

export const webSearchTool: ToolDefinition<typeof webSearchSchema, WebSearchOutput> = {
  name: "WebSearch",
  description:
    "搜索互联网以获取最新或可核验的事实、数据和来源。仅在任务需要外部资料时使用；"
    + "结果包含标题、URL 和摘要，引用事实时必须保留来源链接。",
  category: "core",
  loadPolicy: "core",
  inputSchema: webSearchSchema,
  risk: "low",
  permission: {
    profile: "web-search",
    description: "Send a query to the configured web search provider.",
    scopes: ["main"],
    effects: ["network.access"],
    sandbox: "none",
    approval: "never",
  },
  execute: async (args, context) => executeWebSearch(args, {
    gatewayConfig: context.gateway?.getGatewayConfig?.(),
    signal: context.signal,
  }),
  mapResultToModelContent: formatWebSearchOutput,
};
