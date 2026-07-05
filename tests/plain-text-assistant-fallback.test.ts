import { describe, expect, it } from "vitest";
import {
  canWrapPlainTextAssistantMessage,
  classifyPlainTextFallbackRequest,
} from "../src/main/agent/runtime/plain-text-assistant-fallback";

describe("plain text assistant fallback", () => {
  it("classifies informational and explicit non-PPT requests as direct-answer types", () => {
    expect(classifyPlainTextFallbackRequest("我想了解一下第五项修炼"))
      .toBe("informational");
    expect(classifyPlainTextFallbackRequest("先不做 PPT，先讲解一下第五项修炼"))
      .toBe("explicit-non-ppt");
    expect(classifyPlainTextFallbackRequest("hi"))
      .toBe("greeting");
    expect(classifyPlainTextFallbackRequest("我刚才说了什么？"))
      .toBe("conversation-memory");
    expect(classifyPlainTextFallbackRequest("第五项修炼"))
      .toBe("bare-topic");
  });

  it("does not classify presentation actions as direct-answer requests", () => {
    expect(classifyPlainTextFallbackRequest("帮我做一份关于第五项修炼的 PPT"))
      .toBeNull();
    expect(classifyPlainTextFallbackRequest("导出 PPTX"))
      .toBeNull();
    expect(classifyPlainTextFallbackRequest("修改第 3 页标题"))
      .toBeNull();
    expect(classifyPlainTextFallbackRequest("按默认方案"))
      .toBeNull();
  });

  it("wraps plain text only when the request type is allowed", () => {
    expect(canWrapPlainTextAssistantMessage({
      request: "我想了解一下第五项修炼",
      responseText: "《第五项修炼》是一本组织学习领域的经典书。",
    })).toBe(true);

    expect(canWrapPlainTextAssistantMessage({
      request: "第五项修炼",
      responseText: "《第五项修炼》是一本组织学习领域的经典书。",
    })).toBe(true);

    expect(canWrapPlainTextAssistantMessage({
      request: "第五项修炼",
      responseText: "《第五项修炼》是一本组织学习领域的经典书。",
      messageHistory: [{ role: "assistant", content: "请确认主题。" }],
    })).toBe(false);

    expect(canWrapPlainTextAssistantMessage({
      request: "帮我做一份关于第五项修炼的 PPT",
      responseText: "我马上开始制作。",
    })).toBe(false);

    expect(canWrapPlainTextAssistantMessage({
      request: "我想了解一下第五项修炼",
      responseText: '{"type":"assistant.message","data":',
    })).toBe(false);

    expect(canWrapPlainTextAssistantMessage({
      request: "我想了解一下第五项修炼",
      responseText: "《第五项修炼》是一本组织学习领域的经典书。",
      requiredOutcome: "command_proposal",
    })).toBe(false);
  });
});
