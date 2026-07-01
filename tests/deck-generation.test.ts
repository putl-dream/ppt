import { describe, expect, it } from "vitest";
import { planDeckBatches, recommendedBatchSizeForLayout } from "../src/main/deck/deck-batch-planner";
import { DeckGenerationService } from "../src/main/deck/deck-generation-service";
import { normalizeStoryboardSlide } from "../src/shared/storyboard";
import type { DeckGenerationJobStore } from "../src/main/deck/deck-generation-service";
import type { DeckGenerationJobsFile } from "../src/shared/deck-persistence";
import type { StoryboardSlideSpec } from "../src/shared/storyboard";

function createLongStoryboard(count: number): StoryboardSlideSpec[] {
  return Array.from({ length: count }, (_, index) =>
    normalizeStoryboardSlide(
      {
        id: `slide-${index + 1}`,
        title: `Slide ${index + 1}`,
        keyPoints: [`Point ${index + 1}`],
        layout:
          index === 0
            ? "cover"
            : index % 11 === 0
            ? "section"
            : index % 7 === 0
            ? "comparison"
            : "concept",
        status: "pending",
      },
      index,
    ),
  );
}

describe("deck batch planner", () => {
  it("uses batch size 1 for cover and section layouts", () => {
    expect(recommendedBatchSizeForLayout("cover")).toBe(1);
    expect(recommendedBatchSizeForLayout("section")).toBe(1);
  });

  it("plans batches for a 16-slide storyboard without exceeding layout constraints", () => {
    const storyboard = createLongStoryboard(16);
    const batches = planDeckBatches(storyboard);

    expect(batches.length).toBeGreaterThan(5);
    expect(batches.reduce((sum, batch) => sum + batch.slideIndices.length, 0)).toBe(16);

    for (const batch of batches) {
      const hasSpecialLayout = batch.slideSpecs.some((slide) => {
        const layout = slide.suggestedLayout ?? slide.layout;
        return layout === "cover" || layout === "section";
      });
      if (hasSpecialLayout) {
        expect(batch.slideIndices.length).toBe(1);
      }
    }
  });
});

describe("DeckGenerationService job lifecycle", () => {
  it("creates and updates a generation job for long storyboards", async () => {
    const storyboard = createLongStoryboard(15);
    const jobsBySession = new Map<string, DeckGenerationJobsFile>();
    const storyboardsBySession = new Map<string, StoryboardSlideSpec[]>();

    const store: DeckGenerationJobStore = {
      readJobs: async (sessionId) => jobsBySession.get(sessionId) ?? { jobs: [] },
      writeJobs: async (sessionId, file) => {
        jobsBySession.set(sessionId, file);
      },
      writeStoryboard: async (sessionId, nextStoryboard) => {
        storyboardsBySession.set(sessionId, nextStoryboard);
      },
    };

    const service = new DeckGenerationService();
    const started = await service.startJob(store, {
      sessionId: "session-1",
      storyboard,
      presentationRevision: 0,
    });

    expect(started.batches.length).toBeGreaterThan(5);
    expect(started.job.totalBatches).toBe(started.batches.length);
    expect(storyboardsBySession.get("session-1")?.every((slide) => slide.status === "pending")).toBe(true);

    const firstBatch = started.batches[0];
    const completed = await service.completeBatch(
      store,
      "session-1",
      started.job,
      storyboardsBySession.get("session-1") ?? storyboard,
      firstBatch,
      {
        id: "pres",
        title: "Batch Test",
        revision: 1,
        slides: firstBatch.slideIndices.map((index) => ({
          id: `deck-slide-${index + 1}`,
          title: storyboard[index].title,
          elements: [
            {
              id: `text-${index + 1}`,
              type: "text" as const,
              x: 120,
              y: 220,
              width: 1040,
              height: 200,
              text: "Body",
              fontSize: 24,
            },
          ],
        })),
      },
    );

    expect(completed.job.completedBatches).toBe(1);
    expect(completed.storyboard[firstBatch.slideIndices[0]]?.status).toBe("done");
  });
});
