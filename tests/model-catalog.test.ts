// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_MODELS,
  MODEL_STORAGE_KEY,
  loadManagedModels,
  toAgentModelSettings,
} from "../src/renderer/src/modelCatalog";

describe("model catalog", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("includes DeepSeek V4 Flash and Pro with their supported API modes", () => {
    const flash = DEFAULT_MODELS.find((model) => model.id === "deepseek-v4-flash");
    const pro = DEFAULT_MODELS.find((model) => model.id === "deepseek-v4-pro");

    expect(flash).toMatchObject({
      provider: "openai",
      model: "deepseek-v4-flash",
      baseURL: "https://api.deepseek.com",
      openaiApiMode: "responses",
      supports1MContext: true,
      builtIn: true,
    });
    expect(pro).toMatchObject({
      provider: "openai",
      model: "deepseek-v4-pro",
      baseURL: "https://api.deepseek.com",
      openaiApiMode: "chat-completions",
      supports1MContext: true,
      builtIn: true,
    });
    expect(toAgentModelSettings(flash!)).toMatchObject({ supports1MContext: true });
  });

  it("adds newly bundled models to an existing saved catalog", () => {
    window.localStorage.setItem(MODEL_STORAGE_KEY, JSON.stringify([
      DEFAULT_MODELS.find((model) => model.id === "openai-gpt-5-5"),
    ]));

    const models = loadManagedModels();

    expect(models.some((model) => model.id === "deepseek-v4-flash")).toBe(true);
    expect(models.some((model) => model.id === "deepseek-v4-pro")).toBe(true);
  });
});
