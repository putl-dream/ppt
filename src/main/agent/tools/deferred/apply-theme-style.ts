import { z } from "zod";
import type { ToolDefinition } from "../tool-definition";
import type { PresentationCommand } from "@shared/commands";

export const applyThemeStyleSchema = z.object({
  theme: z.string().describe("目标主题名称，例如 'nordic', 'tech'"),
  palette: z.string().optional().describe("目标调色板配色方案，如 'cyan', 'warm'"),
});

/**
 * Deferred Tool: 应用主题样式。
 * 生成用于更新整套 PPT 主题风格的 PresentationCommand。
 */
export const applyThemeStyleTool: ToolDefinition<
  typeof applyThemeStyleSchema,
  { commands: PresentationCommand[] }
> = {
  name: "ApplyThemeStyle",
  description: "应用选定的主题和配色方案到当前演示文稿。",
  category: "deferred",
  loadPolicy: "deferred",
  inputSchema: applyThemeStyleSchema,
  risk: "medium",
  execute: async (args) => {
    const commands: PresentationCommand[] = [
      {
        id: crypto.randomUUID(),
        type: "set-theme",
        theme: args.theme,
        palette: args.palette,
      },
    ];
    return { commands };
  },
};
