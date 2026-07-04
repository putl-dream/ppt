import { describe, expect, it } from "vitest";
import { updateSlideVariantTool } from "../src/main/agent/tools/deferred/update-slide-variant";

describe("UpdateSlideVariant deferred tool", () => {
  it("returns update-slide-variant command", async () => {
    const result = await updateSlideVariantTool.execute({
      slideId: "slide-1",
      slideVariant: "hero",
    });

    expect(result.commands).toHaveLength(1);
    expect(result.commands[0]).toMatchObject({
      type: "update-slide-variant",
      slideId: "slide-1",
      slideVariant: "hero",
    });
  });
});
