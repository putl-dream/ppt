import { TavilySearchAdapter } from "./tavily-adapter";
import type {
  WebSearchAdapter,
  WebSearchOptions,
  WebSearchResponse,
  WebSearchRuntimeConfig,
} from "./types";
import { resolveEnvironmentWebSearchApiKey } from "../../environment-credential-policy";

export class SearchService {
  constructor(private readonly adapters: WebSearchAdapter[]) {
    if (adapters.length === 0) throw new Error("At least one web search adapter is required.");
  }

  async search(query: string, options: WebSearchOptions): Promise<WebSearchResponse> {
    let lastError: unknown;
    for (const adapter of this.adapters) {
      try {
        return await adapter.search(query, options);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error("Web search failed.");
  }
}

export function createSearchService(
  config: WebSearchRuntimeConfig = {},
  env: NodeJS.ProcessEnv = process.env,
): SearchService {
  const runtimeApiKey = config.apiKey?.trim();
  const requestedEndpoint = config.endpoint?.trim();
  const environmentApiKey = runtimeApiKey
    ? undefined
    : resolveEnvironmentWebSearchApiKey(requestedEndpoint, env);
  const apiKey = runtimeApiKey || environmentApiKey;
  if (!apiKey) {
    throw new Error(
      "Web search is not configured. Add a Tavily API key in Settings → 生成参数, "
      + "or set TAVILY_API_KEY.",
    );
  }

  return new SearchService([
    new TavilySearchAdapter({
      apiKey,
      endpoint: requestedEndpoint
        || (runtimeApiKey ? undefined : env.TAVILY_SEARCH_ENDPOINT?.trim()),
      timeoutMs: config.timeoutMs,
    }),
  ]);
}
