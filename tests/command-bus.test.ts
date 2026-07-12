import { describe, expect, it } from "vitest";
import { CommandBus } from "../src/shared/commands";
import { createStarterPresentation } from "../src/shared/presentation";

describe("CommandBus", () => {
  it("executes, undoes, and redoes a title change", () => {
    const bus = new CommandBus(createStarterPresentation());
    const original = bus.getSnapshot();

    bus.execute({
      id: crypto.randomUUID(),
      type: "set-presentation-title",
      title: "New title",
    });
    expect(bus.getSnapshot().title).toBe("New title");

    bus.undo();
    expect(bus.getSnapshot().title).toBe(original.title);

    bus.redo();
    expect(bus.getSnapshot().title).toBe("New title");
  });

  it("adds and removes a slide through undo", () => {
    const bus = new CommandBus(createStarterPresentation());
    const originalCount = bus.getSnapshot().slides.length;

    bus.execute({
      id: crypto.randomUUID(),
      type: "add-slide",
      index: 1,
      slide: {
        id: crypto.randomUUID(),
        title: "Second slide",
        elements: [],
      },
    });
    expect(bus.getSnapshot().slides).toHaveLength(originalCount + 1);

    bus.undo();
    expect(bus.getSnapshot().slides).toHaveLength(originalCount);
  });

  it("rejects a duplicate slide id without changing the presentation", () => {
    const bus = new CommandBus(createStarterPresentation());
    const original = bus.getSnapshot();

    expect(() => bus.execute({
      id: crypto.randomUUID(),
      type: "add-slide",
      index: 1,
      slide: {
        id: original.slides[0].id,
        title: "Duplicate identity",
        elements: [],
      },
    })).toThrow(`Duplicate slide id: ${original.slides[0].id}`);

    expect(bus.getSnapshot()).toEqual(original);
  });

  it("atomically rejects duplicate slide ids introduced within one batch", () => {
    const bus = new CommandBus(createStarterPresentation());
    const original = bus.getSnapshot();
    const duplicateId = "batch-slide";

    expect(() => bus.executeMany([
      {
        id: crypto.randomUUID(),
        type: "set-presentation-title",
        title: "Should not stick",
      },
      {
        id: crypto.randomUUID(),
        type: "add-slide",
        index: 1,
        slide: { id: duplicateId, title: "First", elements: [] },
      },
      {
        id: crypto.randomUUID(),
        type: "add-slide",
        index: 2,
        slide: { id: duplicateId, title: "Second", elements: [] },
      },
    ])).toThrow(`Duplicate slide id: ${duplicateId}`);

    expect(bus.getSnapshot()).toEqual(original);
  });

  it("does not partially apply a failing command batch", () => {
    const bus = new CommandBus(createStarterPresentation());
    const original = bus.getSnapshot();

    expect(() =>
      bus.executeMany([
        {
          id: crypto.randomUUID(),
          type: "set-presentation-title",
          title: "Should not stick",
        },
        {
          id: crypto.randomUUID(),
          type: "remove-slide",
          slideId: "missing-slide",
        },
      ]),
    ).toThrow("Slide not found");

    expect(bus.getSnapshot()).toEqual(original);
  });

  it("adds, updates, and removes slide elements", () => {
    const bus = new CommandBus(createStarterPresentation());
    const slideId = bus.getSnapshot().slides[0].id;
    const elementId = crypto.randomUUID();

    // 1. Add element
    bus.execute({
      id: crypto.randomUUID(),
      type: "add-element",
      slideId,
      element: {
        id: elementId,
        type: "text",
        x: 10,
        y: 20,
        width: 100,
        height: 50,
        text: "Element content",
        fontSize: 24,
      },
    });

    const added = bus.getSnapshot().slides[0].elements;
    expect(added).toHaveLength(2); // starter has 1, now 2
    expect(added[1].id).toBe(elementId);
    expect((added[1] as any).text).toBe("Element content");

    // 2. Update element
    bus.execute({
      id: crypto.randomUUID(),
      type: "update-element",
      slideId,
      elementId,
      element: {
        id: elementId,
        type: "text",
        x: 10,
        y: 20,
        width: 100,
        height: 50,
        text: "Updated content",
        fontSize: 24,
      },
    });
    expect((bus.getSnapshot().slides[0].elements[1] as any).text).toBe("Updated content");

    // 3. Undo update
    bus.undo();
    expect((bus.getSnapshot().slides[0].elements[1] as any).text).toBe("Element content");

    // 4. Undo add
    bus.undo();
    expect(bus.getSnapshot().slides[0].elements).toHaveLength(1);
  });

  it("rejects duplicate element identities in add and update commands", () => {
    const bus = new CommandBus(createStarterPresentation());
    const initial = bus.getSnapshot();
    const slideId = initial.slides[0].id;
    const existingElementId = initial.slides[0].elements[0].id;

    expect(() => bus.execute({
      id: crypto.randomUUID(),
      type: "add-element",
      slideId,
      element: {
        id: existingElementId,
        type: "text",
        x: 10,
        y: 10,
        width: 100,
        height: 40,
        text: "Duplicate",
        fontSize: 20,
      },
    })).toThrow(`Duplicate element id: ${existingElementId}`);
    expect(bus.getSnapshot()).toEqual(initial);

    const secondElementId = "second-element";
    bus.execute({
      id: crypto.randomUUID(),
      type: "add-element",
      slideId,
      element: {
        id: secondElementId,
        type: "text",
        x: 10,
        y: 60,
        width: 100,
        height: 40,
        text: "Second",
        fontSize: 20,
      },
    });
    const beforeUpdate = bus.getSnapshot();

    expect(() => bus.execute({
      id: crypto.randomUUID(),
      type: "update-element",
      slideId,
      elementId: secondElementId,
      element: {
        ...beforeUpdate.slides[0].elements[1],
        id: existingElementId,
      },
    })).toThrow(`Duplicate element id: ${existingElementId}`);
    expect(bus.getSnapshot()).toEqual(beforeUpdate);
  });

  it("rejects duplicate element identities in restore commands", () => {
    const bus = new CommandBus(createStarterPresentation());
    const original = bus.getSnapshot();
    const slide = original.slides[0];
    const duplicateElements = [
      slide.elements[0],
      { ...slide.elements[0], text: "Duplicate restored element" },
    ];

    expect(() => bus.execute({
      id: crypto.randomUUID(),
      type: "restore-slide-elements",
      slideId: slide.id,
      elements: duplicateElements,
    })).toThrow("Duplicate element id");
    expect(bus.getSnapshot()).toEqual(original);

    expect(() => bus.execute({
      id: crypto.randomUUID(),
      type: "restore-slide",
      slide: { ...slide, elements: duplicateElements },
    })).toThrow("Duplicate element id");
    expect(bus.getSnapshot()).toEqual(original);
  });

  it("undoes slide layout with layout metadata restored", () => {
    const bus = new CommandBus(createStarterPresentation());
    const original = bus.getSnapshot();
    const slideId = original.slides[0].id;

    bus.execute({
      id: crypto.randomUUID(),
      type: "update-slide-layout",
      slideId,
      layout: "cover",
      grammarVariant: "signal-dark",
      designOverride: {
        palette: "tech-dark",
        fontMood: "technical",
        shapeLanguage: "geometric",
        backgroundStyle: "dark",
        motif: "arc",
        density: "standard",
        imageTreatment: "masked",
        chartStyle: "dashboard",
      },
    });

    expect(bus.getSnapshot().slides[0].layout).toBe("cover");
    expect(bus.getSnapshot().slides[0].grammarVariant).toBe("signal-dark");
    expect(bus.getSnapshot().slides[0].designOverride?.palette).toBe("tech-dark");

    bus.undo();
    expect(bus.getSnapshot().slides[0]).toEqual(original.slides[0]);
  });
});
