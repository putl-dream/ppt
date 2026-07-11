import { z } from "zod";
import type { AgentGatewayConfig } from "@shared/agent-gateway-config";
import { createSearchService } from "./search-service";
import type { WebSearchResult } from "./types";

const domainSchema = z.string().trim().min(1).max(253);

export const webSearchSchema = z.object({
  query: z.string().trim().min(1).max(500).describe("要搜索的具体问题或关键词"),
  max_results: z.number().int().min(1).max(10).optional().default(5)
    .describe("返回结果数量，默认 5，最多 10"),
  search_depth: z.enum(["basic", "advanced"]).optional().default("basic")
    .describe("basic 更快更省额度；advanced 相关性更高但消耗更多额度"),
  topic: z.enum(["general", "news"]).optional().default("general")
    .describe("general 用于通用资料，news 用于实时新闻"),
  allowed_domains: z.array(domainSchema).max(20).optional()
    .describe("仅搜索这些域名，例如 ['who.int']"),
  blocked_domains: z.array(domainSchema).max(20).optional()
    .describe("排除这些域名"),
}).superRefine((value, context) => {
  if (value.allowed_domains?.length && value.blocked_domains?.length) {
    context.addIssue({
      code: "custom",
      message: "allowed_domains and blocked_domains cannot be used together.",
    });
  }
});

export type WebSearchArgs = z.infer<typeof webSearchSchema>;

export interface WebSearchOutput {
  query: string;
  results: WebSearchResult[];
  sourcesGuidance: string;
}

function configFromGateway(config?: AgentGatewayConfig): {
  apiKey?: string;
  endpoint?: string;
  timeoutMs?: number;
} {
  return {
    apiKey: config?.webSearchApiKey,
    endpoint: config?.webSearchEndpoint,
    timeoutMs: config?.webSearchTimeoutMs,
  };
}

export async function executeWebSearch(
  args: WebSearchArgs,
  options: { gatewayConfig?: AgentGatewayConfig; signal?: AbortSignal } = {},
): Promise<WebSearchOutput> {
  const service = createSearchService(configFromGateway(options.gatewayConfig));
  const results = await service.search(args.query, {
    maxResults: args.max_results,
    searchDepth: args.search_depth,
    topic: args.topic,
    allowedDomains: args.allowed_domains,
    blockedDomains: args.blocked_domains,
    signal: options.signal,
  });

  return {
    query: args.query,
    results,
    sourcesGuidance: "Use the source URLs when citing factual claims; verify important claims across sources.",
  };
}

export function formatWebSearchOutput(output: WebSearchOutput): string {
  if (output.results.length === 0) {
    return `No web results found for: ${output.query}`;
  }
  return [
    `Web search results for: ${output.query}`,
    ...output.results.map((result, index) => {
      const metadata = result.publishedDate ? ` (${result.publishedDate})` : "";
      const snippet = result.snippet ? `\n${result.snippet}` : "";
      return `${index + 1}. [${result.title}](${result.url})${metadata}${snippet}`;
    }),
    "Cite the source URLs for factual claims and cross-check important facts.",
  ].join("\n\n");
}
