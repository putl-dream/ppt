import { describe, expect, it } from "vitest";
import { CommandBus } from "../src/shared/commands";
import { createStarterPresentation, createSvgTestSlide } from "../src/shared/presentation-fixtures";

describe("CommandBus", () => {
  it("keeps a prepared execution invisible until it is committed", () => {
    const bus = new CommandBus(createStarterPresentation());
    const original = bus.getSnapshot();

    const prepared = bus.prepareExecute({
      id: crypto.randomUUID(),
      type: "set-presentation-title",
      title: "Prepared title",
    });

    expect(prepared.noOp).toBe(false);
    expect(prepared.presentation.title).toBe("Prepared title");
    expect(bus.getSnapshot()).toEqual(original);

    const committed = bus.commitPreparedMutation(prepared);
    expect(committed.title).toBe("Prepared title");
    expect(bus.getSnapshot()).toEqual(committed);
  });

  it("rejects a prepared mutation after another mutation commits", () => {
    const bus = new CommandBus(createStarterPresentation());
    const first = bus.prepareExecute({
      id: crypto.randomUUID(),
      type: "set-presentation-title",
      title: "First title",
    });
    const stale = bus.prepareExecute({
      id: crypto.randomUUID(),
      type: "set-presentation-title",
      title: "Stale title",
    });

    bus.commitPreparedMutation(first);

    expect(() => bus.commitPreparedMutation(stale)).toThrow("Stale prepared mutation");
    expect(bus.getSnapshot().title).toBe("First title");
  });

  it("prepares explicit no-ops when undo or redo history is empty", () => {
    const bus = new CommandBus(createStarterPresentation());
    const original = bus.getSnapshot();

    const undo = bus.prepareUndo();
    expect(undo.noOp).toBe(true);
    expect(undo.presentation).toEqual(original);
    expect(bus.commitPreparedMutation(undo)).toEqual(original);

    const redo = bus.prepareRedo();
    expect(redo.noOp).toBe(true);
    expect(redo.presentation).toEqual(original);
    expect(bus.commitPreparedMutation(redo)).toEqual(original);
  });

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
      slide: createSvgTestSlide({ title: "Second slide" }),
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
      slide: createSvgTestSlide({
        id: original.slides[0].id,
        title: "Duplicate identity",
      }),
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
        slide: createSvgTestSlide({ id: duplicateId, title: "First" }),
      },
      {
        id: crypto.randomUUID(),
        type: "add-slide",
        index: 2,
        slide: createSvgTestSlide({ id: duplicateId, title: "Second" }),
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

  it("does not expose partial state when preparing a failing command batch", () => {
    const bus = new CommandBus(createStarterPresentation());
    const original = bus.getSnapshot();

    expect(() =>
      bus.prepareExecuteMany([
        {
          id: crypto.randomUUID(),
          type: "set-presentation-title",
          title: "Prepared but invalid",
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

  it("updates slide title and restores a slide through undo", () => {
    const bus = new CommandBus(createStarterPresentation());
    const original = bus.getSnapshot();
    const slideId = original.slides[0].id;

    bus.execute({
      id: crypto.randomUUID(),
      type: "set-slide-title",
      slideId,
      title: "Renamed slide",
    });
    expect(bus.getSnapshot().slides[0].title).toBe("Renamed slide");

    bus.undo();
    expect(bus.getSnapshot().slides[0].title).toBe(original.slides[0].title);
  });

  it("restores a slide snapshot and undoes the replacement", () => {
    const bus = new CommandBus(createStarterPresentation());
    const originalSlide = structuredClone(bus.getSnapshot().slides[0]);
    const slideId = originalSlide.id;

    bus.execute({
      id: crypto.randomUUID(),
      type: "set-slide-title",
      slideId,
      title: "Changed title",
    });
    expect(bus.getSnapshot().slides[0].title).toBe("Changed title");

    bus.execute({
      id: crypto.randomUUID(),
      type: "restore-slide",
      slide: originalSlide,
    });
    expect(bus.getSnapshot().slides[0]).toEqual(originalSlide);

    bus.undo();
    expect(bus.getSnapshot().slides[0].title).toBe("Changed title");
  });
});
