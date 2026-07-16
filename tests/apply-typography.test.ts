import { describe, expect, it } from "vitest";
import { applyTypographyTool } from "../src/main/agent/tools/deferred/apply-typography";
import type { ToolContext } from "../src/main/agent/tools/tool-definition";
import type { Presentation } from "../src/shared/presentation";
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

describe("ApplyTypography", () => {
  it("recomputes existing fonts and applies visible metric styling", async () => {
    const presentation: Presentation = {
      id: "deck-1",
      title: "Deck",
      revision: 1,
      designSystem: TEST_DESIGN_SYSTEM,
      slides: [{
        id: "slide-1",
        title: "Metrics",
        elements: [
          {
            id: "body",
            type: "text",
            x: 120,
            y: 180,
            width: 500,
            height: 100,
            text: "Body",
            fontSize: 20,
            textRole: "body",
            fontFamily: "serif",
          },
          {
            id: "metric",
            type: "text",
            x: 120,
            y: 320,
            width: 300,
            height: 100,
            text: "92%",
            fontSize: 24,
            textRole: "metric",
            fontFamily: "serif",
          },
        ],
      }],
    };

    const result = await applyTypographyTool.execute({}, makeContext(presentation));
    expect(result.commands).toHaveLength(2);
    expect(result.commands).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "update-text-style",
        elementId: "body",
        fontFamily: "sans",
      }),
      expect.objectContaining({
        type: "update-text-style",
        elementId: "metric",
        fontFamily: "sans",
        bold: true,
        fontSize: 32,
      }),
    ]));
  });
});

