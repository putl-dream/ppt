import { describe, expect, it } from "vitest";
import {
  buildAgentJsonRetryMessage,
  parseAgentJsonResponse,
} from "../src/main/agent/runtime/parse-agent-json-response";

describe("parseAgentJsonResponse", () => {
  it("skips inline JSON examples that lack a type field", () => {
    const text = [
      "参考格式：",
      '{"toolName":"PreviewSlide","args":{"slideId":"s1"}}',
      "实际回复：",
      '{"type":"tool.call","data":{"toolName":"ListSlides","args":{}}}',
    ].join("\n");

    expect(parseAgentJsonResponse(text)).toEqual({
      type: "tool.call",
      data: {
        toolName: "ListSlides",
        args: {},
      },
    });
  });

  it("builds missing-type retry guidance", () => {
    expect(buildAgentJsonRetryMessage(new Error("parse failed"), { foo: "bar" }))
      .toMatch(/type/i);
  });
});
