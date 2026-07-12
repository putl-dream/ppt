import { describe, expect, it } from "vitest";
import { normalizeOutputTokenDraft } from "../src/shared/generation-settings-inputs";

describe("generation settings inputs", () => {
  it("keeps the previous token limit while the number field is temporarily empty", () => {
    expect(normalizeOutputTokenDraft("", 16_384)).toBe(16_384);
  });

  it("accepts an edited token limit and clamps it to the supported range", () => {
    expect(normalizeOutputTokenDraft("32768", 16_384)).toBe(32_768);
    expect(normalizeOutputTokenDraft("1", 16_384)).toBe(1_024);
    expect(normalizeOutputTokenDraft("999999", 16_384)).toBe(131_072);
  });

  it("rejects non-integer drafts", () => {
    expect(normalizeOutputTokenDraft("2048.5", 16_384)).toBe(16_384);
    expect(normalizeOutputTokenDraft("not-a-number", 16_384)).toBe(16_384);
  });
});
