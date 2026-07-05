import { describe, expect, it } from "vitest";
import { StyleStrategies } from "../src/main/agent/design/style-strategies";
import { VISUAL_TOKENS } from "../src/shared/visual-tokens";

describe("visual tokens", () => {
  it("defines radii and elevation presets", () => {
    expect(VISUAL_TOKENS.radii.md).toBe(12);
    expect(VISUAL_TOKENS.elevation.md?.blur).toBe(16);
    expect(VISUAL_TOKENS.spacing.lg).toBe(32);
    expect(VISUAL_TOKENS.motif.bookmark.width).toBe(18);
  });

  it("style strategies include radii, elevation, and gradient", () => {
    const strategy = StyleStrategies.get("tech-blue");
    expect(strategy).toBeDefined();
    expect(strategy?.radii.md).toBe(12);
    expect(strategy?.elevation.md.blur).toBe(16);
    expect(strategy?.gradient?.type).toBe("linear");
  });
});
