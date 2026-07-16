import { describe, expect, it } from "vitest";
import { beautifyChartTool } from "../src/main/agent/tools/deferred/beautify-chart";
import { beautifyTableTool } from "../src/main/agent/tools/deferred/beautify-table";
import type { Presentation } from "../src/shared/presentation";
import type { ToolContext } from "../src/main/agent/tools/tool-definition";
import { TEST_DESIGN_SYSTEM } from "./design-engine-test-utils";

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
  it("BeautifyChart styles numeric text without inventing chart data", async () => {
    const metricId = crypto.randomUUID();
    const slideId = crypto.randomUUID();
    const presentation: Presentation = {
      id: crypto.randomUUID(),
      title: "Deck",
      revision: 1,
      designSystem: TEST_DESIGN_SYSTEM,
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

    expect(result.commands).toHaveLength(1);
    expect(result.commands[0]?.type).toBe("update-text-style");
    if (result.commands[0]?.type === "update-text-style") {
      expect(result.commands[0]).toMatchObject({
        elementId: metricId,
        textRole: "metric",
        bold: true,
      });
    }
  });

  it("BeautifyTable preserves every row of a pipe-delimited table", async () => {
    const tableId = crypto.randomUUID();
    const slideId = crypto.randomUUID();
    const presentation: Presentation = {
      id: crypto.randomUUID(),
      title: "Deck",
      revision: 1,
      designSystem: TEST_DESIGN_SYSTEM,
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
              text: [
                "| 阶段 | 状态 |",
                "| --- | --- |",
                "| 上半年 | 已完成 |",
                "| 当前 | 处理中 |",
                "| 下半年 | 待启动 |",
                "| 收尾 | 待复盘 |",
              ].join("\n"),
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

    expect(result.commands).toHaveLength(2);
    expect(result.commands[0]?.type).toBe("remove-element");
    expect(result.commands[1]?.type).toBe("add-element");
    if (result.commands[1]?.type === "add-element") {
      expect(result.commands[1].element.type).toBe("table");
      if (result.commands[1].element.type === "table") {
        expect(result.commands[1].element.rows).toEqual([
          ["阶段", "状态"],
          ["上半年", "已完成"],
          ["当前", "处理中"],
          ["下半年", "待启动"],
          ["收尾", "待复盘"],
        ]);
      }
    }
  });

  it("BeautifyTable rejects prose instead of deleting or truncating it", async () => {
    const slideId = crypto.randomUUID();
    const elementId = crypto.randomUUID();
    const presentation: Presentation = {
      id: crypto.randomUUID(),
      title: "Deck",
      revision: 1,
      designSystem: TEST_DESIGN_SYSTEM,
      slides: [{
        id: slideId,
        title: "正文",
        elements: [{
          id: elementId,
          type: "text",
          x: 120,
          y: 180,
          width: 500,
          height: 240,
          text: "第一条\n第二条\n第三条\n第四条\n第五条",
          fontSize: 20,
        }],
      }],
    };

    await expect(beautifyTableTool.execute(
      { slideId, elementId },
      makeContext(presentation),
    )).rejects.toThrow("not a rectangular pipe-delimited table");
  });
});
