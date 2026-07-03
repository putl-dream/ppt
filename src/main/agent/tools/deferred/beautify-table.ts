import { z } from "zod";
import type { ToolDefinition } from "../tool-definition";
import type { PresentationCommand } from "@shared/commands";

export const beautifyTableSchema = z.object({
  slideId: z.string().describe("幻灯片 ID"),
  elementId: z.string().describe("表格状文本元素 ID（多行内容）"),
});

/**
 * Deferred Tool: 将表格状文本降级为 concept 卡片组排版。
 */
export const beautifyTableTool: ToolDefinition<
  typeof beautifyTableSchema,
  { commands: PresentationCommand[] }
> = {
  name: "BeautifyTable",
  description: "将多行表格文本拆分为独立要点并应用 concept 卡片排版。",
  category: "deferred",
  loadPolicy: "deferred",
  inputSchema: beautifyTableSchema,
  risk: "medium",
  execute: async (args, context) => {
    const slide = context.presentation.slides.find((item) => item.id === args.slideId);
    if (!slide) return { commands: [] };

    const element = slide.elements.find((item) => item.id === args.elementId);
    if (!element || element.type !== "text") return { commands: [] };

    const rows = element.text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    if (rows.length < 2) {
      return {
        commands: [
          {
            id: crypto.randomUUID(),
            type: "update-slide-layout",
            slideId: args.slideId,
            layout: "concept",
          },
        ],
      };
    }

    const commands: PresentationCommand[] = [
      {
        id: crypto.randomUUID(),
        type: "remove-element",
        slideId: args.slideId,
        elementId: element.id,
      },
    ];

    for (const row of rows.slice(0, 4)) {
      commands.push({
        id: crypto.randomUUID(),
        type: "add-element",
        slideId: args.slideId,
        element: {
          id: crypto.randomUUID(),
          type: "text",
          x: 0,
          y: 0,
          width: 400,
          height: 80,
          text: row,
          fontSize: 20,
          textRole: "body",
        },
      });
    }

    commands.push({
      id: crypto.randomUUID(),
      type: "update-slide-layout",
      slideId: args.slideId,
      layout: "concept",
    });

    return { commands };
  },
};
