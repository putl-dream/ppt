import { afterEach, describe, expect, it, vi } from "vitest";
import { createStarterPresentation } from "../src/shared/presentation";
import { TavilySearchAdapter } from "../src/main/agent/search/tavily-adapter";
import { createSearchService } from "../src/main/agent/search/search-service";
import { webSearchSchema } from "../src/main/agent/search/web-search";
import { webSearchTool } from "../src/main/agent/tools/core/web-search";
import { createDefaultToolRegistry } from "../src/main/agent/tools/tool-registry";
import {
  SUB_AGENT_TOOLS,
  webSearchSubAgentTool,
} from "../src/main/agent/subagent/workspace-tools";
import { SUB_AGENT_TOOL_PERMISSION_PROFILES } from "../src/main/agent/runtime/tool-access-policy";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("web search", () => {
  it("calls Tavily with bounded options and normalizes results", async () => {
    const fetchMock = vi.fn(async (
      _input: Parameters<typeof fetch>[0],
      _init?: Parameters<typeof fetch>[1],
    ) => new Response(JSON.stringify({
      results: [
        {
          title: "Example result",
          url: "https://example.com/article",
          content: "A compact source-backed snippet.",
          published_date: "2026-07-10",
        },
        {
          title: "Duplicate",
          url: "https://example.com/article",
          content: "Should be removed.",
        },
        { title: "Unsafe URL", url: "javascript:alert(1)" },
      ],
    }), { status: 200 }));
    const fetchImpl = fetchMock as unknown as typeof fetch;
    const adapter = new TavilySearchAdapter({
      apiKey: "tvly-secret",
      fetchImpl,
    });

    const results = await adapter.search("agent architecture", {
      maxResults: 5,
      searchDepth: "advanced",
      topic: "general",
      allowedDomains: ["example.com"],
    });

    expect(results).toEqual([{
      title: "Example result",
      url: "https://example.com/article",
      snippet: "A compact source-backed snippet.",
      publishedDate: "2026-07-10",
    }]);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, request] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.tavily.com/search");
    expect((request?.headers as Record<string, string>).Authorization).toBe("Bearer tvly-secret");
    expect(JSON.parse(String(request?.body))).toMatchObject({
      query: "agent architecture",
      search_depth: "advanced",
      max_results: 5,
      include_domains: ["example.com"],
      include_answer: false,
      include_raw_content: false,
    });
  });

  it("reports missing configuration without making a request", () => {
    expect(() => createSearchService({}, {})).toThrow("Tavily API key");
  });

  it("rejects simultaneous allow and block domain lists", () => {
    const result = webSearchSchema.safeParse({
      query: "test",
      allowed_domains: ["example.com"],
      blocked_domains: ["spam.example"],
    });
    expect(result.success).toBe(false);
  });

  it("registers WebSearch for the main agent and web_search for Task sub-agents", () => {
    expect(createDefaultToolRegistry().get("WebSearch")).toBe(webSearchTool);
    expect(SUB_AGENT_TOOLS).toContain(webSearchSubAgentTool);
    expect(webSearchSubAgentTool.permission).toBe(SUB_AGENT_TOOL_PERMISSION_PROFILES.web_search);
  });

  it("uses per-run gateway configuration and returns citation-ready model content", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      results: [{
        title: "Official source",
        url: "https://docs.example.com/fact",
        content: "Verified fact.",
      }],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchImpl);

    const context = {
      presentation: createStarterPresentation(),
      selectedElementIds: [],
      discoverySession: { discoveredToolNames: new Set<string>() },
      registry: createDefaultToolRegistry(),
      messageHistory: [],
      gateway: {
        getGatewayConfig: () => ({
          timeoutMs: 180_000,
          maxOutputTokens: 16_384,
          webSearchApiKey: "tvly-runtime-key",
        }),
        async generateText() { throw new Error("not used"); },
        async *generateTextStream() { throw new Error("not used"); },
      },
    };

    const output = await webSearchTool.execute({
      query: "verified fact",
      max_results: 3,
      search_depth: "basic",
      topic: "general",
    }, context);
    const modelContent = await webSearchTool.mapResultToModelContent!(output, context);

    expect(modelContent).toContain("[Official source](https://docs.example.com/fact)");
    expect(modelContent).toContain("Cite the source URLs");
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});
