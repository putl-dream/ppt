import { describe, expect, it } from "vitest";
import {
  createDefaultSessionTitle,
  createSessionTitleFromPrompt,
} from "../src/shared/session";

describe("session title helpers", () => {
  it("creates numbered default titles", () => {
    expect(createDefaultSessionTitle(3)).toBe("新 PPT 项目 3");
  });

  it("derives a concise title from the first user prompt", () => {
    expect(
      createSessionTitleFromPrompt("请帮我制作一份关于 AI Agent 架构的 PPT。"),
    ).toBe("关于 AI Agent 架构的 PPT");
  });

  it("falls back when the prompt is blank", () => {
    expect(createSessionTitleFromPrompt(" \n\t ", "备用标题")).toBe("备用标题");
  });

  it("truncates very long prompts", () => {
    expect(
      createSessionTitleFromPrompt("生成 123456789012345678901234567890"),
    ).toBe("1234567890123456789012345678...");
  });
});
