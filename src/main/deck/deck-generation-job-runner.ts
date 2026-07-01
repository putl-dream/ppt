import type { AgentExecutionStrategy, AgentModelSelection } from "@shared/agent";
import type { AgentRunResult } from "@shared/ipc";
import type { DeckAgentContext } from "@shared/deck-agent-context";
import type { DeckGenerationJob } from "@shared/deck-persistence";
import type { StoryboardSlideSpec } from "@shared/storyboard";
import { parseStoryboard } from "@shared/storyboard";
import type { CommandBus } from "@shared/commands";
import type { Presentation } from "@shared/presentation";
import type { AgentService, AgentServiceEventListener } from "../agent/service";
import {
  buildDeckAgentStructuredPrompt,
  createArtifactReader,
  deckContextBuilder,
  type DeckContextArtifactReader,
} from "./deck-context-builder";
import {
  DeckGenerationService,
  deckGenerationService,
  type DeckGenerationJobStore,
} from "./deck-generation-service";
import type { DeckBatchPlan } from "./deck-batch-planner";

export type DeckGenerationStreamEvent =
  | {
      type: "deck-job-started";
      jobId: string;
      totalBatches: number;
      message: string;
    }
  | {
      type: "deck-batch-started";
      jobId: string;
      batchIndex: number;
      totalBatches: number;
      message: string;
    }
  | {
      type: "deck-batch-validated";
      jobId: string;
      batchIndex: number;
      errorCount: number;
      warningCount: number;
      message: string;
    }
  | {
      type: "deck-job-progress";
      jobId: string;
      completedBatches: number;
      totalBatches: number;
      status: DeckGenerationJob["status"];
      message: string;
    }
  | {
      type: "deck-job-finished";
      jobId: string;
      status: DeckGenerationJob["status"];
      message: string;
    };

export type DeckGenerationRunResult =
  | { status: "completed"; job: DeckGenerationJob; presentation: Presentation }
  | { status: "paused"; job: DeckGenerationJob; approval: AgentRunResult & { status: "approval-required" } }
  | { status: "failed"; job: DeckGenerationJob; message: string }
  | { status: "chat"; job: DeckGenerationJob; message: string; threadId?: string };

export interface RunDeckGenerationJobInput {
  sessionId: string;
  userPrompt: string;
  commandBus: CommandBus;
  agentService: AgentService;
  store: DeckGenerationJobStore;
  readStoryboard: () => Promise<StoryboardSlideSpec[]>;
  readArtifact: DeckContextArtifactReader;
  persistPresentation: () => Promise<Presentation>;
  model?: AgentModelSelection;
  executionStrategy?: AgentExecutionStrategy;
  listener?: AgentServiceEventListener;
  deckListener?: (event: DeckGenerationStreamEvent) => void;
  signal?: AbortSignal;
  resumeJobId?: string;
}

export class DeckGenerationJobRunner {
  constructor(private readonly generationService: DeckGenerationService = deckGenerationService) {}

