import { describe, expect, it } from "vitest";
import { createModelOutlinePlanner } from "../src/main/agent/outline-planner";
import { createStarterPresentation } from "../src/shared/presentation";

describe("model outline planner", () => {
  it("keeps a model-generated outline behind explicit user confirmation", async () => {
    const planner = createModelOutlinePlanner({
      async generateText() {
        return {
          provider: "openai",
          model: "test-model",
          text: JSON.stringify({
            mode: "outline-proposal",
            intent: "create-presentation",
            assistantMessage: "Please confirm this outline.",
            outline: {
              title: "AI strategy",
              slides: [
                { title: "Context", keyPoints: ["Market shift"] },
                { title: "Plan", keyPoints: ["Product priorities"] },
                { title: "Next steps", keyPoints: ["Execution roadmap"] },
              ],
            },
            missingInformation: ["Audience"],
          }),
        };
      },
    });

    const result = await planner.review({
      messages: [{ role: "user", content: "Create an AI strategy presentation" }],
      presentation: createStarterPresentation(),
    });

    expect(result.mode).toBe("outline-proposal");
    expect(result.outline?.slides).toHaveLength(3);
  });

  it("downgrades an incomplete creation outline that the model marked ready", async () => {
    const planner = createModelOutlinePlanner({
      async generateText() {
        return {
          provider: "openai",
          model: "test-model",
          text: JSON.stringify({
            mode: "ready",
            intent: "create-presentation",
            assistantMessage: "Ready.",
            outline: {
              title: "Too short",
              slides: [{ title: "Only slide", keyPoints: ["One point"] }],
            },
            missingInformation: [],
          }),
        };
      },
    });

    const result = await planner.review({
      messages: [{ role: "user", content: "Make slides" }],
      presentation: createStarterPresentation(),
    });

    expect(result.mode).toBe("outline-proposal");
  });

  it("classifies a greeting as chat without creating an outline", async () => {
    const planner = createModelOutlinePlanner({
      async generateText() {
        return {
          provider: "openai",
          model: "test-model",
          text: JSON.stringify({
            mode: "needs-clarification",
            intent: "create-presentation",
            assistantMessage: "你好！今天想聊点什么？",
            missingInformation: ["PPT 主题"],
          }),
        };
      },
    });

    const result = await planner.review({
      messages: [{ role: "user", content: "hello" }],
      presentation: createStarterPresentation(),
    });

    expect(result).toMatchObject({
      mode: "chat",
      intent: "chat",
      outline: undefined,
    });
  });
});
