import { describe, expect, it } from "vitest";
import { DESIGN_PRESETS, resolveSlideStyle } from "../src/design-system";
import { type CardShadow, cardShadow, VISUAL_TOKENS } from "../src/shared/visual-tokens";

describe("visual tokens", () => {
  it("defines radii and elevation presets", () => {
    expect(VISUAL_TOKENS.radii.md).toBe(12);
    expect(VISUAL_TOKENS.elevation.md?.blur).toBe(16);
    expect(VISUAL_TOKENS.spacing.lg).toBe(32);
    expect(VISUAL_TOKENS.motif.bookmark.width).toBe(18);
  });

  it("design presets resolve complete renderer-ready styles", () => {
    const preset = DESIGN_PRESETS.find((item) => item.id === "dark-tech");
    expect(preset).toBeDefined();
    const style = resolveSlideStyle(preset!.system, {});
    expect(style.mode).toBe("dark");
    expect(style.background.fill).toBe(style.colors.bg);
    expect(style.typography.data.family).toBe("mono");
    expect(style.layoutTokens.chartStyle).toBe("dashboard");
  });

  it("returns typed card shadow presets", () => {
    const shadow: CardShadow | undefined = cardShadow("md");
    expect(shadow).toMatchObject({
      blur: 16,
      offsetY: 4,
      opacity: 0.1,
    });
    expect(cardShadow("none")).toBeUndefined();
  });
});
