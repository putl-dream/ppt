export interface AgentRunIdentity {
  runId: string;
  streamMessageId: string;
  sidechain: boolean;
}

export interface AgentRunContext extends AgentRunIdentity {
  sessionId: string;
  projectId: string;
}

export interface AgentRunLock {
  acquire: (runId: string) => boolean;
  release: (runId: string) => boolean;
  hasBlockingRun: () => boolean;
}

export function createAgentRunLock(): AgentRunLock {
  let blockingRunId: string | null = null;

  return {
    acquire(runId) {
      if (blockingRunId) return false;
      blockingRunId = runId;
      return true;
    },
    release(runId) {
      if (blockingRunId !== runId) return false;
      blockingRunId = null;
      return true;
    },
    hasBlockingRun() {
      return blockingRunId !== null;
    },
  };
}

interface CoordinateAgentRunOptions<TResult> {
  prepareContext: () => Promise<AgentRunContext | undefined>;
  execute: (context: AgentRunContext) => Promise<TResult>;
  finalize: (context: AgentRunContext, result: TResult) => Promise<void>;
  handleFailure: (error: unknown, context: AgentRunContext | undefined) => void;
  cleanup: (context: AgentRunContext | undefined) => void;
}

/**
 * Renderer Agent 用例的生命周期边界。所有准备、执行和结果收口路径最终都会进入 cleanup，
 * 避免 React 入口分别维护失败分支和运行锁。
 */
export async function coordinateAgentRun<TResult>({
  prepareContext,
  execute,
  finalize,
  handleFailure,
  cleanup,
}: CoordinateAgentRunOptions<TResult>): Promise<void> {
  let context: AgentRunContext | undefined;
  try {
    context = await prepareContext();
    if (!context) return;
    const result = await execute(context);
    await finalize(context, result);
  } catch (error) {
    handleFailure(error, context);
  } finally {
    cleanup(context);
  }
}
