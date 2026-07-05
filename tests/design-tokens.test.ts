import { describe, expect, it } from "vitest";
import {
  designTokensV1Schema,
  resolveDesignTokenBackgroundVariant,
  resolveDesignTokenColors,
  resolveDesignTokenFontFamily,
  resolveDesignTokens,
} from "../src/shared/design-tokens";

describe("design tokens", () => {
  it("normalizes DesignTokensV1 with version default", () => {
    const tokens = designTokensV1Schema.parse({
      palette: "warm-paper",
      fontMood: "editorial",
      shapeLanguage: "annotation",
      backgroundStyle: "paper",
      motif: "bookmark",
      density: "calm",
      imageTreatment: "framed",
      chartStyle: "minimal",
    });

    expect(tokens.version).toBe(1);
    expect(resolveDesignTokenFontFamily(tokens)).toBe("serif");
    expect(resolveDesignTokenBackgroundVariant(tokens, "hero")).toBe("muted");
  });

  it("resolves palette colors and defaults", () => {
    const tokens = resolveDesignTokens({ palette: "tech-dark", backgroundStyle: "dark" });
    const colors = resolveDesignTokenColors(tokens);

    expect(tokens.fontMood).toBe("formal");
    expect(colors.bg).toBe("#07111f");
    expect(resolveDesignTokenBackgroundVariant(tokens, "default")).toBe("hero");
  });
});
