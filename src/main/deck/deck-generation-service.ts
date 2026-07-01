import type { DeckGenerationJob } from "@shared/deck-persistence";
import type { DeckValidationResult } from "@shared/deck-validation";
import type { Presentation } from "@shared/presentation";
import type { StoryboardSlideSpec, StoryboardSlideStatus } from "@shared/storyboard";
import { serializeStoryboard } from "@shared/storyboard";
import {
  planDeckBatches,
  type DeckBatchPlan,
  getPendingBatchIndex,
} from "./deck-batch-planner";
import { DeckValidationService, deckValidationService } from "./deck-validation-service";

export interface ValidateDeckBatchInput {
  presentation: Presentation;
  batchIndex?: number;
  slideIds?: string[];
}

export interface ValidateDeckBatchResult extends DeckValidationResult {
  batchIndex?: number;
}

export interface StartDeckGenerationJobInput {
  sessionId: string;
  storyboard: StoryboardSlideSpec[];
  presentationRevision?: number;
}

export interface StartDeckGenerationJobResult {
  job: DeckGenerationJob;
  batches: DeckBatchPlan[];
}

export interface DeckGenerationJobStore {
  readJobs(sessionId: string): Promise<{ jobs: DeckGenerationJob[] }>;
  writeJobs(sessionId: string, file: { jobs: DeckGenerationJob[] }): Promise<void>;
  writeStoryboard(sessionId: string, storyboard: StoryboardSlideSpec[]): Promise<void>;
}

export function buildDeckBatchPrompt(
  batch: DeckBatchPlan,
  storyboard: StoryboardSlideSpec[],
  userPrompt: string,
): string {
  const batchLines = batch.slideSpecs.map((spec, offset) => {
    const globalIndex = batch.slideIndices[offset] + 1;
    const layout = spec.suggestedLayout ?? spec.layout ?? "concept";
    return [
      `- Slide ${globalIndex} (storyboardId=${spec.id}, layout=${layout})`,
      `  title: ${spec.title}`,
      `  keyPoints: ${spec.keyPoints.join(" | ") || "(none)"}`,
      spec.quote ? `  quote: ${spec.quote}` : undefined,
    ]
      .filter(Boolean)
      .join("\n");
  });

  const completedCount = storyboard.filter((slide) => slide.status === "done").length;

  return [
    userPrompt.trim(),
    "",
    "Deck generation batch constraints:",
    `- Generate ONLY batch ${batch.batchIndex + 1} containing slides ${batch.slideIndices.map((index) => index + 1).join(", ")}.`,
    `- Do NOT modify slides before index ${batch.slideIndices[0] + 1} unless explicitly revising.`,
    `- Completed slides so far: ${completedCount}/${storyboard.length}.`,
    "",
    "Batch slide specs:",
    ...batchLines,
    "",
    "Return a command_proposal with PresentationCommands for this batch only.",
  ].join("\n");
}

export function resolveBatchSlideIds(
  presentation: Presentation,
  batch: DeckBatchPlan,
): string[] {
  return batch.slideIndices
    .map((index) => presentation.slides[index]?.id)
    .filter((slideId): slideId is string => Boolean(slideId));
}

/**
 * 数据层 deck 生成服务：批次规划、job 状态、批后校验。
 */
export class DeckGenerationService {
  constructor(private readonly validationService: DeckValidationService = deckValidationService) {}

  validateAfterBatch(input: ValidateDeckBatchInput): ValidateDeckBatchResult {
    const result = this.validationService.validate(input.presentation, {
      slideIds: input.slideIds,
    });

    return {
      ...result,
      batchIndex: input.batchIndex,
    };
  }

  planBatches(storyboard: StoryboardSlideSpec[]): DeckBatchPlan[] {
    return planDeckBatches(storyboard);
  }

  async startJob(
    store: DeckGenerationJobStore,
    input: StartDeckGenerationJobInput,
  ): Promise<StartDeckGenerationJobResult> {
    const batches = this.planBatches(input.storyboard);
    const now = new Date().toISOString();
    const job: DeckGenerationJob = {
      id: crypto.randomUUID(),
      sessionId: input.sessionId,
      storyboardPath: "slides/storyboard.json",
      batchSize: 2,
      completedBatches: 0,
      totalBatches: batches.length,
      status: "pending",
      lastRevision: input.presentationRevision ?? 0,
      pendingBatchIndex: batches.length > 0 ? 0 : undefined,
      updatedAt: now,
      errors: [],
    };

    const file = await store.readJobs(input.sessionId);
    file.jobs.push(job);
    await store.writeJobs(input.sessionId, file);

    const normalizedStoryboard: StoryboardSlideSpec[] = input.storyboard.map((slide) => ({
      ...slide,
      status: (slide.status === "done" ? "done" : "pending") satisfies StoryboardSlideStatus,
    }));
    await store.writeStoryboard(input.sessionId, normalizedStoryboard);

    return { job, batches };
  }

