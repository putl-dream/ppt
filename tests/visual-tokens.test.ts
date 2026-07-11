import { describe, expect, it } from "vitest";
import { DESIGN_PRESETS, resolveSlideStyle } from "../src/design-system";
import {
  createMarginNoteMotif,
  createPathLineMotif,
  type MotifColors,
} from "../src/shared/motif-system";
import { slideElementSchema } from "../src/shared/presentation";
import { VISUAL_TOKENS } from "../src/shared/visual-tokens";

describe("visual tokens", () => {
  it("defines radii and elevation presets", () => {
    expect(VISUAL_TOKENS.radii.md).toBe(12);
    expect(VISUAL_TOKENS.elevation.md?.blur).toBe(16);
    expect(VISUAL_TOKENS.spacing.lg).toBe(32);
    expect(VISUAL_TOKENS.motif.bookmark.width).toBe(18);
  });

  it("design presets resolve complete renderer-ready styles", () => {
    const preset = DESIGN_PRESETS.find((item) => item.id === "technical");
    expect(preset).toBeDefined();
    const style = resolveSlideStyle(preset!.system, {});
    expect(style.mode).toBe("dark");
    expect(style.background.fill).toBe(style.colors.bg);
    expect(style.typography.family).toBe("mono");
  });

  it("creates schema-valid motif line elements", () => {
    const colors: MotifColors = {
      bg: "#ffffff",
      accent: "#0ea5e9",
      cardBg: "#f8fafc",
      cardStroke: "#cbd5e1",
    };

    const motifs = [
      ...createMarginNoteMotif(colors),
      ...createPathLineMotif(colors),
    ];

    expect(motifs.filter((element) => element.shapeType === "line")).toHaveLength(2);
    for (const element of motifs) {
      expect(slideElementSchema.safeParse(element).success).toBe(true);
    }
  });
});
