import { z } from "zod";
import type { ToolDefinition } from "../tool-definition";
import type { ToolCard } from "../tool-card";
import { toToolCard } from "../tool-card";

export const searchExtraToolsSchema = z.object({
  query: z.string().describe("搜索词，支持按延迟工具名称或核心功能描述进行搜索"),
});

/**
 * Core Tool: 搜索未默认加载的 Deferred Tools。
 * 仅在 Core Tools 无法完成任务时使用，支持按名称精确选择和按能力关键词查询。
 * 搜索范围必须排除 core、runtime、disabled 和未授权工具。
 * 每次实际返回的工具名必须写入当前 thread 的 ToolDiscoverySession。
 */
export const searchExtraToolsTool: ToolDefinition<
  typeof searchExtraToolsSchema,
  { tools: ToolCard[]; baseEditingAvailable: true; guidance: string }
> = {
  name: "SearchExtraTools",
  description: "发现并搜索其他未默认加载的延迟工具（Deferred Tools）。",
  category: "core",
  loadPolicy: "core",
  inputSchema: searchExtraToolsSchema,
  risk: "low",
  execute: async (args, context) => {
    const matches: ToolCard[] = context.registry
      .searchDeferredTools(args.query)
      .map(toToolCard);

    for (const match of matches) {
      context.discoverySession.discoveredToolNames.add(match.name);
    }

    return {
      tools: matches,
      baseEditingAvailable: true,
      guidance: matches.length > 0
        ? "Deferred tools are optional enhancements. Create and edit slides directly with PresentationCommand through SubmitCommands."
        : "No matching Deferred Tool was found. This does not block PPT creation: use add-slide, add-element, set-design-system and other PresentationCommand values through SubmitCommands.",
    };
  },
};
