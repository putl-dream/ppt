import { describe, expect, it } from "vitest";
import { JsonStreamExtractor } from "../src/main/agent/runtime/json-stream-extractor";

describe("JsonStreamExtractor", () => {
  it("streams direct markdown text", () => {
    let result = "";
    const extractor = new JsonStreamExtractor((chunk, _source) => {
      result += chunk;
    });

    extractor.feed("Hello ");
    extractor.feed("world!");
    expect(result).toBe("Hello world!");
  });

  it("can suppress direct markdown streaming", () => {
    let result = "";
    const extractor = new JsonStreamExtractor((chunk, _source) => {
      result += chunk;
    }, { streamMarkdown: false });

    extractor.feed("Hello ");
    extractor.feed("world!");
    expect(result).toBe("");
  });

  it("streams message content from assistant.message envelopes", () => {
    let result = "";
    const extractor = new JsonStreamExtractor((chunk, _source) => {
      result += chunk;
    });

    const json = '{"type":"assistant.message","data":{"content":"Hello, how are you?"},"someOtherKey":true}';
    for (const char of json) {
      extractor.feed(char);
    }
    expect(result).toBe("Hello, how are you?");
  });

  it("streams content from assistant.ask_user envelopes", () => {
    let result = "";
    const extractor = new JsonStreamExtractor((chunk, _source) => {
      result += chunk;
    });

    const json = '{"type":"assistant.ask_user","data":{"content":"What is the title?","missingFields":["title"]}}';
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

    const json = '{"type":"tool.call","data":{"toolName":"SubmitCommands","args":{"summary":"Creating a slide about AI.","commands":[]}}}';
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

    const json = '{"type":"tool.call","data":{"toolName":"SearchExtraTools","args":{"query":"consistency"}}}';
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

    const json = '{"type":"assistant.message","data":{"content":"Line 1\\nLine 2 with \\"quotes\\""}}';
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

    const json = '```json\n{"type":"assistant.message","data":{"content":"Fenced message"}}\n```';
    for (const char of json) {
      extractor.feed(char);
    }
    expect(result).toBe("Fenced message");
  });
});
