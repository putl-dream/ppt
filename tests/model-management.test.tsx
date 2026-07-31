// @vitest-environment jsdom

import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ModelManagement } from "../src/renderer/src/components/ModelManagement";

describe("ModelManagement vendor onboarding", () => {
  it("configures every DeepSeek model with one API key and selects Flash", () => {
    const onSaveModel = vi.fn();
    const onSelectModel = vi.fn();
    const triggerToast = vi.fn();
    render(
      <ModelManagement
        models={[]}
        selectedModelId=""
        onSelectModel={onSelectModel}
        onSaveModel={onSaveModel}
        onDeleteModel={vi.fn()}
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

    expect(onSaveModel).toHaveBeenCalledTimes(2);
    expect(onSaveModel.mock.calls.map(([model]) => model)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "deepseek-v4-flash",
        provider: "anthropic",
        baseURL: "https://api.deepseek.com/anthropic",
        apiKey: "deepseek-secret",
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
        apiKey: "deepseek-secret",
        supports1MContext: true,
        pricing: expect.objectContaining({
          currency: "CNY",
          inputPerMillion: 3,
          cachedInputPerMillion: 0.025,
          outputPerMillion: 6,
        }),
      }),
    ]));
    expect(onSelectModel).toHaveBeenCalledWith("deepseek-v4-flash");
    expect(triggerToast).toHaveBeenCalledWith("DeepSeek 模型已配置");
  });

  it("edits pricing and rejects an empty required price", () => {
    const onSaveModel = vi.fn();
    const triggerToast = vi.fn();
    render(
      <ModelManagement
        models={[{
          id: "custom-priced",
          name: "Priced Model",
          provider: "openai",
          model: "priced-model",
          apiKey: "secret",
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
        }]}
        selectedModelId="custom-priced"
        onSelectModel={vi.fn()}
        onSaveModel={onSaveModel}
        onDeleteModel={vi.fn()}
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
});
