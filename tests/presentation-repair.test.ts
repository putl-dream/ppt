import { describe, expect, it } from "vitest";
import { presentationSchema, slideSchema } from "../src/shared/presentation";
import { createMinimalSvgMarkup, createStarterPresentation, createSvgVisualSource } from "../src/shared/presentation-fixtures";
import {
  migrateDisplayCardsToSvgOnly,
  migratePresentationToSvgOnly,
  repairPresentationIdentities,
} from "../src/shared/presentation-repair";

describe("presentation identity validation", () => {
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

  it("rejects slides without a required SVG visual source", () => {
    const presentation = createStarterPresentation();
    const slide = presentation.slides[0];
    const { visualSource: _visualSource, ...withoutVisualSource } = slide;
    const result = slideSchema.safeParse(withoutVisualSource);

    expect(result.success).toBe(false);
  });
});

describe("repairPresentationIdentities", () => {
  it("deterministically renames later duplicate slide ids without overwriting reserved ids", () => {
    const presentation = createStarterPresentation();
    const baseSlide = presentation.slides[0];
    const legacy = {
      ...presentation,
      slides: [
        { ...structuredClone(baseSlide), id: "slide-1", title: "First" },
        { ...structuredClone(baseSlide), id: "slide-1", title: "Second" },
        { ...structuredClone(baseSlide), id: "slide-1__duplicate_2", title: "Reserved" },
        { ...structuredClone(baseSlide), id: "slide-1", title: "Fourth" },
      ],
    };

    const first = repairPresentationIdentities(legacy);
    const second = repairPresentationIdentities(legacy);

    expect(first).toEqual(second);
    expect(first.repairedSlideIdCount).toBe(2);
    expect(first.repairedElementIdCount).toBe(0);

    const repaired = presentationSchema.parse(first.value);
    expect(repaired.slides.map((item) => item.id)).toEqual([
      "slide-1",
      "slide-1__duplicate_3",
      "slide-1__duplicate_2",
      "slide-1__duplicate_4",
    ]);
    expect(repaired.slides.map((item) => item.title)).toEqual([
      "First",
      "Second",
      "Reserved",
      "Fourth",
    ]);
  });

  it("leaves malformed ids for schema validation instead of inventing identities", () => {
    const malformed = {
      ...createStarterPresentation(),
      slides: [{
        title: "Missing id",
        visualSource: createSvgVisualSource({ title: "Missing id" }),
      }],
    };

    const repaired = repairPresentationIdentities(malformed);
    expect(repaired.repairedSlideIdCount).toBe(0);
    expect(presentationSchema.safeParse(repaired.value).success).toBe(false);
  });
});

describe("migratePresentationToSvgOnly", () => {
  it("strips legacy element-IR and optional variant fields from SVG slides", () => {
    const presentation = createStarterPresentation();
    const slide = presentation.slides[0];
    const legacy = {
      ...presentation,
      slides: [{
        ...slide,
        elements: [{ id: "legacy-text", type: "text" }],
        layout: "cover",
        grammarVariant: "signal-dark",
        slideVariant: "dark",
        backgroundVariant: "hero",
        sceneRef: {
          packId: "editorial-business",
          sceneId: "split-case",
          variantId: "fact-sidebar",
        },
      }],
    };

    const migrated = migratePresentationToSvgOnly(legacy);
    expect(migrated.strippedLegacyFieldCount).toBe(6);
    expect(migrated.droppedLegacySlideCount).toBe(0);

    const parsed = presentationSchema.parse(migrated.value);
    expect(parsed.slides).toHaveLength(1);
    expect(parsed.slides[0]).not.toHaveProperty("elements");
    expect(parsed.slides[0]).not.toHaveProperty("layout");
    expect(parsed.slides[0]).not.toHaveProperty("grammarVariant");
    expect(parsed.slides[0]).not.toHaveProperty("slideVariant");
    expect(parsed.slides[0]).not.toHaveProperty("sceneRef");
    expect(parsed.slides[0]).not.toHaveProperty("backgroundVariant");
    expect(parsed.slides[0].visualSource.kind).toBe("svg");
  });

  it("drops slides that are not SVG-native", () => {
    const presentation = createStarterPresentation();
    const svgSlide = presentation.slides[0];
    const legacy = {
      ...presentation,
      slides: [
        svgSlide,
        {
          id: "legacy-slide",
          title: "Element IR slide",
          elements: [{ id: "text-1", type: "text", text: "Legacy" }],
          layout: "concept",
        },
      ],
    };

    const migrated = migratePresentationToSvgOnly(legacy);
    expect(migrated.droppedLegacySlideCount).toBe(1);

    const parsed = presentationSchema.parse(migrated.value);
    expect(parsed.slides).toHaveLength(1);
    expect(parsed.slides[0].id).toBe(svgSlide.id);
  });

  it("keeps SVG slides with embedded raster resources", () => {
    const presentation = createStarterPresentation();
    const slide = presentation.slides[0];
    const markup = createMinimalSvgMarkup("With image");
    const visualSource = createSvgVisualSource({ markup, sourcePath: "slides/P01.svg" });
    visualSource.resources = [{
      sourcePath: "assets/photo.png",
      mimeType: "image/png",
      byteSize: 2048,
      sha256: "b".repeat(64),
    }];

    const legacy = {
      ...presentation,
      slides: [{ ...slide, visualSource, layout: "case" }],
    };

    const migrated = migratePresentationToSvgOnly(legacy);
    const parsed = presentationSchema.parse(migrated.value);
    expect(parsed.slides[0].visualSource.resources).toHaveLength(1);
    expect(parsed.slides[0].visualSource.resources[0].sourcePath).toBe("assets/photo.png");
  });
});

