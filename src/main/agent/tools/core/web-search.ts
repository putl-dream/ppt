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
    "搜索互联网以获取最新或可核验的事实、数据、来源及可选图片候选。"
    + "引用事实时必须保留来源链接；图片使用前必须核对授权并保留来源。",
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