  async run(input: RunDeckGenerationJobInput): Promise<DeckGenerationRunResult> {
    let storyboard = await input.readStoryboard();
    let job: DeckGenerationJob;
    let batches: DeckBatchPlan[];

    if (input.resumeJobId) {
      job = await this.generationService.getJob(input.store, input.sessionId, input.resumeJobId);
      batches = this.generationService.planBatches(storyboard);
      job = await this.generationService.updateJob(input.store, input.sessionId, {
        ...job,
        status: "running",
      });
    } else {
      const started = await this.generationService.startJob(input.store, {
        sessionId: input.sessionId,
        storyboard,
        presentationRevision: input.commandBus.getSnapshot().revision,
      });
      job = started.job;
      batches = started.batches;
      storyboard = await input.readStoryboard();
      job = await this.generationService.updateJob(input.store, input.sessionId, {
        ...job,
        status: "running",
      });
    }

    input.deckListener?.({
      type: "deck-job-started",
      jobId: job.id,
      totalBatches: job.totalBatches,
      message: `已启动 deck 生成任务，共 ${job.totalBatches} 批。`,
    });

    while (true) {
      if (input.signal?.aborted) {
        const paused = await this.generationService.updateJob(input.store, input.sessionId, {
          ...job,
          status: "paused",
        });
        input.deckListener?.({
          type: "deck-job-finished",
          jobId: paused.id,
          status: "paused",
          message: "生成任务已暂停。",
        });
        return { status: "failed", job: paused, message: "Run aborted by user." };
      }

      const batchIndex = this.generationService.getNextBatchIndex(job, storyboard);
      if (batchIndex === null || batchIndex >= batches.length) {
        const doneJob = await this.generationService.updateJob(input.store, input.sessionId, {
          ...job,
          status: "done",
          completedBatches: job.totalBatches,
          pendingBatchIndex: undefined,
        });
        const presentation = input.commandBus.getSnapshot();
        input.deckListener?.({
          type: "deck-job-finished",
          jobId: doneJob.id,
          status: "done",
          message: "Deck 分批生成已完成。",
        });
        return { status: "completed", job: doneJob, presentation };
      }

      const batch = batches[batchIndex];
      storyboard = await this.generationService.markStoryboardStatuses(
        input.store,
        input.sessionId,
        storyboard,
        batch.slideIndices,
        "generating",
      );

      input.deckListener?.({
        type: "deck-batch-started",
        jobId: job.id,
        batchIndex: batch.batchIndex,
        totalBatches: job.totalBatches,
        message: `正在生成第 ${batch.batchIndex + 1}/${job.totalBatches} 批（slides ${batch.slideIndices.map((index) => index + 1).join(", ")}）...`,
      });

      const deckAgentContext: DeckAgentContext = await deckContextBuilder.build({
        presentation: input.commandBus.getSnapshot(),
        storyboard,
        batch,
        readArtifact: input.readArtifact,
      });
      const batchPrompt = buildDeckAgentStructuredPrompt(input.userPrompt, deckAgentContext, {
        sessionId: input.sessionId,
        stage: "deck",
        intent: "generate-deck",
        targetPath: "deck/snapshot.json",
      });
      const result = await input.agentService.start(
        batchPrompt,
        input.model,
        input.executionStrategy ?? "REQUEST_APPROVAL",
        input.listener,
        undefined,
        [],
        input.signal,
        deckAgentContext,
      );

      if (result.status === "approval-required") {
        const paused = await this.generationService.updateJob(input.store, input.sessionId, {
          ...job,
          status: "paused",
          pendingBatchIndex: batch.batchIndex,
        });
        input.deckListener?.({
          type: "deck-job-finished",
          jobId: paused.id,
          status: "paused",
          message: `第 ${batch.batchIndex + 1} 批等待审批。`,
        });
        return { status: "paused", job: paused, approval: result };
      }

      if (result.status === "chat") {
        const paused = await this.generationService.updateJob(input.store, input.sessionId, {
          ...job,
          status: "paused",
          pendingBatchIndex: batch.batchIndex,
        });
        return {
          status: "chat",
          job: paused,
          message: result.message,
          threadId: result.threadId,
        };
      }

      if (result.status !== "completed") {
        const failed = await this.generationService.failBatch(
          input.store,
          input.sessionId,
          job,
          storyboard,
          batch,
          `Unexpected agent status: ${result.status}`,
        );
        input.deckListener?.({
          type: "deck-job-finished",
          jobId: failed.job.id,
          status: "failed",
          message: failed.job.errors?.at(-1)?.message ?? "Deck batch failed.",
        });
        return {
          status: "failed",
          job: failed.job,
          message: failed.job.errors?.at(-1)?.message ?? "Deck batch failed.",
        };
      }

      const presentation = await input.persistPresentation();
      const batchResult = await this.generationService.completeBatch(
        input.store,
        input.sessionId,
        job,
        storyboard,
        batch,
        presentation,
      );
      job = batchResult.job;
      storyboard = batchResult.storyboard;

      input.deckListener?.({
        type: "deck-batch-validated",
        jobId: job.id,
        batchIndex: batch.batchIndex,
        errorCount: batchResult.validation.errorCount,
        warningCount: batchResult.validation.warningCount,
        message: `第 ${batch.batchIndex + 1} 批校验完成：${batchResult.validation.errorCount} 个 error，${batchResult.validation.warningCount} 个 warning。`,
      });
      input.deckListener?.({
        type: "deck-job-progress",
        jobId: job.id,
        completedBatches: job.completedBatches,
        totalBatches: job.totalBatches,
        status: job.status,
        message: `进度 ${job.completedBatches}/${job.totalBatches} 批。`,
      });

      if (batchResult.validation.errorCount > 0) {
        const failed = await this.generationService.failBatch(
          input.store,
          input.sessionId,
          job,
          storyboard,
          batch,
          `Batch validation failed with ${batchResult.validation.errorCount} error(s).`,
        );
        input.deckListener?.({
          type: "deck-job-finished",
          jobId: failed.job.id,
          status: "failed",
          message: failed.job.errors?.at(-1)?.message ?? "Batch validation failed.",
        });
        return {
          status: "failed",
          job: failed.job,
          message: failed.job.errors?.at(-1)?.message ?? "Batch validation failed.",
        };
      }
    }
  }
}

export const deckGenerationJobRunner = new DeckGenerationJobRunner();

export async function readStoryboardFromContent(content: string): Promise<StoryboardSlideSpec[]> {
  return parseStoryboard(content);
}

export interface ContinueDeckBatchApprovalInput {
  sessionId: string;
  jobId: string;
  batchIndex: number;
  commandBus: CommandBus;
  store: DeckGenerationJobStore;
  readStoryboard: () => Promise<StoryboardSlideSpec[]>;
  persistPresentation: () => Promise<Presentation>;
  deckListener?: (event: DeckGenerationStreamEvent) => void;
}

export async function continueDeckBatchAfterApproval(
  generationService: DeckGenerationService,
  input: ContinueDeckBatchApprovalInput,
): Promise<{ job: DeckGenerationJob; storyboard: StoryboardSlideSpec[] }> {
  const storyboard = await input.readStoryboard();
  const job = await generationService.getJob(input.store, input.sessionId, input.jobId);
  const batches = generationService.planBatches(storyboard);
  const batch = batches[input.batchIndex];
  if (!batch) throw new Error(`Batch not found: ${input.batchIndex}`);

  const presentation = await input.persistPresentation();
  const result = await generationService.completeBatch(
    input.store,
    input.sessionId,
    job,
    storyboard,
    batch,
    presentation,
  );

  input.deckListener?.({
    type: "deck-batch-validated",
    jobId: result.job.id,
    batchIndex: batch.batchIndex,
    errorCount: result.validation.errorCount,
    warningCount: result.validation.warningCount,
    message: `第 ${batch.batchIndex + 1} 批校验完成：${result.validation.errorCount} 个 error，${result.validation.warningCount} 个 warning。`,
  });

  return { job: result.job, storyboard: result.storyboard };
}
