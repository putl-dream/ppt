import { z } from "zod";
import type { ToolDefinition } from "../tool-definition";
import type { PresentationCommand } from "@shared/commands";

export const beautifyTableSchema = z.object({
  slideId: z.string().describe("幻灯片 ID"),
  elementId: z.string().describe("表格文本或 table 元素 ID"),
});

/**
 * Deferred Tool: 将多行文本转为 table 元素，或降级为 concept 卡片组。
 */
export const beautifyTableTool: ToolDefinition<
  typeof beautifyTableSchema,
  { commands: PresentationCommand[] }
> = {
  name: "BeautifyTable",
  description: "将表格文本转为 table 元素（带斑马纹），或多行文本降级为 concept 卡片。",
  category: "deferred",
  loadPolicy: "deferred",
  inputSchema: beautifyTableSchema,
  risk: "medium",
  execute: async (args, context) => {
    const slide = context.presentation.slides.find((item) => item.id === args.slideId);
    if (!slide) return { commands: [] };

    const element = slide.elements.find((item) => item.id === args.elementId);
    if (!element) return { commands: [] };

    if (element.type === "table") {
      return { commands: [] };
    }

    if (element.type !== "text") return { commands: [] };

    const lines = element.text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    if (lines.length === 0) return { commands: [] };

    const pipeRows = lines
      .map((line) => line.split("|").map((cell) => cell.trim()))
      .filter((row) => row.some(Boolean));

    if (pipeRows.length >= 2 && pipeRows[0].length >= 2) {
      return {
        commands: [
          {
            id: crypto.randomUUID(),
            type: "remove-element",
            slideId: args.slideId,
            elementId: args.elementId,
          },
          {
            id: crypto.randomUUID(),
            type: "add-element",
            slideId: args.slideId,
            element: {
              id: crypto.randomUUID(),
              type: "table",
              x: element.x,
              y: element.y,
              width: element.width,
              height: element.height,
              rows: pipeRows,
              headerRow: true,
              zebraStripe: true,
            },
          },
        ],
      };
    }

    const commands: PresentationCommand[] = [
      {
        id: crypto.randomUUID(),
        type: "remove-element",
        slideId: args.slideId,
        elementId: args.elementId,
      },
    ];

    for (const line of lines.slice(0, 4)) {
      commands.push({
        id: crypto.randomUUID(),
        type: "add-element",
        slideId: args.slideId,
        element: {
          id: crypto.randomUUID(),
          type: "text",
          x: element.x,
          y: element.y,
          width: element.width,
          height: 60,
          text: line,
          fontSize: 20,
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
