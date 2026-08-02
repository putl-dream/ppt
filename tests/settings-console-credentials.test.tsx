// @vitest-environment jsdom

import React, { type ComponentProps } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_DESIGN_SYSTEM } from "../src/design-system";
import { DEFAULT_AGENT_STEP_LIMITS } from "../src/shared/agent-step-limits";
import {
  DEFAULT_WEB_SEARCH_ENDPOINT,
  resolveAgentGatewayPreferences,
} from "../src/shared/agent-gateway-config";
import { SettingsConsole } from "../src/renderer/src/components/SettingsConsole";

function renderSearchSettings(
  overrides: Partial<ComponentProps<typeof SettingsConsole>> = {},
) {
  const props: ComponentProps<typeof SettingsConsole> = {
    activeCategory: "models-search",
    models: [],
    selectedModelId: "",
    onSelectModel: vi.fn(),
    onSaveModel: vi.fn().mockResolvedValue(true),
    onSaveModels: vi.fn().mockResolvedValue(true),
    onDeleteModel: vi.fn().mockResolvedValue(true),
    credentialStorageStatus: {
      state: "degraded",
      backend: "basic_text",
      warning: "linux-basic-text",
    },
    webSearchCredentialConfigured: true,
    onSaveWebSearchCredential: vi.fn().mockResolvedValue(true),
    onDeleteWebSearchCredential: vi.fn().mockResolvedValue(true),
    selectedDesignSystem: DEFAULT_DESIGN_SYSTEM,
    setSelectedDesignSystem: vi.fn(),
    defaultTemplateId: "default",
    setDefaultTemplateId: vi.fn(),
    localStoragePath: "",
    onOpenWorkspace: vi.fn(),
    agentStepLimits: DEFAULT_AGENT_STEP_LIMITS,
    setAgentStepLimits: vi.fn(),
    agentGatewayPreferences: resolveAgentGatewayPreferences(),
    setAgentGatewayPreferences: vi.fn(),
    executionStrategy: "REQUEST_APPROVAL",
    setExecutionStrategy: vi.fn(),
    colorScheme: "dark",
    setColorScheme: vi.fn(),
    uiThemeId: "studio",
    setUiThemeId: vi.fn(),
    uiThemes: [],
    onRefreshUiThemes: vi.fn(),
    onOpenUiThemesDirectory: vi.fn(),
    uiFontFamily: "system",
    setUiFontFamily: vi.fn(),
    uiFontSize: 14,
    setUiFontSize: vi.fn(),
    uiLineHeight: 1.5,
    setUiLineHeight: vi.fn(),
    triggerToast: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<SettingsConsole {...props} />) };
}

describe("SettingsConsole credential controls", () => {
  afterEach(cleanup);

  beforeEach(() => {
    const pending = new Promise<never>(() => undefined);
    Object.defineProperty(window, "desktopApi", {
      configurable: true,
      value: {
        listApplicationTemplates: vi.fn().mockReturnValue(pending),
        getApplicationDataPath: vi.fn().mockReturnValue(pending),
      },
    });
  });

  it("keeps the Tavily key in local draft state and saves it explicitly", async () => {
    const onSaveWebSearchCredential = vi.fn().mockResolvedValue(true);
    renderSearchSettings({ onSaveWebSearchCredential });

    expect(screen.getByText(/Linux basic_text/)).toBeTruthy();
    expect(screen.getByText(/已配置（系统安全存储或环境变量）/)).toBeTruthy();
    const keyInput = screen.getByLabelText("Tavily API Key");
    fireEvent.change(keyInput, { target: { value: "tvly-secret" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(onSaveWebSearchCredential).toHaveBeenCalledWith(
      "tvly-secret",
      DEFAULT_WEB_SEARCH_ENDPOINT,
    ));
    expect((keyInput as HTMLInputElement).value).toBe("");
  });

  it("clears the secure-store entry only through the explicit action", async () => {
    const onDeleteWebSearchCredential = vi.fn().mockResolvedValue(true);
    renderSearchSettings({ onDeleteWebSearchCredential });

    fireEvent.click(screen.getByRole("button", { name: "清除" }));

    await waitFor(() => expect(onDeleteWebSearchCredential).toHaveBeenCalledTimes(1));
  });

  it("excludes models without a resolved credential from fallback choices", () => {
    renderSearchSettings({
      activeCategory: "models-runtime",
      credentialStorageStatus: { state: "secure", backend: "unknown" },
      selectedModelId: "primary",
      models: [
        {
          id: "primary",
          name: "Primary",
          provider: "openai",
          model: "primary",
          baseURL: "https://example.com/v1",
          openaiApiMode: "responses",
          credentialConfigured: true,
        },
        {
          id: "configured-fallback",
          name: "Configured Fallback",
          provider: "openai",
          model: "configured",
          baseURL: "https://example.com/v1",
          openaiApiMode: "responses",
          credentialConfigured: true,
        },
        {
          id: "missing-fallback",
          name: "Missing Fallback",
          provider: "openai",
          model: "missing",
          baseURL: "https://example.com/v1",
          openaiApiMode: "responses",
          credentialConfigured: false,
        },
      ],
    });

    expect(screen.getByText("2 个模型可用")).toBeTruthy();
    fireEvent.click(screen.getByRole("combobox", { name: "服务繁忙时备用模型" }));
    expect(screen.getByRole("option", { name: /Configured Fallback/ })).toBeTruthy();
    expect(screen.queryByRole("option", { name: /Missing Fallback/ })).toBeNull();
  });
});
