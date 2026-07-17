import { describe, expect, it } from "vitest";
import { CommitGate } from "../src/main/agent/gate/commit-gate";
import { RiskPolicy } from "../src/main/agent/gate/risk-policy";
import type { Presentation, TextElement } from "../src/shared/presentation";
import { TEST_DESIGN_SYSTEM } from "./design-engine-test-utils";

function createPresentation(text = "Stable body text"): {
  presentation: Presentation;
  slideId: string;
  element: TextElement;
} {
  const slideId = "slide-1";
  const element: TextElement = {
    id: "text-1",
    type: "text",
    x: 120,
    y: 180,
    width: 500,
    height: 120,
    text,
    fontSize: 24,
  };
  return {
    slideId,
    element,
    presentation: {
      id: "deck-1",
      title: "Deck",
      revision: 1,
      designSystem: TEST_DESIGN_SYSTEM,
      slides: [{
        id: slideId,
        title: "Safe slide",
        elements: [element],
      }],
    },
  };
}

describe("CommitGate validation integration", () => {
  it("rejects severe in-place text truncation", async () => {
    const source = "A".repeat(200);
    const { presentation, slideId, element } = createPresentation(source);
    const gate = new CommitGate(new RiskPolicy());
    const result = await gate.evaluate(
      presentation,
      [{
        id: "cmd-truncate",
        type: "update-element",
        slideId,
        elementId: element.id,
        element: { ...element, text: "Short" },
      }],
      "low",
    );

    expect(result.success).toBe(false);
    expect(result.decision).toBe("REJECT");
    expect(result.errors.join(" ")).toContain("lost more than 75%");
  });

  it("rejects newly introduced layout errors", async () => {
    const { presentation, slideId } = createPresentation();
    const gate = new CommitGate(new RiskPolicy());
    const result = await gate.evaluate(
      presentation,
      [{
        id: "cmd-outside",
        type: "add-element",
        slideId,
        element: {
          id: "outside",
          type: "text",
          x: 10,
          y: 10,
          width: 200,
          height: 80,
          text: "Outside safe margin",
          fontSize: 20,
        },
      }],
      "low",
    );

    expect(result.success).toBe(false);
    expect(result.errors.join(" ")).toContain("outside the safe margin");
  });

  it("requires approval for newly introduced validation warnings", async () => {
    const { presentation, slideId } = createPresentation();
    const gate = new CommitGate(new RiskPolicy());
    const result = await gate.evaluate(
      presentation,
      [{
        id: "cmd-overlap",
        type: "add-element",
        slideId,
        element: {
          id: "overlap",
          type: "text",
          x: 160,
          y: 200,
          width: 300,
          height: 80,
          text: "Overlapping content",
          fontSize: 20,
        },
      }],
      "low",
    );

    expect(result.success).toBe(true);
    expect(result.decision).toBe("REQUIRES_APPROVAL");
    expect(result.warnings?.join(" ")).toContain("overlap");
  });

  it("rejects switching to an image-dependent layout without an image", async () => {
    const { presentation, slideId } = createPresentation();
    const gate = new CommitGate(new RiskPolicy());
    const result = await gate.evaluate(
      presentation,
      [{
        id: "cmd-evidence-layout",
        type: "update-slide-layout",
        slideId,
        layout: "case",
        grammarVariant: "evidence",
      }],
      "low",
      { workspaceRoot: "C:\\workspace" },
    );

    expect(result.success).toBe(false);
    expect(result.decision).toBe("REJECT");
    expect(result.errors.join(" ")).toContain("missing a required image");
  });
});
