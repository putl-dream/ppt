import { z } from "zod";
import { designSystemV1Schema } from "@design-system";

export const projectArtifactFilePaths = {
  designConstraints: "design/constraints.json",
  deckGenerationJobs: "deck/generation-jobs.json",
  exportHistory: "history/exports.json",
} as const;

export const designConstraintsSchema = z.object({
  typography: z.object({
    titleMinFontSize: z.number().positive(),
    bodyMaxFontSize: z.number().positive(),
    bodyMinFontSize: z.number().positive(),
    headingLevels: z.array(
      z.object({
        name: z.string(),
        minFontSize: z.number().positive(),
        maxFontSize: z.number().positive(),
      }),
    ),
  }),
  layout: z.object({
    safeMarginPx: z.number().nonnegative(),
    maxElementsPerSlide: z.number().int().positive(),
  }),
  forbidden: z.array(z.string()),
});

export const deckGenerationJobSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  storyboardPath: z.literal("slides/storyboard.json"),
  batchSize: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(2),
  completedBatches: z.number().int().nonnegative(),
  totalBatches: z.number().int().nonnegative(),
  status: z.enum(["pending", "running", "paused", "failed", "done"]),
  lastRevision: z.number().int().nonnegative(),
  pendingBatchIndex: z.number().int().nonnegative().optional(),
  updatedAt: z.string().optional(),
  errors: z
    .array(
      z.object({
        batchIndex: z.number().int().nonnegative(),
        message: z.string(),
      }),
    )
    .optional(),
});

export const deckGenerationJobsFileSchema = z.object({
  jobs: z.array(deckGenerationJobSchema),
});

export const deckExportRecordSchema = z.object({
  revision: z.number().int().nonnegative(),
  filePath: z.string(),
  exportedAt: z.string(),
  designSystem: designSystemV1Schema,
});

export const deckExportHistoryFileSchema = z.object({
  exports: z.array(deckExportRecordSchema),
});

export type DesignConstraints = z.infer<typeof designConstraintsSchema>;
export type DeckGenerationJob = z.infer<typeof deckGenerationJobSchema>;
export type DeckGenerationJobsFile = z.infer<typeof deckGenerationJobsFileSchema>;
export type DeckExportRecord = z.infer<typeof deckExportRecordSchema>;
export type DeckExportHistoryFile = z.infer<typeof deckExportHistoryFileSchema>;

export function createDefaultDesignConstraints(): DesignConstraints {
  return {
    typography: {
      titleMinFontSize: 36,
      bodyMaxFontSize: 32,
      bodyMinFontSize: 14,
      headingLevels: [
        { name: "slide-title", minFontSize: 36, maxFontSize: 56 },
        { name: "section-heading", minFontSize: 24, maxFontSize: 32 },
        { name: "body", minFontSize: 14, maxFontSize: 24 },
        { name: "caption", minFontSize: 12, maxFontSize: 16 },
      ],
    },
    layout: {
      safeMarginPx: 40,
      maxElementsPerSlide: 12,
    },
    forbidden: [
      "Do not use more than 3 distinct font sizes on one slide",
      "Do not place body text outside the safe margin",
      "Do not duplicate the slide chrome title as a canvas text element",
      "Do not use low-contrast text on the slide background",
    ],
  };
}

export function createDefaultGenerationJobsFile(): DeckGenerationJobsFile {
  return { jobs: [] };
}

export function createDefaultExportHistoryFile(): DeckExportHistoryFile {
  return { exports: [] };
}
