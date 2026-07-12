import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSessionPresentation } from "../src/shared/session";
import { AgentRuntime } from "../src/main/agent/runtime/agent-runtime";
import type {
  AgentModelContentBlock,
  AgentModelGateway,
  AgentModelRequest,
  AgentModelResponse,
} from "../src/main/agent/gateway/types";
import { ToolRegistry } from "../src/main/agent/tools/tool-registry";
import { webSearchTool } from "../src/main/agent/tools/core/web-search";

const temporaryRoots: string[] = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(temporaryRoots.splice(0).map((path) =>
    rm(path, { recursive: true, force: true })
  ));
});

describe("discover-stage WebSearch routing", () => {
  it("allows a pasted URL to be researched before any TaskGraph exists", async () => {
    const runtimeRoot = await mkdtemp(join(tmpdir(), "agent-ppt-url-search-"));
    temporaryRoots.push(runtimeRoot);
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      results: [{
        title: "Example article",
        url: "https://example.com/article",
        content: "The article argues for evidence-based writing.",
      }],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchImpl);

    const requests: AgentModelRequest[] = [];
    const responses: AgentModelContentBlock[][] = [
      [{
        type: "tool_use",
        id: "search-url",
        name: "WebSearch",
        input: {
          query: "https://example.com/article",
          max_results: 3,
          search_depth: "basic",
          topic: "general",
        },
      }],
      [{ type: "text", text: "The article is clear and evidence-focused." }],
    ];
    let responseIndex = 0;
    const gateway: AgentModelGateway = {
      getGatewayConfig: () => ({
        timeoutMs: 180_000,
        maxOutputTokens: 16_384,
        webSearchApiKey: "tvly-test-key",
      }),
      async generateText(request): Promise<AgentModelResponse> {
        requests.push(request);
        const content = responses[responseIndex++];
        if (!content) throw new Error("Unexpected gateway call");
        return { provider: "openai", model: "test-model", content };
      },
      async *generateTextStream() {
        throw new Error("Streaming was not expected in this test");
      },
    };
    const registry = new ToolRegistry();
    registry.register(webSearchTool);
    const progress: string[] = [];

    const result = await new AgentRuntime(registry, gateway).run({
      threadId: "url-evaluation",
      request: "https://example.com/article 这篇文章怎么样？",
      presentationSnapshot: createSessionPresentation("Article review"),
      selectedElementIds: [],
      runtimeRoot,
      workspaceRoot: runtimeRoot,
      maxSteps: 4,
      onProgress: (event) => progress.push(event.message),
    });

    expect(result).toEqual({
      type: "message",
      content: "The article is clear and evidence-focused.",
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(progress).not.toContain("正在先建立可见任务计划...");
    expect(requests[1]?.messages?.flatMap((message) => message.content)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "tool_result", toolUseId: "search-url" }),
      ]),
    );
  });
});
