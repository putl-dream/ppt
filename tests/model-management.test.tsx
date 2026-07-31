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
      }),
      expect.objectContaining({
        id: "deepseek-v4-pro",
        provider: "anthropic",
        baseURL: "https://api.deepseek.com/anthropic",
        apiKey: "deepseek-secret",
        supports1MContext: true,
      }),
    ]));
    expect(onSelectModel).toHaveBeenCalledWith("deepseek-v4-flash");
    expect(triggerToast).toHaveBeenCalledWith("DeepSeek 模型已配置");
  });
});
