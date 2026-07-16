import { z } from "zod";
import type { ToolDefinition } from "../tool-definition";
import type { PresentationCommand } from "@shared/commands";

export const beautifyTableSchema = z.object({
  slideId: z.string().describe("幻灯片 ID"),
  elementId: z.string().describe("表格文本或 table 元素 ID"),
});

function parsePipeTable(text: string): string[][] | null {
  const rows = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const withoutEdges = line.replace(/^\|/, "").replace(/\|$/, "");
      return withoutEdges.split("|").map((cell) => cell.trim());
    });

  if (rows.length < 2 || rows[0].length < 2) return null;
  const columnCount = rows[0].length;
  if (rows.some((row) => row.length !== columnCount)) return null;

  const isSeparatorRow = (row: string[]) =>
    row.every((cell) => /^:?-{3,}:?$/.test(cell));
  const normalized = rows.filter((row, index) => index !== 1 || !isSeparatorRow(row));
  return normalized.length >= 2 ? normalized : null;
}

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
    if (!slide) throw new Error(`Slide '${args.slideId}' was not found.`);

    const element = slide.elements.find((item) => item.id === args.elementId);
    if (!element) {
      throw new Error(`Element '${args.elementId}' was not found on slide '${args.slideId}'.`);
    }

    if (element.type === "table") {
      if (element.headerRow && element.zebraStripe) return { commands: [] };
      return {
        commands: [{
          id: crypto.randomUUID(),
          type: "update-element",
          slideId: args.slideId,
          elementId: args.elementId,
          element: {
            ...element,
            headerRow: true,
            zebraStripe: true,
          },
        }],
      };
    }

    if (element.type !== "text") {
      throw new Error("BeautifyTable only accepts a table or pipe-delimited text element.");
    }

    const rows = parsePipeTable(element.text);
    if (!rows) {
      throw new Error(
        "The selected text is not a rectangular pipe-delimited table. "
        + "Use AutoLayoutSlide for prose or provide explicit table rows.",
      );
    }

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
            rows,
            headerRow: true,
            zebraStripe: true,
          },
        },
      ],
    };
  },
};