describe("migrateDisplayCardsToSvgOnly", () => {
  const svgSlide = () => ({
    id: "slide-svg",
    title: "SVG slide",
    visualSource: createSvgVisualSource({ title: "SVG slide" }),
  });

  const legacySlide = () => ({
    id: "slide-legacy",
    title: "Legacy slide",
    elements: [{ id: "el-1", type: "text", text: "hello" }],
    layout: "cover",
    visualSource: createSvgVisualSource({ title: "Legacy slide" }),
  });

  it("strips legacy keys from slides inside review.command-proposal commands", () => {
    const cards = [{
      event: {
        kind: "review.command-proposal",
        category: "review",
        id: "evt-1",
        threadId: "th-1",
        receivedAt: Date.now(),
        payload: {
          threadId: "th-1",
          jobId: "job-1",
          queryId: "q-1",
          proposalId: "p-1",
          summary: "Test",
          commands: [
            { id: "cmd-1", type: "add-slide", slide: legacySlide(), index: 0 },
          ],
        },
      },
      status: "active",
      receivedAt: Date.now(),
    }];

    const result = migrateDisplayCardsToSvgOnly(cards);
    expect(result.strippedLegacyFieldCount).toBe(2); // elements + layout
    expect(result.droppedLegacySlideCount).toBe(0);

    const migrated = result.value as typeof cards;
    const slide = (migrated[0] as Record<string, unknown>).event
      ? (migrated[0].event as Record<string, unknown>).payload
        ? ((migrated[0].event as Record<string, unknown>).payload as Record<string, unknown>).commands
          ? (((migrated[0].event as Record<string, unknown>).payload as Record<string, unknown>).commands as Array<Record<string, unknown>>)[0].slide as Record<string, unknown>
          : {}
        : {}
      : {};
    expect(slide).not.toHaveProperty("elements");
    expect(slide).not.toHaveProperty("layout");
  });

  it("strips legacy keys from slides inside review.command-proposal preview", () => {
    const cards = [{
      event: {
        kind: "review.command-proposal",
        category: "review",
        id: "evt-2",
        threadId: "th-2",
        receivedAt: Date.now(),
        payload: {
          threadId: "th-2",
          jobId: "job-2",
          queryId: "q-2",
          proposalId: "p-2",
          summary: "Test",
          commands: [],
          preview: { id: "prez", title: "Test", revision: 0, slides: [legacySlide()], designSystem: {} },
        },
      },
      status: "active",
      receivedAt: Date.now(),
    }];

    const result = migrateDisplayCardsToSvgOnly(cards);
    expect(result.strippedLegacyFieldCount).toBe(2);
  });

  it("leaves non command-proposal cards untouched", () => {
    const cards = [{
      event: { kind: "progress.task-list-updated", category: "progress", id: "evt-3", threadId: "th-3", receivedAt: Date.now(), payload: {} },
      status: "active",
      receivedAt: Date.now(),
    }];

    const result = migrateDisplayCardsToSvgOnly(cards);
    expect(result.strippedLegacyFieldCount).toBe(0);
    expect(result.value).toEqual(cards);
  });

  it("handles empty or non-array input gracefully", () => {
    expect(migrateDisplayCardsToSvgOnly(null).strippedLegacyFieldCount).toBe(0);
    expect(migrateDisplayCardsToSvgOnly([]).strippedLegacyFieldCount).toBe(0);
  });
});
