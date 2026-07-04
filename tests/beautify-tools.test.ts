import { describe, expect, it } from "vitest";
import { beautifyChartTool } from "../src/main/agent/tools/deferred/beautify-chart";
import { beautifyTableTool } from "../src/main/agent/tools/deferred/beautify-table";
import type { Presentation } from "../src/shared/presentation";
import type { ToolContext } from "../src/main/agent/tools/tool-definition";

function makeContext(presentation: Presentation): ToolContext {
  return {
    presentation,
    selectedElementIds: [],
    discoverySession: { discoveredToolNames: new Set() },
    registry: {} as ToolContext["registry"],
    messageHistory: [],
  };
}

describe("beautify deferred tools", () => {
  it("BeautifyChart returns metric styling commands for numeric text", async () => {
    const metricId = crypto.randomUUID();
    const slideId = crypto.randomUUID();
    const presentation: Presentation = {
      id: crypto.randomUUID(),
      title: "Deck",
      revision: 1,
      theme: "ocean",
      palette: "cyan",
      slides: [
        {
          id: slideId,
          title: "关键指标",
          layout: "case",
          elements: [
            {
              id: crypto.randomUUID(),
              type: "text",
              x: 0,
              y: 0,
              width: 200,
              height: 80,
              text: "说明",
              fontSize: 20,
            },
            {
              id: metricId,
              type: "text",
              x: 0,
              y: 0,
              width: 200,
              height: 80,
              text: "76%",
              fontSize: 28,
            },
          ],
        },
      ],
    };

    const result = await beautifyChartTool.execute(
      { slideId, elementId: metricId },
      makeContext(presentation),
    );

    expect(result.commands.length).toBe(2);
    expect(result.commands[0]?.type).toBe("remove-element");
    expect(result.commands[1]?.type).toBe("add-element");
    if (result.commands[1]?.type === "add-element") {
      expect(result.commands[1].element.type).toBe("chart");
    }
  });

  it("BeautifyTable splits multiline text and applies concept layout", async () => {
    const tableId = crypto.randomUUID();
    const slideId = crypto.randomUUID();
    const presentation: Presentation = {
      id: crypto.randomUUID(),
      title: "Deck",
      revision: 1,
      slides: [
        {
          id: slideId,
          title: "目录",
          elements: [
            {
              id: tableId,
              type: "text",
              x: 0,
              y: 0,
              width: 500,
              height: 200,
              text: "上半年情况\n问题方案\n下半年计划",
              fontSize: 20,
            },
          ],
        },
      ],
    };

    const result = await beautifyTableTool.execute(
      { slideId, elementId: tableId },
      makeContext(presentation),
    );

    expect(result.commands.length).toBeGreaterThan(2);
    expect(result.commands.some((cmd) => cmd.type === "remove-element")).toBe(true);
    expect(result.commands.filter((cmd) => cmd.type === "add-element").length).toBe(3);
    expect(result.commands.at(-1)?.type).toBe("update-slide-layout");
  });
});
