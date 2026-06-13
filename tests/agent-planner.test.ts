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
            presentationTitle: "Product launch",
            slide: { title: "Launch plan", body: "Audience\nChannels\nTimeline" },
          }),
        };
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
});
