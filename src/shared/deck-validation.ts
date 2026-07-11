import { z } from "zod";

export const deckValidationIssueSchema = z.object({
  slideId: z.string().optional(),
  category: z.enum(["layout", "style", "structure", "consistency", "asset"]),
  severity: z.enum(["info", "warning", "error"]),
  message: z.string(),
  fixHint: z.string().optional(),
});

export type DeckValidationIssue = z.infer<typeof deckValidationIssueSchema>;

export interface DeckValidationResult {
  issues: DeckValidationIssue[];
  errorCount: number;
  warningCount: number;
  /** True when there are no error-severity issues */
  valid: boolean;
}

export function summarizeDeckValidation(issues: DeckValidationIssue[]): DeckValidationResult {
  const errorCount = issues.filter((issue) => issue.severity === "error").length;
  const warningCount = issues.filter((issue) => issue.severity === "warning").length;
  return {
    issues,
    errorCount,
    warningCount,
    valid: errorCount === 0,
  };
}
