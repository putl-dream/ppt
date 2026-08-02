// @vitest-environment jsdom

import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_AGENT_STEP_LIMITS } from "../src/shared/agent-step-limits";
import { resolveAgentGatewayPreferences } from "../src/shared/agent-gateway-config";
import type { AppBootstrapSnapshot } from "../src/renderer/src/app/appBootstrap";
import { useSettingsController } from "../src/renderer/src/app/useSettingsController";

const bootstrap: AppBootstrapSnapshot = {
  persistedUiSettings: {},
  initialColorScheme: "dark",
  initialComputedScheme: "dark",
  models: [{
    id: "model-one",
    name: "Model One",
    provider: "openai",
    model: "model-one",
    baseURL: "https://old.example.com/v1",
    openaiApiMode: "responses",
    enabled: true,
    credentialConfigured: false,
  }],
  selectedModelId: "model-one",
  agentStepLimits: DEFAULT_AGENT_STEP_LIMITS,
  agentGatewayPreferences: resolveAgentGatewayPreferences(),
  credentialReentryRequired: false,
};

function SettingsHarness({ notify }: { notify: (message: string) => void }) {
  const controller = useSettingsController(bootstrap, undefined, notify);
  const model = controller.models[0];
  return (
    <>
      <output aria-label="enabled models">
        {controller.enabledModels.map((item) => item.id).join(",")}
      </output>
      <output aria-label="credential configured">
        {String(model?.credentialConfigured)}
      </output>
      <button
        type="button"
        onClick={() => {
          if (model) void controller.saveModel({
            ...model,
            baseURL: "https://new.example.com/v1",
          });
        }}
      >
        change binding
      </button>
      <button
        type="button"
        onClick={() => {
          if (model) void controller.saveModel(model, "new-secret");
        }}
      >
        save key
      </button>
      <button
        type="button"
        onClick={() => controller.setAgentGatewayPreferences({
          ...controller.agentGatewayPreferences,
          webSearchEndpoint: "https://search-proxy.example.com/v1",
        })}
      >
        change search endpoint
      </button>
    </>
  );
}

describe("useSettingsController credentials", () => {
  afterEach(cleanup);

  it("removes an old binding and excludes the model until a matching key exists", async () => {
    const deleteModelCredential = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window, "desktopApi", {
      configurable: true,
      value: {
        getCredentialStatus: vi.fn().mockImplementation(async (request) => ({
          storage: { state: "secure", backend: "unknown" },
          models: request.models.map((binding: { configurationId: string; baseURL?: string }) => ({
            configurationId: binding.configurationId,
            configured: binding.baseURL === "https://old.example.com/v1",
          })),
          webSearchConfigured: false,
        })),
        deleteModelCredential,
      },
    });

    render(<SettingsHarness notify={vi.fn()} />);

    await waitFor(() => expect(screen.getByLabelText("enabled models").textContent)
      .toBe("model-one"));
    fireEvent.click(screen.getByRole("button", { name: "change binding" }));

    await waitFor(() => expect(deleteModelCredential).toHaveBeenCalledWith({
      configurationId: "model-one",
    }));
    await waitFor(() => expect(screen.getByLabelText("credential configured").textContent)
      .toBe("false"));
    expect(screen.getByLabelText("enabled models").textContent).toBe("");
  });

  it("ignores a stale status response after a credential write succeeds", async () => {
    let resolveStatus!: (value: {
      storage: { state: "secure"; backend: "unknown" };
      models: Array<{ configurationId: string; configured: boolean }>;
      webSearchConfigured: boolean;
    }) => void;
    const status = new Promise<Parameters<typeof resolveStatus>[0]>((resolve) => {
      resolveStatus = resolve;
    });
    const setModelCredentials = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window, "desktopApi", {
      configurable: true,
      value: {
        getCredentialStatus: vi.fn().mockReturnValue(status),
        setModelCredentials,
      },
    });

    render(<SettingsHarness notify={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "save key" }));

    await waitFor(() => expect(setModelCredentials).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByLabelText("credential configured").textContent)
      .toBe("true"));
    await act(async () => {
      resolveStatus({
        storage: { state: "secure", backend: "unknown" },
        models: [{ configurationId: "model-one", configured: false }],
        webSearchConfigured: false,
      });
      await status;
    });

    expect(screen.getByLabelText("credential configured").textContent).toBe("true");
  });

  it("fails closed when credential status cannot be read", async () => {
    const notify = vi.fn();
    Object.defineProperty(window, "desktopApi", {
      configurable: true,
      value: {
        getCredentialStatus: vi.fn().mockRejectedValue(new Error("corrupt store")),
      },
    });

    render(<SettingsHarness notify={notify} />);

    await waitFor(() => expect(screen.getByLabelText("enabled models").textContent).toBe(""));
    await waitFor(() => expect(notify).toHaveBeenCalledWith(
      expect.stringContaining("凭据状态读取失败"),
    ));
  });

  it("clears a previously configured model when a later status refresh fails", async () => {
    const notify = vi.fn();
    const getCredentialStatus = vi.fn()
      .mockResolvedValueOnce({
        storage: { state: "secure", backend: "unknown" },
        models: [{ configurationId: "model-one", configured: true }],
        webSearchConfigured: false,
      })
      .mockRejectedValueOnce(new Error("refresh failed"));
    Object.defineProperty(window, "desktopApi", {
      configurable: true,
      value: { getCredentialStatus },
    });

    render(<SettingsHarness notify={notify} />);
    await waitFor(() => expect(screen.getByLabelText("enabled models").textContent)
      .toBe("model-one"));

    fireEvent.click(screen.getByRole("button", { name: "change search endpoint" }));

    await waitFor(() => expect(getCredentialStatus).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByLabelText("enabled models").textContent).toBe(""));
    await waitFor(() => expect(notify).toHaveBeenCalledWith(
      expect.stringContaining("凭据状态读取失败"),
    ));
  });
});
