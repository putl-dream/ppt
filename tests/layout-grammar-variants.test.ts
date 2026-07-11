import { describe, expect, it } from "vitest";

import { LayoutValidator } from "../src/main/deck/validators/layout-validator";
import type { DesignTokensV1 } from "../src/shared/design-tokens";
import { applyLayout } from "../src/shared/layout";
import { layoutGrammarRegistry } from "../src/shared/layout-grammar";
import { getLayoutSlotRect, listLayoutSlots } from "../src/shared/layout-slots";
import type { Presentation, Slide, TextElement } from "../src/shared/presentation";

const BASE_TOKENS: DesignTokensV1 = {
  version: 1,
  palette: "business-blue",
  fontMood: "formal",
  shapeLanguage: "cards",
  backgroundStyle: "clean",
  motif: "none",
  density: "standard",
  imageTreatment: "plain",
  chartStyle: "minimal",
};

function textElement(text: string, fontSize = 20): TextElement {
  return {
    id: crypto.randomUUID(),
    type: "text",
    x: 0,
    y: 0,
    width: 300,
    height: 80,
    text,
    fontSize,
  };
}

function processSlide(): Slide {
  return {
    id: crypto.randomUUID(),
    title: "Delivery process",
    elements: ["Discover", "Design", "Build", "Validate"].map((text) => textElement(text)),
  };
}

function caseSlide(withImage = false): Slide {
  return {
    id: crypto.randomUUID(),
    title: "Business impact",
    elements: [
      textElement("Deployment became faster while quality remained stable."),
      textElement("67% faster", 32),
      ...(withImage ? [{
        id: crypto.randomUUID(),
        type: "image" as const,
        x: 0,
        y: 0,
        width: 320,
        height: 240,
        url: "data:image/png;base64,AA==",
        borderRadius: 0,
      }] : []),
    ],
  };
}

function imageGridSlide(): Slide {
  return {
    id: crypto.randomUUID(),
    title: "Evidence gallery",
    elements: [
      ...[0, 1, 2].map((index) => ({
        id: crypto.randomUUID(),
        type: "image" as const,
        x: 0,
        y: 0,
        width: 320,
        height: 240,
        url: `data:image/png;base64,${index}`,
        borderRadius: 0,
      })),
      ...["Primary evidence", "Detail A", "Detail B"].map((text) => textElement(text, 16)),
    ],
  };
}

function expectNoLayoutErrorsOrUnexpectedOverlaps(slide: Slide): void {
  const presentation: Presentation = {
    id: crypto.randomUUID(),
    title: "Grammar QA",
    revision: 1,
    theme: "ocean",
    palette: "cyan",
    slides: [slide],
  };
  const issues = new LayoutValidator().validate(presentation);
  expect(issues.filter((issue) => issue.severity === "error")).toEqual([]);
  expect(issues.filter((issue) => issue.message.includes("overlap"))).toEqual([]);
}

describe("layout grammar variants", () => {
  it("registers the four P1 grammar families and their supported variants", () => {
    expect(layoutGrammarRegistry.get("section")?.supportedVariants).toEqual([
      "centered", "editorial-split", "band",
    ]);
    expect(layoutGrammarRegistry.get("process")?.supportedVariants).toEqual([
      "cards", "timeline", "path", "steps",
    ]);
    expect(layoutGrammarRegistry.get("case")?.supportedVariants).toEqual([
      "split", "metric-focus", "evidence",
    ]);
    expect(layoutGrammarRegistry.get("image-grid")?.supportedVariants).toEqual([
      "grid", "hero-caption", "filmstrip", "evidence-wall",
    ]);
  });

  it("exposes image slots that follow section and case grammar geometry", () => {
    expect(listLayoutSlots("section", "editorial-split")).toContain("hero");
    const split = getLayoutSlotRect("case", "side", "auto", "split");
    const evidence = getLayoutSlotRect("case", "side", "auto", "evidence");
    expect(evidence?.width).toBeGreaterThan(split?.width ?? 0);
    expect(evidence?.x).toBeLessThan(split?.x ?? 0);
  });

  it("produces distinct section silhouettes", () => {
    const base: Slide = {
      id: crypto.randomUUID(),
      title: "Chapter One",
      elements: [textElement("Chapter One", 52), textElement("A focused transition")],
    };
    const centered = applyLayout(base, "section", "nordic", "cyan", {
      grammarVariant: "centered",
      designTokens: BASE_TOKENS,
    });
    const editorial = applyLayout(base, "section", "nordic", "cyan", {
      grammarVariant: "editorial-split",
      designTokens: { ...BASE_TOKENS, shapeLanguage: "editorial" },
    });
    const centeredTitle = centered.elements.find((element) => element.type === "text" && element.text === "Chapter One");
    const editorialTitle = editorial.elements.find((element) => element.type === "text" && element.text === "Chapter One");

    expect(centered.grammarVariant).toBe("centered");
    expect(editorial.grammarVariant).toBe("editorial-split");
    expect(centeredTitle?.x).not.toBe(editorialTitle?.x);
    expectNoLayoutErrorsOrUnexpectedOverlaps(centered);
    expectNoLayoutErrorsOrUnexpectedOverlaps(editorial);
  });

  it.each(["cards", "timeline", "path", "steps"] as const)(
    "renders a valid process %s variant",
    (variant) => {
      const laidOut = applyLayout(processSlide(), "process", "ocean", "cyan", {
        grammarVariant: variant,
        designTokens: BASE_TOKENS,
      });
      expect(laidOut.grammarVariant).toBe(variant);
      expect(laidOut.elements.filter((element) => element.id.startsWith("num-"))).toHaveLength(4);
      expectNoLayoutErrorsOrUnexpectedOverlaps(laidOut);
    },
  );

  it("infers path process grammar from design tokens", () => {
    const laidOut = applyLayout(processSlide(), "process", "ocean", "cyan", {
      designTokens: { ...BASE_TOKENS, shapeLanguage: "path", motif: "path-line" },
    });
    expect(laidOut.grammarVariant).toBe("path");
  });

  it("switches case composition between metric focus and visual evidence", () => {
    const metric = applyLayout(caseSlide(), "case", "ocean", "cyan", {
      grammarVariant: "metric-focus",
      designTokens: { ...BASE_TOKENS, chartStyle: "dashboard" },
    });
    const evidence = applyLayout(caseSlide(true), "case", "ocean", "cyan", {
      grammarVariant: "evidence",
      designTokens: { ...BASE_TOKENS, imageTreatment: "framed" },
    });
    const evidenceImage = evidence.elements.find((element) => element.type === "image");

    expect(metric.elements.some((element) => element.type === "text" && element.textRole === "metric")).toBe(true);
    expect(evidenceImage?.type === "image" ? evidenceImage.width : 0).toBeGreaterThan(600);
    expectNoLayoutErrorsOrUnexpectedOverlaps(metric);
    expectNoLayoutErrorsOrUnexpectedOverlaps(evidence);
  });

  it.each(["grid", "hero-caption", "filmstrip", "evidence-wall"] as const)(
    "renders a valid image-grid %s variant",
    (variant) => {
      const laidOut = applyLayout(imageGridSlide(), "image-grid", "ocean", "cyan", {
        grammarVariant: variant,
        designTokens: { ...BASE_TOKENS, imageTreatment: "framed" },
      });
      expect(laidOut.grammarVariant).toBe(variant);
      expect(laidOut.elements.filter((element) => element.type === "image").length).toBeGreaterThan(0);
      expectNoLayoutErrorsOrUnexpectedOverlaps(laidOut);
    },
  );
});
