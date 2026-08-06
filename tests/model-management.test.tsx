// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ModelManagement } from "../src/renderer/src/components/ModelManagement";

describe("ModelManagement vendor onboarding", () => {
  afterEach(cleanup);

  it("submits every DeepSeek binding and one API key as a single batch", async () => {
    const onSaveModel = vi.fn();
    const onSaveModels = vi.fn().mockResolvedValue(true);
    const onSelectModel = vi.fn();
    const triggerToast = vi.fn();
    render(
      <ModelManagement
        models={[]}
        selectedModelId=""
        onSelectModel={onSelectModel}
        onSaveModel={onSaveModel}
        onSaveModels={onSaveModels}
        onDeleteModel={vi.fn().mockResolvedValue(true)}
        triggerToast={triggerToast}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "添加厂商模型" }));
    const dialog = screen.getByRole("dialog", { name: "添加厂商模型" });
    fireEvent.click(within(dialog).getByRole("combobox", { name: "模型厂商" }));
    expect(screen.getAllByRole("option")).toHaveLength(4);
    expect(screen.getByRole("option", { name: /OpenAI/ })).toBeTruthy();
    expect(screen.getByRole("option", { name: /Anthropic/ })).toBeTruthy();
    expect(screen.getByRole("option", { name: /自定义兼容服务/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("option", { name: /DeepSeek/ }));
    fireEvent.change(within(dialog).getByLabelText("API Key"), {
      target: { value: "deepseek-secret" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "添加模型" }));

    await waitFor(() => expect(onSaveModels).toHaveBeenCalledTimes(1));
    const [savedModels, apiKey] = onSaveModels.mock.calls[0];
    expect(apiKey).toBe("deepseek-secret");
    expect(savedModels).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "deepseek-v4-flash",
          provider: "anthropic",
          baseURL: "https://api.deepseek.com/anthropic",
          credentialConfigured: true,
          supports1MContext: true,
          pricing: expect.objectContaining({
            currency: "CNY",
            inputPerMillion: 1,
            cachedInputPerMillion: 0.02,
            outputPerMillion: 2,
          }),
        }),
        expect.objectContaining({
          id: "deepseek-v4-pro",
          provider: "anthropic",
          baseURL: "https://api.deepseek.com/anthropic",
          credentialConfigured: true,
          supports1MContext: true,
          pricing: expect.objectContaining({
            currency: "CNY",
            inputPerMillion: 3,
            cachedInputPerMillion: 0.025,
            outputPerMillion: 6,
          }),
        }),
      ]),
    );
    expect(savedModels.every((model: Record<string, unknown>) => !("apiKey" in model))).toBe(true);
    expect(onSaveModel).not.toHaveBeenCalled();
    expect(onSelectModel).toHaveBeenCalledWith("deepseek-v4-flash");
    expect(triggerToast).toHaveBeenCalledWith("DeepSeek 模型已配置");
  });

  it("edits pricing and rejects an empty required price", () => {
    const onSaveModel = vi.fn().mockResolvedValue(true);
    const triggerToast = vi.fn();
    render(
      <ModelManagement
        models={[
          {
            id: "custom-priced",
            name: "Priced Model",
            provider: "openai",
            model: "priced-model",
            baseURL: "https://example.com/v1",
            openaiApiMode: "responses",
            enabled: true,
            pricing: {
              currency: "USD",
              inputPerMillion: 5,
              cachedInputPerMillion: 0.5,
              outputPerMillion: 30,
              updatedAt: "2026-08-01",
            },
          },
        ]}
        selectedModelId="custom-priced"
        onSelectModel={vi.fn()}
        onSaveModel={onSaveModel}
        onSaveModels={vi.fn().mockResolvedValue(true)}
        onDeleteModel={vi.fn().mockResolvedValue(true)}
        triggerToast={triggerToast}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "编辑模型 Priced Model" }));
    const dialog = screen.getByRole("dialog", { name: "编辑模型" });
    const inputPrice = within(dialog).getByRole("spinbutton", {
      name: "Priced Model 普通输入单价",
    });
    expect((inputPrice as HTMLInputElement).value).toBe("5");
    fireEvent.change(inputPrice, { target: { value: "" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "保存" }));

    expect(onSaveModel).not.toHaveBeenCalled();
    expect(triggerToast).toHaveBeenCalledWith("请填写有效的非负模型单价");
  });

  it("keeps an edited API key separate from persisted model metadata", async () => {
    const onSaveModel = vi.fn().mockResolvedValue(true);
    render(
      <ModelManagement
        models={[
          {
            id: "custom-secure",
            name: "Secure Model",
            provider: "openai",
            model: "secure-model",
            baseURL: "https://example.com/v1",
            openaiApiMode: "responses",
            enabled: true,
            credentialConfigured: true,
          },
        ]}
        selectedModelId="custom-secure"
        onSelectModel={vi.fn()}
        onSaveModel={onSaveModel}
        onSaveModels={vi.fn().mockResolvedValue(true)}
        onDeleteModel={vi.fn().mockResolvedValue(true)}
        triggerToast={vi.fn()}
      />,
    );

    expect(screen.getByText(/凭据已配置/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "编辑模型 Secure Model" }));
    const dialog = screen.getByRole("dialog", { name: "编辑模型" });
    const keyInput = within(dialog).getByLabelText("API Key");
    expect((keyInput as HTMLInputElement).value).toBe("");
    fireEvent.change(keyInput, { target: { value: "replacement-secret" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "保存" }));

    await waitFor(() => expect(onSaveModel).toHaveBeenCalledTimes(1));
    const [savedModel, apiKey] = onSaveModel.mock.calls[0];
    expect(apiKey).toBe("replacement-secret");
    expect(savedModel).not.toHaveProperty("apiKey");
  });
});
