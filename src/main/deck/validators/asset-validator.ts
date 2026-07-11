import type { DeckValidationIssue } from "@shared/deck-validation";
import type { Presentation } from "@shared/presentation";

export interface AssetValidatorOptions {
  slideIds?: string[];
}

export class AssetValidator {
  validate(presentation: Presentation, options: AssetValidatorOptions = {}): DeckValidationIssue[] {
    const slideIdSet = options.slideIds ? new Set(options.slideIds) : undefined;
    const issues: DeckValidationIssue[] = [];

    for (const slide of presentation.slides) {
      if (slideIdSet && !slideIdSet.has(slide.id)) continue;
      for (const element of slide.elements) {
        if (element.type !== "image") continue;

        if (/^https?:\/\//i.test(element.url)) {
          issues.push({
            slideId: slide.id,
            category: "asset",
            severity: "error",
            message: `Image '${element.id}' on slide '${slide.title}' still uses a remote URL.`,
            fixHint: "Run InsertSlideImage with workspace localization before PPTX export.",
          });
        }

        if (element.provenance === "asset" && element.asset?.sourceUrl) {
          if (!element.asset.sourcePageUrl) {
            issues.push({
              slideId: slide.id,
              category: "asset",
              severity: "warning",
              message: `Image '${element.id}' has no source page for provenance review.`,
              fixHint: "Record the page that supplied the image candidate.",
            });
          }
          if (!element.asset.license) {
            issues.push({
              slideId: slide.id,
              category: "asset",
              severity: "warning",
              message: `Image '${element.id}' has no recorded license status.`,
              fixHint: "Verify the image license or replace it with a rights-safe asset.",
            });
          }
        }
      }
    }

    return issues;
  }
}

export const assetValidator = new AssetValidator();
