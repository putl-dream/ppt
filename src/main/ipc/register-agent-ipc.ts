import { ipcMain } from "electron";
import type { AgentStreamEvent } from "@shared/ipc";
import {
  agentExecutionStrategySchema,
  agentModelSettingsSchema,
  type AgentExecutionStrategy,
  type AgentModelSettings,
  type AgentModelSelection,
} from "@shared/agent";
import { agentStepLimitsSchema, type AgentStepLimits } from "@shared/agent-step-limits";
import { agentGatewayConfigSchema, type AgentGatewayConfig } from "@shared/agent-gateway-config";
import { findRecoverableConversation } from "@shared/session-recovery";
import { asProposalId } from "@shared/presentation-lifecycle";
import {
  createModuleLogger,
  requestSummary,
  withLogContext,
} from "../agent/logger";
import { formatMailboxMessagesForHistory } from "../agent/teammate/message-bus";
import type { AppContext } from "../app-context";
import type { SessionRuntimeRegistry } from "../session-runtime";

const logger = createModuleLogger("main");

export function registerAgentIpc(
  ctx: AppContext,
  registry: SessionRuntimeRegistry,
): void {
  const { activeRuns, sessionActiveRuns } = registry;

  ipcMain.handle("agent:cancel", async (_, runId: string) => {
    ctx.toolApprovalBroker.cancelForRun(runId);
    const controller = activeRuns.get(runId);
    if (controller) {
      controller.abort();
      logger.info("agent.run.cancelled", { runId });
      return true;
    }
    return false;
  });

  ipcMain.handle("agent:cancel-session", async (_, sessionId: string) => {
    const runId = sessionActiveRuns.get(sessionId);
    if (!runId) return false;
    ctx.toolApprovalBroker.cancelForRun(runId);
    const controller = activeRuns.get(runId);
    if (controller) {
      controller.abort();
      logger.info("agent.session.cancelled", { sessionId, runId });
      return true;
    }
    return false;
  });

  ipcMain.handle(
    "agent:resolve-tool-approval",
    async (_, runId: string, approvalId: string, approved: boolean) => {
      const resolved = ctx.toolApprovalBroker.resolve(approvalId, approved);
      withLogContext({ runId }, () => {
        logger.info("agent.tool-approval.resolved", {
          approvalId,
          approved,
          resolved,
        });
      });
      return resolved;
    },
  );

  ipcMain.handle("agent:poll-lead-inbox", async (_, sessionId: string) => {
    const runtime = await registry.getRuntimeForSession(sessionId);
    const messages = runtime.messageBus
      ? await runtime.messageBus.peekInbox("lead")
      : [];
    return {
      hasMessages: messages.length > 0,
      count: messages.length,
      preview: formatMailboxMessagesForHistory(messages.slice(0, 5), 1_000),
      types: Array.from(new Set(messages.map((message) => message.type))),
    };
  });

  /**
   * 接收 Renderer 的新 query，完成协议/模型配置校验、并发控制和运行事件初始化，
   * 并统一进入 Agent 的 SVG-native 工具循环。旧 Lean 请求在入口处明确拒绝。
   */
  ipcMain.handle(
    "agent:start",
    async (
      event,
      rawRequest: unknown,
      input?: AgentModelSettings,
      strategy?: AgentExecutionStrategy,
      rawStepLimits?: AgentStepLimits,
      rawGatewayConfig?: AgentGatewayConfig,
      runId?: string,
    ) => {
      const request = registry.parseAgentRequest("start", rawRequest);
      const sessionId = request.sessionId;
      const currentRunId = runId || crypto.randomUUID();

      // 当前桌面端采用单窗口、单前台运行模型；Main 同步执行这一约束，
      // 让模型配置和交互状态在一次 run 内保持稳定。
      if (activeRuns.size > 0) {
        withLogContext({ operation: "start", sessionId, runId: currentRunId, threadId: currentRunId }, () => {
          logger.warn("agent.request.rejected", {
            reason: "concurrency-conflict",
            activeRunIds: [...activeRuns.keys()],
            ...requestSummary(request.prompt),
          });
        });
        throw new Error("Concurrency Conflict: An active agent run is already in progress.");
      }

      const controller = new AbortController();
      activeRuns.set(currentRunId, controller);
      sessionActiveRuns.set(sessionId, currentRunId);

      try {
        const runtime = await registry.getRuntimeForSession(sessionId);
        const settings = input ? agentModelSettingsSchema.parse(input) : undefined;
        const executionStrategy = strategy
          ? agentExecutionStrategySchema.parse(strategy)
          : "REQUEST_APPROVAL";
        const agentStepLimits = rawStepLimits
          ? agentStepLimitsSchema.parse(rawStepLimits)
          : undefined;
        const gatewayConfig = rawGatewayConfig
          ? agentGatewayConfigSchema.parse(rawGatewayConfig)
          : undefined;
        let selection: AgentModelSelection | undefined;
        if (settings) {
          selection = ctx.agentGateway.configure(settings, gatewayConfig);
        } else if (gatewayConfig) {
          ctx.agentGateway.applyGatewayConfig(gatewayConfig);
        }
        ctx.sessionStore.conversationDatabase.beginRun({
          runId: currentRunId,
          sessionId,
          threadId: currentRunId,
          provider: selection?.provider,
          model: selection?.model,
          request: request.prompt,
        });
        const emit = registry.createStreamEmitter(
          event.sender,
          sessionId,
          currentRunId,
          currentRunId,
          controller,
        );

        const result = await registry.runAgentOperation(
          "start",
          sessionId,
          currentRunId,
          request.prompt,
          {
            threadId: currentRunId,
            provider: selection?.provider,
            model: selection?.model,
            executionStrategy,
          },
          controller.signal,
          async () => {
            const result = await runtime.agentService.start(
              request.prompt,
              selection,
              executionStrategy,
              emit,
              request.editorContext,
              ctx.sessionStore.getAgentMessageHistory(sessionId, request.prompt),
              controller.signal,
              currentRunId,
              agentStepLimits,
            );
            return registry.finalizeAgentResult(sessionId, runtime, result, currentRunId);
          },
        );
        if (!event.sender.isDestroyed()) {
          event.sender.send("agent:stream", {
            type: "stream-completed",
            runId: currentRunId,
            sessionId,
          } satisfies AgentStreamEvent);
        }
        return result;
      } finally {
        ctx.toolApprovalBroker.finishForRun(currentRunId);
        activeRuns.delete(currentRunId);
        if (sessionActiveRuns.get(sessionId) === currentRunId) {
          sessionActiveRuns.delete(sessionId);
        }
      }
    },
  );

  ipcMain.handle("agent:continue", async (
    event,
    threadId: string,
    rawRequest: unknown,
    rawModelSettings?: AgentModelSettings,
    rawExecutionStrategy?: AgentExecutionStrategy,
    rawStepLimits?: AgentStepLimits,
    rawGatewayConfig?: AgentGatewayConfig,
    runId?: string,
  ) => {
    const request = registry.parseAgentRequest("continue-agent-run", rawRequest);
    const sessionId = request.sessionId;
    const currentRunId = runId || crypto.randomUUID();

    // 与 start 保持同一条全局串行边界，避免继续会话与新运行交错。
    if (activeRuns.size > 0) {
      withLogContext({ operation: "continue-agent-run", sessionId, runId: currentRunId, threadId }, () => {
        logger.warn("agent.request.rejected", {
          reason: "concurrency-conflict",
          activeRunIds: [...activeRuns.keys()],
          ...requestSummary(request.prompt),
        });
      });
      throw new Error("Concurrency Conflict: An active agent run is already in progress.");
    }

    const controller = new AbortController();
    activeRuns.set(currentRunId, controller);
    sessionActiveRuns.set(sessionId, currentRunId);

    try {
      const runtime = await registry.getRuntimeForSession(sessionId);
      const settings = rawModelSettings
        ? agentModelSettingsSchema.parse(rawModelSettings)
        : undefined;
      const executionStrategy = rawExecutionStrategy
        ? agentExecutionStrategySchema.parse(rawExecutionStrategy)
        : undefined;
      const agentStepLimits = rawStepLimits
        ? agentStepLimitsSchema.parse(rawStepLimits)
        : undefined;
      const gatewayConfig = rawGatewayConfig
        ? agentGatewayConfigSchema.parse(rawGatewayConfig)
        : undefined;
      let selection: AgentModelSelection | undefined;
      if (settings) {
        selection = ctx.agentGateway.configure(settings, gatewayConfig);
      } else if (gatewayConfig) {
        ctx.agentGateway.applyGatewayConfig(gatewayConfig);
      }
      ctx.sessionStore.conversationDatabase.beginRun({
        runId: currentRunId,
        sessionId,
        threadId,
        provider: selection?.provider,
        model: selection?.model,
        request: request.prompt,
      });
      const emit = registry.createStreamEmitter(
        event.sender,
        sessionId,
        currentRunId,
        threadId,
        controller,
      );

      const result = await registry.runAgentOperation(
        "continue-agent-run",
        sessionId,
        currentRunId,
        request.prompt,
        { threadId },
        controller.signal,
        async () => {
          await runtime.agentService.restoreDurableThread(threadId);
          if (!runtime.agentService.hasActiveConversation(threadId)) {
            const recovered = findRecoverableConversation(
              ctx.sessionStore.getSession(sessionId).messages,
            );
            if (recovered?.threadId === threadId) {
              runtime.agentService.restoreAgentRunConversation(
                threadId,
                recovered.messages,
              );
            }
          }

          const run = runtime.agentService.hasActiveConversation(threadId)
            ? runtime.agentService.continueAgentRun(
                threadId,
                request.prompt,
                emit,
                request.editorContext,
                controller.signal,
                currentRunId,
                agentStepLimits,
                selection,
                executionStrategy,
              )
            : runtime.agentService.start(
                request.prompt,
                selection,
                executionStrategy ?? "REQUEST_APPROVAL",
                emit,
                request.editorContext,
                ctx.sessionStore.getAgentMessageHistory(sessionId, request.prompt),
                controller.signal,
                currentRunId,
                agentStepLimits,
              );

          return registry.finalizeAgentResult(sessionId, runtime, await run, currentRunId);
        },
      );
      if (!event.sender.isDestroyed()) {
        event.sender.send("agent:stream", {
          type: "stream-completed",
          runId: currentRunId,
          sessionId,
        } satisfies AgentStreamEvent);
      }
      return result;
    } finally {
      ctx.toolApprovalBroker.finishForRun(currentRunId);
      activeRuns.delete(currentRunId);
      if (sessionActiveRuns.get(sessionId) === currentRunId) {
        sessionActiveRuns.delete(sessionId);
      }
    }
  });

  ipcMain.handle("agent:resume", async (
    _event,
    sessionId: string,
    rawProposalId: string,
    approved: boolean,
  ) => {
    const proposalId = asProposalId(rawProposalId);
    const runtime = await registry.getRuntimeForSession(sessionId);
    const chat = ctx.sessionStore.findProposalChatContext(sessionId, proposalId);
    withLogContext({
      operation: "resolve-proposal",
      sessionId,
      threadId: chat?.threadId,
    }, () => {
      logger.info("agent.proposal.resolution.received", { proposalId, approved });
    });
    return registry.runAgentOperation(
      "resolve-proposal",
      sessionId,
      undefined,
      undefined,
      {
        proposalId,
        ...(chat?.threadId ? { threadId: chat.threadId } : {}),
        approved,
      },
      undefined,
      async () => registry.finalizeAgentResult(
        sessionId,
        runtime,
        await runtime.agentService.resumeProposal(proposalId, approved),
        undefined,
      ),
    );
  });
}
