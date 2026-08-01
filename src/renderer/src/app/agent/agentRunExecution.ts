import type { AgentGatewayPreferences } from "@shared/agent-gateway-config";
import type { AgentStepLimits } from "@shared/agent-step-limits";
import type { AgentExecutionStrategy } from "@shared/agent";
import type { AgentRunRequest, AgentRunResult } from "@shared/ipc";
import { buildAgentRunServicesWire } from "../../agentGatewayConfig";
import { getPersistedDisplayCards } from "../../cards/display-card-managers";
import { toAgentModelSettings, type ManagedModel } from "../../modelCatalog";
import { findActiveThreadId, type ChatMessage } from "../chatMessageRuntime";

interface ExecuteAgentRunOptions {
  request: AgentRunRequest;
  sourceMessages: ChatMessage[];
  forkedMessages?: ChatMessage[];
  gatewayPreferences: AgentGatewayPreferences;
  enabledModels: ManagedModel[];
  selectedModel?: ManagedModel;
  stepLimits: AgentStepLimits;
  executionStrategy: AgentExecutionStrategy;
  runId: string;
}

/**
 * Agent 执行边界：集中解析 Renderer 配置，并选择继续既有 thread 或启动新运行。
 * Hook 只传入运行上下文，不需要了解 desktopApi 两个入口的参数差异。
 */
export function executeAgentRun({
  request,
  sourceMessages,
  forkedMessages,
  gatewayPreferences,
  enabledModels,
  selectedModel,
  stepLimits,
  executionStrategy,
  runId,
}: ExecuteAgentRunOptions): Promise<AgentRunResult> {
  const gatewayConfig = buildAgentRunServicesWire(gatewayPreferences, enabledModels);
  const modelSettings = selectedModel ? toAgentModelSettings(selectedModel) : undefined;
  const activeThreadId = findActiveThreadId(
    forkedMessages ?? sourceMessages,
    getPersistedDisplayCards(),
  );

  if (activeThreadId) {
    return window.desktopApi.continueAgentRun(
      activeThreadId,
      request,
      modelSettings,
      executionStrategy,
      stepLimits,
      gatewayConfig,
      runId,
    );
  }

  return window.desktopApi.startAgentRun(
    request,
    modelSettings,
    executionStrategy,
    stepLimits,
    gatewayConfig,
    runId,
  );
}
