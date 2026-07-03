import { describe, expect, it } from "vitest";
import { JsonStreamExtractor } from "../src/main/agent/runtime/json-stream-extractor";

describe("JsonStreamExtractor", () => {
  it("streams plain text directly", () => {
    let result = "";
    const extractor = new JsonStreamExtractor((chunk, _source) => {
      result += chunk;
    });

    extractor.feed("Hello ");
    extractor.feed("world!");
    expect(result).toBe("Hello world!");
  });

  it("streams message content from type=message JSON objects", () => {
    let result = "";
    const extractor = new JsonStreamExtractor((chunk, _source) => {
      result += chunk;
    });

    const json = '{"type":"message","content":"Hello, how are you?","someOtherKey":true}';
    for (const char of json) {
      extractor.feed(char);
    }
    expect(result).toBe("Hello, how are you?");
  });

  it("streams message from type=ask_user JSON objects", () => {
    let result = "";
    const extractor = new JsonStreamExtractor((chunk, _source) => {
      result += chunk;
    });

    const json = '{"type": "ask_user", "message": "What is the title?", "missingFields": ["title"]}';
    for (const char of json) {
      extractor.feed(char);
    }
    expect(result).toBe("What is the title?");
  });

  it("streams summary from SubmitCommands tool calls", () => {
    let result = "";
    let source: "message" | "tool-summary" = "message";
    const extractor = new JsonStreamExtractor((chunk, nextSource) => {
      result += chunk;
      source = nextSource;
    });

    const json = '{"type":"tool_call","toolName":"SubmitCommands","args":{"summary":"Creating a slide about AI.","commands":[]}}';
    for (const char of json) {
      extractor.feed(char);
    }
    expect(result).toBe("Creating a slide about AI.");
    expect(source).toBe("tool-summary");
  });

  it("ignores other tool calls", () => {
    let result = "";
    const extractor = new JsonStreamExtractor((chunk, _source) => {
      result += chunk;
    });

    const json = '{"type":"tool_call","toolName":"SearchExtraTools","args":{"query":"consistency"}}';
    for (const char of json) {
      extractor.feed(char);
    }
    expect(result).toBe("");
  });

  it("handles escapes correctly (e.g. \\n, \\\")", () => {
    let result = "";
    const extractor = new JsonStreamExtractor((chunk, _source) => {
      result += chunk;
    });

    const json = '{"type":"message","content":"Line 1\\nLine 2 with \\"quotes\\""}';
    for (const char of json) {
      extractor.feed(char);
    }
    expect(result).toBe('Line 1\nLine 2 with "quotes"');
  });

  it("handles markdown fenced JSON", () => {
    let result = "";
    const extractor = new JsonStreamExtractor((chunk, _source) => {
      result += chunk;
    });

    const json = '```json\n{"type":"message","content":"Fenced message"}\n```';
    for (const char of json) {
      extractor.feed(char);
    }
    expect(result).toBe("Fenced message");
  });
});
