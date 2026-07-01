import type { StoryboardSlideSpec, SlideLayout } from "@shared/storyboard";

export interface DeckBatchPlan {
  batchIndex: number;
  slideIndices: number[];
  slideSpecs: StoryboardSlideSpec[];
  recommendedBatchSize: 1 | 2 | 3;
}

export function recommendedBatchSizeForLayout(layout: SlideLayout | undefined): 1 | 2 | 3 {
  switch (layout) {
    case "cover":
    case "section":
      return 1;
    case "comparison":
    case "architecture":
      return 2;
    case "concept":
    case "summary":
    case "process":
    case "case":
    default:
      return 2;
  }
}

function resolveLayout(slide: StoryboardSlideSpec): SlideLayout {
  return slide.suggestedLayout ?? slide.layout ?? "concept";
}

/**
 * 按 storyboard 顺序与 layout 类型规划批次。
 * cover/section 单独成批；comparison/architecture 最多 2 页；其余默认 2 页。
 */
export function planDeckBatches(storyboard: StoryboardSlideSpec[]): DeckBatchPlan[] {
  const batches: DeckBatchPlan[] = [];
  let index = 0;

  while (index < storyboard.length) {
    const firstLayout = resolveLayout(storyboard[index]);
    let batchSize = recommendedBatchSizeForLayout(firstLayout);

    if (batchSize > 1) {
      const slice = storyboard.slice(index, index + batchSize);
      if (slice.some((slide) => recommendedBatchSizeForLayout(resolveLayout(slide)) === 1)) {
        batchSize = 1;
      }
    }

    const slideIndices = Array.from({ length: batchSize }, (_, offset) => index + offset).filter(
      (slideIndex) => slideIndex < storyboard.length,
    );
    const slideSpecs = slideIndices.map((slideIndex) => storyboard[slideIndex]);

    batches.push({
      batchIndex: batches.length,
      slideIndices,
      slideSpecs,
      recommendedBatchSize: slideSpecs.length === 1 ? 1 : batchSize,
    });

    index += slideIndices.length;
  }

  return batches;
}

export function getPendingBatchIndex(
  batches: DeckBatchPlan[],
  storyboard: StoryboardSlideSpec[],
): number | null {
  for (const batch of batches) {
    const hasPending = batch.slideIndices.some((index) => {
      const status = storyboard[index]?.status ?? "pending";
      return status === "pending" || status === "failed";
    });
    if (hasPending) return batch.batchIndex;
  }
  return null;
}