  async getJob(store: DeckGenerationJobStore, sessionId: string, jobId: string): Promise<DeckGenerationJob> {
    const file = await store.readJobs(sessionId);
    const job = file.jobs.find((item) => item.id === jobId);
    if (!job) throw new Error(`Deck generation job not found: ${jobId}`);
    return job;
  }

  async getActiveJob(
    store: DeckGenerationJobStore,
    sessionId: string,
  ): Promise<DeckGenerationJob | undefined> {
    const file = await store.readJobs(sessionId);
    return file.jobs.find((job) =>
      job.sessionId === sessionId &&
      (job.status === "pending" || job.status === "running" || job.status === "paused" || job.status === "failed"),
    );
  }

  async updateJob(
    store: DeckGenerationJobStore,
    sessionId: string,
    job: DeckGenerationJob,
  ): Promise<DeckGenerationJob> {
    const file = await store.readJobs(sessionId);
    const index = file.jobs.findIndex((item) => item.id === job.id);
    if (index < 0) throw new Error(`Deck generation job not found: ${job.id}`);
    file.jobs[index] = { ...job, updatedAt: new Date().toISOString() };
    await store.writeJobs(sessionId, file);
    return file.jobs[index];
  }

  getNextBatchIndex(job: DeckGenerationJob, storyboard: StoryboardSlideSpec[]): number | null {
    if (job.pendingBatchIndex !== undefined) return job.pendingBatchIndex;
    const batches = this.planBatches(storyboard);
    return getPendingBatchIndex(batches, storyboard);
  }

  async markStoryboardStatuses(
    store: DeckGenerationJobStore,
    sessionId: string,
    storyboard: StoryboardSlideSpec[],
    slideIndices: number[],
    status: StoryboardSlideSpec["status"],
  ): Promise<StoryboardSlideSpec[]> {
    const next = storyboard.map((slide, index) =>
      slideIndices.includes(index) ? { ...slide, status } : slide,
    );
    await store.writeStoryboard(sessionId, next);
    return next;
  }

  async completeBatch(
    store: DeckGenerationJobStore,
    sessionId: string,
    job: DeckGenerationJob,
    storyboard: StoryboardSlideSpec[],
    batch: DeckBatchPlan,
    presentation: Presentation,
  ): Promise<{ job: DeckGenerationJob; storyboard: StoryboardSlideSpec[]; validation: ValidateDeckBatchResult }> {
    const validation = this.validateAfterBatch({
      presentation,
      batchIndex: batch.batchIndex,
      slideIds: resolveBatchSlideIds(presentation, batch),
    });

    const nextStoryboard = await this.markStoryboardStatuses(
      store,
      sessionId,
      storyboard,
      batch.slideIndices,
      "done",
    );

    const nextJob: DeckGenerationJob = {
      ...job,
      completedBatches: job.completedBatches + 1,
      lastRevision: presentation.revision,
      pendingBatchIndex:
        job.completedBatches + 1 < job.totalBatches ? batch.batchIndex + 1 : undefined,
      status: job.completedBatches + 1 >= job.totalBatches ? "done" : "running",
    };

    const savedJob = await this.updateJob(store, sessionId, nextJob);
    return { job: savedJob, storyboard: nextStoryboard, validation };
  }

  async failBatch(
    store: DeckGenerationJobStore,
    sessionId: string,
    job: DeckGenerationJob,
    storyboard: StoryboardSlideSpec[],
    batch: DeckBatchPlan,
    message: string,
  ): Promise<{ job: DeckGenerationJob; storyboard: StoryboardSlideSpec[] }> {
    const nextStoryboard = await this.markStoryboardStatuses(
      store,
      sessionId,
      storyboard,
      batch.slideIndices,
      "failed",
    );

    const nextJob: DeckGenerationJob = {
      ...job,
      status: "failed",
      pendingBatchIndex: batch.batchIndex,
      errors: [...(job.errors ?? []), { batchIndex: batch.batchIndex, message }],
    };

    const savedJob = await this.updateJob(store, sessionId, nextJob);
    return { job: savedJob, storyboard: nextStoryboard };
  }

  serializeStoryboard(storyboard: StoryboardSlideSpec[]): string {
    return serializeStoryboard(storyboard);
  }
}

export const deckGenerationService = new DeckGenerationService();
