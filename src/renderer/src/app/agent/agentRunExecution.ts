import type { AgentExecutionStrategy } from "@shared/agent";
import type { AgentGatewayPreferences } from "@shared/agent-gateway-config";
import type { AgentStepLimits } from "@shared/agent-step-limits";
import { getPersistedDisplayCards } from "@shared/cards/display-card-managers";
import type { AgentRunRequest, AgentRunResult } from "@shared/ipc";
import { buildAgentRunServicesWire } from "../../agentGatewayConfig";
import { type ManagedModel, toAgentModelSelection } from "../../modelCatalog";
import { type ChatMessage, findActiveThreadId } from "../chatMessageRuntime";

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
 * Agent 执行边界：集中解析Renderer 配置，并选择继续既有 thread 或启动新运行。 * Hook 只传入运行上下文，不需要了解desktopApi 两个入口的参数差异。 */
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
  const modelSelection = selectedModel ? toAgentModelSelection(selectedModel) : undefined;
  const activeThreadId = findActiveThreadId(
    forkedMessages ?? sourceMessages,
    getPersistedDisplayCards(),
  );

  if (activeThreadId) {
    return window.desktopApi.continueAgentRun(
      activeThreadId,
      request,
      modelSelection,
      executionStrategy,
      stepLimits,
      gatewayConfig,
      runId,
    );
  }

  return window.desktopApi.startAgentRun(
    request,
    modelSelection,
    executionStrategy,
    stepLimits,
    gatewayConfig,
    runId,
  );
}
