import { describe, expect, it } from "vitest";
import { createModelPresentationPlanner } from "../src/main/agent/planner";
import { createStarterPresentation } from "../src/shared/presentation";

describe("model presentation planner", () => {
  it("turns a provider response into validated presentation commands", async () => {
    const planner = createModelPresentationPlanner({
      async generateText() {
        return {
          provider: "openai",
          model: "test-model",
          text: JSON.stringify({
            summary: "Add a concise launch slide.",
            actions: [
              { type: "set-presentation-title", title: "Product launch" },
              { type: "add-slide", title: "Launch plan", body: "Audience\nChannels\nTimeline" },
            ],
          }),
        };
      },
      async *generateTextStream() {
        yield { type: "content" as const, text: "" };
        yield { type: "complete" as const, text: "" };
      },
    });

    const plan = await planner.plan({
      request: "Create a launch presentation",
      presentation: createStarterPresentation(),
      model: { provider: "openai", model: "test-model" },
    });

    expect(plan.summary).toBe("Add a concise launch slide.");
    expect(plan.commands.map((command) => command.type)).toEqual([
      "set-presentation-title",
      "add-slide",
    ]);
  });

  it("can edit an existing text element using IDs from presentation context", async () => {
    const presentation = createStarterPresentation();
    const slide = presentation.slides[0];
    const element = slide.elements[0];
    const planner = createModelPresentationPlanner({
      async generateText() {
        return {
          provider: "openai",
          model: "test-model",
          text: JSON.stringify({
            summary: "Rewrite the opening copy.",
            actions: [
              {
                type: "update-text",
                slideId: slide.id,
                elementId: element.id,
                text: "A sharper opening",
                fontSize: 54,
              },
            ],
          }),
        };
      },
      async *generateTextStream() {
        yield { type: "content" as const, text: "" };
        yield { type: "complete" as const, text: "" };
      },
    });

    const plan = await planner.plan({ request: "Rewrite the opening", presentation });

    expect(plan.commands[0]).toMatchObject({
      type: "update-element",
      slideId: slide.id,
      elementId: element.id,
      element: { type: "text", text: "A sharper opening", fontSize: 54 },
    });
  });
});
