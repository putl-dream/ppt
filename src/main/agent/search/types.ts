export type WebSearchDepth = "basic" | "advanced";
export type WebSearchTopic = "general" | "news";

export interface WebSearchOptions {
  maxResults: number;
  searchDepth: WebSearchDepth;
  topic: WebSearchTopic;
  allowedDomains?: string[];
  blockedDomains?: string[];
  signal?: AbortSignal;
}

export interface WebSearchResult {
  title: string;
  url: string;
  snippet?: string;
  publishedDate?: string;
}

export interface WebSearchAdapter {
  readonly name: string;
  search(query: string, options: WebSearchOptions): Promise<WebSearchResult[]>;
}

export interface WebSearchRuntimeConfig {
  apiKey?: string;
  endpoint?: string;
  timeoutMs?: number;
}
