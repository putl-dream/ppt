import { describe, expect, it } from "vitest";
import { renderGradientToPng } from "../src/shared/gradient-export";
import { resolveSlideBackgroundWithVariant } from "../src/shared/slide-variant";

describe("gradient-export", () => {
  it("produces a valid PNG data URI for linear gradient", () => {
    const dataUri = renderGradientToPng({
      type: "linear",
      angle: 135,
      stops: [
        { color: "#0f172a", pos: 0 },
        { color: "#1e293b", pos: 100 },
      ],
    });
    expect(dataUri.startsWith("data:image/png;base64,")).toBe(true);
    expect(dataUri.length).toBeGreaterThan(1000);
  });

  it("produces a valid PNG data URI for radial gradient", () => {
    const dataUri = renderGradientToPng({
      type: "radial",
      stops: [
        { color: "#1c1537", pos: 0 },
        { color: "#0d091a", pos: 100 },
      ],
    });
    expect(dataUri.startsWith("data:image/png;base64,")).toBe(true);
  });

  it("hero slide variant includes structured gradient", () => {
    const bg = resolveSlideBackgroundWithVariant("nordic", "cyan", {
      layout: "cover",
    });
    expect(bg.gradient).toBeDefined();
    expect(bg.gradient?.type).toBe("linear");
    expect(bg.gradient?.stops.length).toBeGreaterThanOrEqual(2);
  });
});
