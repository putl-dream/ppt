import { extname, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import type { DeckValidationIssue } from "@shared/deck-validation";
import type { Presentation } from "@shared/presentation";
import { auditPresentationVisualAssets } from "@shared/visual-asset-audit";
import { isOutsideWorkspace } from "../../agent/subagent/workspace-path";

export interface AssetValidatorOptions {
  slideIds?: string[];
  workspaceRoot?: string;
  allowUnverifiedAssets?: boolean;
}

const SUPPORTED_IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif"]);

function resolveLocalImagePath(source: string): string | undefined {
  if (/^data:image\/(?:png|jpeg|gif);base64,/i.test(source)) return undefined;
  if (/^https?:\/\//i.test(source)) return undefined;
  if (/^file:\/\//i.test(source)) {
    try {
      return fileURLToPath(source);
    } catch {
      return source;
    }
  }
  return source;
}

export class AssetValidator {
  validate(presentation: Presentation, options: AssetValidatorOptions = {}): DeckValidationIssue[] {
    const slideIdSet = options.slideIds ? new Set(options.slideIds) : undefined;
    const issues: DeckValidationIssue[] = [];
    const visualAudit = auditPresentationVisualAssets(presentation);

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

        const localPath = resolveLocalImagePath(element.url);
        if (localPath) {
          if (!options.workspaceRoot) {
            issues.push({
              slideId: slide.id,
              category: "asset",
              severity: "error",
              message: `Image '${element.id}' uses a local path but no workspace root is available to validate it.`,
              fixHint: "Use a supported image data URL or open the deck in a workspace-backed project.",
            });
          } else if (isOutsideWorkspace(options.workspaceRoot, localPath)) {
            issues.push({
              slideId: slide.id,
              category: "asset",
              severity: "error",
              message: `Image '${element.id}' resolves outside the workspace sandbox.`,
              fixHint: "Copy the image into the workspace and insert the localized asset.",
            });
          }

          const extension = extname(localPath).toLowerCase();
          if (
            (isAbsolute(localPath) || options.workspaceRoot)
            && !SUPPORTED_IMAGE_EXTENSIONS.has(extension)
          ) {
            issues.push({
              slideId: slide.id,
              category: "asset",
              severity: "error",
              message: `Image '${element.id}' does not use a supported PNG, JPEG, or GIF file extension.`,
              fixHint: "Localize a supported raster image before export.",
            });
          }
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
          const licenseStatus = element.asset.licenseStatus ?? "unknown";
          if (licenseStatus === "restricted") {
            issues.push({
              slideId: slide.id,
              category: "asset",
              severity: "error",
              message: `Image '${element.id}' is marked as restricted and cannot be exported.`,
              fixHint: "Replace it with a rights-safe asset before export.",
            });
          } else if (licenseStatus !== "verified") {
            issues.push({
              slideId: slide.id,
              category: "asset",
              severity: options.allowUnverifiedAssets ? "warning" : "error",
              message: `Image '${element.id}' has not had its commercial license verified.`,
              fixHint: options.allowUnverifiedAssets
                ? "The user explicitly approved exporting this unverified asset."
                : "Verify the license, replace the image, or explicitly approve unverified assets for this export.",
            });
          } else if (!element.asset.license) {
            issues.push({
              slideId: slide.id,
              category: "asset",
              severity: "warning",
              message: `Image '${element.id}' is verified but has no human-readable license label.`,
              fixHint: "Record the license name in the asset metadata.",
            });
          }
        }
      }
    }

    for (const slideAudit of visualAudit.slides) {
      if (slideIdSet && !slideIdSet.has(slideAudit.slideId)) continue;
      if (slideAudit.status === "missing-required") {
        issues.push({
          slideId: slideAudit.slideId,
          category: "asset",
          severity: "error",
          message: `Slide '${slideAudit.title}' uses an image-dependent layout but is missing a required image.`,
          fixHint: slideAudit.reason,
        });
      } else if (slideAudit.status === "missing-recommended") {
        issues.push({
          slideId: slideAudit.slideId,
          category: "asset",
          severity: "warning",
          message: `Slide '${slideAudit.title}' is missing the visual anchor recommended by its layout.`,
          fixHint: slideAudit.reason,
        });
      }
    }

    for (const duplicateUrl of visualAudit.duplicateImageUrls) {
      const duplicateSlides = presentation.slides.filter((slide) =>
        slide.elements.some((element) => element.type === "image" && element.url === duplicateUrl),
      );
      if (slideIdSet && !duplicateSlides.some((slide) => slideIdSet.has(slide.id))) continue;
      issues.push({
        category: "asset",
        severity: "warning",
        message: `The same image source is reused across ${duplicateSlides.length} slides.`,
        fixHint: "Use a unique, slide-specific visual unless repetition is intentional and approved.",
      });
    }

    return issues;
  }
}

export const assetValidator = new AssetValidator();
