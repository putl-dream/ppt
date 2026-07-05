import { describe, expect, it } from "vitest";
import { updateSlideVariantTool } from "../src/main/agent/tools/deferred/update-slide-variant";
import type { Presentation } from "../src/shared/presentation";
import type { ToolContext } from "../src/main/agent/tools/tool-definition";

function makeContext(): ToolContext {
  const presentation: Presentation = {
    id: "presentation-1",
    title: "Test",
    revision: 0,
    slides: [],
  };
  return {
    presentation,
    selectedElementIds: [],
    discoverySession: { discoveredToolNames: new Set() },
    registry: {} as ToolContext["registry"],
    messageHistory: [],
  };
}

describe("UpdateSlideVariant deferred tool", () => {
  it("returns update-slide-variant command", async () => {
    const result = await updateSlideVariantTool.execute({
      slideId: "slide-1",
      slideVariant: "hero",
    }, makeContext());

    expect(result.commands).toHaveLength(1);
    expect(result.commands[0]).toMatchObject({
      type: "update-slide-variant",
      slideId: "slide-1",
      slideVariant: "hero",
    });
  });
});
