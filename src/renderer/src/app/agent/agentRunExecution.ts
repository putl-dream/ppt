import type { AgentGatewayPreferences } from "@shared/agent-gateway-config";
import type { AgentStepLimits } from "@shared/agent-step-limits";
import type { AgentRunRequest, AgentRunResult } from "@shared/ipc";
import type { LeanGenerationMode } from "@shared/lean-mode-contract";
import { buildAgentGatewayConfig } from "../../agentGatewayConfig";
import { getPersistedDisplayCards } from "../../cards/display-card-managers";
import { toAgentModelSettings, type ManagedModel } from "../../modelCatalog";
import { findActiveThreadId, type ChatMessage } from "../chatMessageRuntime";

interface ExecuteAgentRunOptions {
  request: AgentRunRequest;
  generationMode: LeanGenerationMode;
  sourceMessages: ChatMessage[];
  forkedMessages?: ChatMessage[];
  gatewayPreferences: AgentGatewayPreferences;
  enabledModels: ManagedModel[];
  selectedModel?: ManagedModel;
  stepLimits: AgentStepLimits;
  runId: string;
}

/**
 * Agent 执行边界：集中解析 Renderer 配置，并选择继续既有 thread 或启动新运行。
 * Hook 只传入运行上下文，不需要了解 desktopApi 两个入口的参数差异。
 */
export function executeAgentRun({
  request,
  generationMode,
  sourceMessages,
  forkedMessages,
  gatewayPreferences,
  enabledModels,
  selectedModel,
  stepLimits,
  runId,
}: ExecuteAgentRunOptions): Promise<AgentRunResult> {
  const gatewayConfig = buildAgentGatewayConfig(gatewayPreferences, enabledModels);
  const modelSettings = selectedModel ? toAgentModelSettings(selectedModel) : undefined;
  const activeThreadId = findActiveThreadId(
    forkedMessages ?? sourceMessages,
    getPersistedDisplayCards(),
  );

  // 只有完整 Agent 模式可以续接 thread；Lean 等模式始终开启独立运行。
  if (generationMode === "agent" && activeThreadId) {
    return window.desktopApi.continueAgentRun(
      activeThreadId,
      request,
      modelSettings,
      stepLimits,
      gatewayConfig,
      runId,
    );
  }

  return window.desktopApi.startAgentRun(
    request,
    modelSettings,
    "REQUEST_APPROVAL",
    stepLimits,
    gatewayConfig,
    runId,
  );
}
