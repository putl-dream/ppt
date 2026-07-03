import { describe, expect, it } from "vitest";
import {
  resolveLayoutBackgroundVariant,
  resolveSlideBackground,
} from "../src/shared/slide-background";

describe("slide-background", () => {
  it("maps cover/section to hero and content layouts to default", () => {
    expect(resolveLayoutBackgroundVariant("cover")).toBe("hero");
    expect(resolveLayoutBackgroundVariant("section")).toBe("hero");
    expect(resolveLayoutBackgroundVariant("concept")).toBe("default");
    expect(resolveLayoutBackgroundVariant("case")).toBe("default");
  });

  it("differentiates hero and default backgrounds for nordic", () => {
    const hero = resolveSlideBackground("nordic", "cyan", "hero");
    const content = resolveSlideBackground("nordic", "cyan", "default");
    expect(hero.slideBg).not.toBe(content.slideBg);
    expect(hero.exportFill).toBe("#fbfbfa");
    expect(content.exportFill).toBe("#ffffff");
  });

  it("uses gradient hero and flat default for ocean", () => {
    const hero = resolveSlideBackground("ocean", "cyan", "hero");
    const content = resolveSlideBackground("ocean", "cyan", "default");
    expect(hero.slideBg).toContain("gradient");
    expect(content.slideBg).toBe("#0f172a");
    expect(hero.exportFill).toBe("#0f172a");
  });
});
