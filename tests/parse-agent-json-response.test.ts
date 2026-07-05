import { describe, expect, it } from "vitest";
import {
  buildAgentJsonRetryMessage,
  parseAgentResponseForConsumer,
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

  it("classifies markdown text for text consumers", () => {
    expect(parseAgentResponseForConsumer("## 结论\n\n可以先这样理解。", "text")).toEqual({
      kind: "text",
      format: "markdown",
      value: "## 结论\n\n可以先这样理解。",
    });
  });

  it("classifies structured protocol JSON for structured consumers", () => {
    expect(parseAgentResponseForConsumer(
      '{"type":"tool.call","data":{"toolName":"ListSlides","args":{}}}',
      "structured",
    )).toEqual({
      kind: "structured",
      format: "json",
      value: {
        type: "tool.call",
        data: {
          toolName: "ListSlides",
          args: {},
        },
      },
    });
  });

  it("rejects markdown for structured consumers", () => {
    expect(() => parseAgentResponseForConsumer("直接 Markdown 回复", "structured"))
      .toThrow(/JSON object/i);
  });

  it("treats legacy assistant.message JSON as markdown text", () => {
    expect(parseAgentResponseForConsumer(
      '{"type":"assistant.message","data":{"content":"**完成**"}}',
      "text",
    )).toEqual({
      kind: "text",
      format: "markdown",
      value: {
        type: "assistant.message",
        data: { content: "**完成**" },
      },
    });
  });
});
