import { describe, expect, it } from "vitest";
import {
  createStarterPresentation,
  presentationSchema,
  slideSchema,
} from "../src/shared/presentation";
import { repairPresentationIdentities } from "../src/shared/presentation-repair";

describe("presentation identity validation", () => {
  it("rejects duplicate element ids within a slide", () => {
    const presentation = createStarterPresentation();
    const slide = presentation.slides[0];
    const element = slide.elements[0];
    const result = slideSchema.safeParse({
      ...slide,
      elements: [element, structuredClone(element)],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(expect.arrayContaining([
        expect.objectContaining({
          path: ["elements", 1, "id"],
          message: `Duplicate element id: ${element.id}`,
        }),
      ]));
    }
  });

  it("rejects duplicate slide ids within a presentation", () => {
    const presentation = createStarterPresentation();
    const slide = presentation.slides[0];
    const result = presentationSchema.safeParse({
      ...presentation,
      slides: [slide, { ...structuredClone(slide), title: "Duplicate slide" }],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(expect.arrayContaining([
        expect.objectContaining({
          path: ["slides", 1, "id"],
          message: `Duplicate slide id: ${slide.id}`,
        }),
      ]));
    }
  });
});

describe("repairPresentationIdentities", () => {
  it("deterministically renames later duplicates without overwriting reserved ids", () => {
    const presentation = createStarterPresentation();
    const baseSlide = presentation.slides[0];
    const baseElement = baseSlide.elements[0];
    const legacy = {
      ...presentation,
      slides: [
        {
          ...structuredClone(baseSlide),
          id: "slide-1",
          title: "First",
          elements: [
            { ...structuredClone(baseElement), id: "element-1", text: "First" },
            { ...structuredClone(baseElement), id: "element-1", text: "Second" },
            { ...structuredClone(baseElement), id: "element-1__duplicate_2", text: "Reserved" },
            { ...structuredClone(baseElement), id: "element-1", text: "Fourth" },
          ],
        },
        { ...structuredClone(baseSlide), id: "slide-1", title: "Second", elements: [] },
        {
          ...structuredClone(baseSlide),
          id: "slide-1__duplicate_2",
          title: "Reserved",
          elements: [],
        },
        { ...structuredClone(baseSlide), id: "slide-1", title: "Fourth", elements: [] },
      ],
    };

    const first = repairPresentationIdentities(legacy);
    const second = repairPresentationIdentities(legacy);

    expect(first).toEqual(second);
    expect(first.repairedSlideIdCount).toBe(2);
    expect(first.repairedElementIdCount).toBe(2);

    const repaired = presentationSchema.parse(first.value);
    expect(repaired.slides.map((slide) => slide.id)).toEqual([
      "slide-1",
      "slide-1__duplicate_3",
      "slide-1__duplicate_2",
      "slide-1__duplicate_4",
    ]);
    expect(repaired.slides.map((slide) => slide.title)).toEqual([
      "First",
      "Second",
      "Reserved",
      "Fourth",
    ]);
    expect(repaired.slides[0].elements.map((element) => element.id)).toEqual([
      "element-1",
      "element-1__duplicate_3",
      "element-1__duplicate_2",
      "element-1__duplicate_4",
    ]);
    expect(repaired.slides[0].elements.map((element) =>
      element.type === "text" ? element.text : ""
    )).toEqual(["First", "Second", "Reserved", "Fourth"]);
  });

  it("leaves malformed ids for schema validation instead of inventing identities", () => {
    const malformed = {
      ...createStarterPresentation(),
      slides: [{ title: "Missing id", elements: [] }],
    };

    const repaired = repairPresentationIdentities(malformed);
    expect(repaired.repairedSlideIdCount).toBe(0);
    expect(presentationSchema.safeParse(repaired.value).success).toBe(false);
  });
});
