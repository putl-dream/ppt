import { describe, expect, it } from "vitest";
import { createDefaultToolRegistry } from "../src/main/agent/tools/tool-registry";

const REMOVED_LEGACY_AUTHORING_TOOLS = [
  "ExecuteLayoutPlan",
  "PreviewCommands",
  "SubmitCommands",
  "InsertSlideImage",
  "ValidateDeckLayout",
  "AutoLayoutSlide",
  "ApplyDesignSystem",
  "BeautifyChart",
  "BeautifyTable",
  "ApplyTypography",
  "UpdateSlideVariant",
  "ResolveDesignPlan",
  "CompressText",
  "DetectOverflowText",
  "DetectRepeatedTitles",
  "RewriteSlideContent",
  "AnalyzeDeckConsistency",
] as const;

describe("SVG-native Agent tool surface", () => {
  it("does not register removed legacy authoring tools", () => {
    const registry = createDefaultToolRegistry();
    for (const name of REMOVED_LEGACY_AUTHORING_TOOLS) {
      expect(registry.get(name), name).toBeUndefined();
    }
  });

  it("keeps SVG-native Core tools and an empty Deferred surface", () => {
    const registry = createDefaultToolRegistry();
    const coreNames = new Set(registry.getCoreTools().map((tool) => tool.name));
    const deferredNames = new Set(registry.getDeferredTools().map((tool) => tool.name));

    for (const name of REMOVED_LEGACY_AUTHORING_TOOLS) {
      expect(coreNames.has(name), `${name} must not be Core`).toBe(false);
      expect(deferredNames.has(name), `${name} must not be Deferred`).toBe(false);
      expect(registry.searchDeferredTools(name).map((tool) => tool.name)).not.toContain(name);
    }

    expect(coreNames.has("PreviewSvgPage")).toBe(true);
    expect(coreNames.has("SubmitSvgDeck")).toBe(true);
    expect(coreNames.has("PreviewSlide")).toBe(true);
    expect(deferredNames.size).toBe(0);
  });
});
