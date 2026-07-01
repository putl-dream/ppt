import type { DeckValidationIssue } from "@shared/deck-validation";
import type { DesignConstraints } from "@shared/deck-persistence";
import { createDefaultDesignConstraints } from "@shared/deck-persistence";
import type { Presentation, Slide, TextElement } from "@shared/presentation";

export interface StyleValidatorOptions {
  constraints?: DesignConstraints;
  slideIds?: string[];
}

const CHROME_LAYOUTS = new Set(["cover", "section"]);

export class StyleValidator {
  validate(presentation: Presentation, options: StyleValidatorOptions = {}): DeckValidationIssue[] {
    const constraints = options.constraints ?? createDefaultDesignConstraints();
    const slideIdSet = options.slideIds ? new Set(options.slideIds) : undefined;
    const issues: DeckValidationIssue[] = [];

    issues.push(...this.validatePresentationTheme(presentation));

    const titleToSlideIds = new Map<string, string[]>();
    for (const slide of presentation.slides) {
      if (slideIdSet && !slideIdSet.has(slide.id)) continue;

      if (!slide.title.trim()) {
        issues.push({
          slideId: slide.id,
          category: "structure",
          severity: "warning",
          message: `Slide at index ${presentation.slides.indexOf(slide) + 1} is missing a title.`,
          fixHint: "Set a unique, descriptive slide title.",
        });
      } else {
        const ids = titleToSlideIds.get(slide.title) ?? [];
        ids.push(slide.id);
        titleToSlideIds.set(slide.title, ids);
      }

      issues.push(...this.validateSlideTypography(slide, constraints));
      issues.push(...this.validateChromeDuplication(slide));
    }

    for (const [title, slideIds] of titleToSlideIds.entries()) {
      if (slideIds.length > 1) {
        issues.push({
          category: "consistency",
          severity: "warning",
          message: `Slide title '${title}' is repeated across ${slideIds.length} slides.`,
          fixHint: "Differentiate slide titles to improve navigation and narrative clarity.",
        });
      }
    }

    return issues;
  }

  private validatePresentationTheme(presentation: Presentation): DeckValidationIssue[] {
    if (presentation.slides.length === 0) return [];

    const issues: DeckValidationIssue[] = [];
    if (!presentation.theme) {
      issues.push({
        category: "style",
        severity: "warning",
        message: "Presentation theme is not set.",
        fixHint: "Apply a theme with ApplyThemeStyle or set-theme command.",
      });
    }
    if (!presentation.palette) {
      issues.push({
        category: "style",
        severity: "warning",
        message: "Presentation palette is not set.",
        fixHint: "Apply a palette with ApplyThemeStyle or set-theme command.",
      });
    }
    return issues;
  }

  private validateSlideTypography(slide: Slide, constraints: DesignConstraints): DeckValidationIssue[] {
    const textElements = slide.elements.filter((element): element is TextElement => element.type === "text");
    if (textElements.length === 0) return [];

    const issues: DeckValidationIssue[] = [];
    const distinctFontSizes = new Set(textElements.map((element) => element.fontSize));

    if (distinctFontSizes.size > 3) {
      issues.push({
        slideId: slide.id,
        category: "style",
        severity: "warning",
        message: `Slide '${slide.title}' uses ${distinctFontSizes.size} distinct font sizes; keep within three levels.`,
        fixHint: "Normalize heading/body/caption sizes according to design constraints.",
      });
    }

    for (const element of textElements) {
      if (element.fontSize < constraints.typography.bodyMinFontSize) {
        issues.push({
          slideId: slide.id,
          category: "style",
          severity: "warning",
          message: `Text element '${element.id}' on slide '${slide.title}' uses font size ${element.fontSize}, below minimum ${constraints.typography.bodyMinFontSize}.`,
          fixHint: "Increase font size for readability.",
        });
      }

      const isTitleSized = element.fontSize >= constraints.typography.titleMinFontSize;
      const maxAllowed = isTitleSized
        ? constraints.typography.headingLevels[0]?.maxFontSize ?? 56
        : constraints.typography.bodyMaxFontSize;

      if (element.fontSize > maxAllowed) {
        issues.push({
          slideId: slide.id,
          category: "style",
          severity: "warning",
          message: `Text element '${element.id}' on slide '${slide.title}' uses font size ${element.fontSize}, above recommended maximum ${maxAllowed}.`,
          fixHint: "Reduce font size to match the typography hierarchy.",
        });
      }
    }

    return issues;
  }

  private validateChromeDuplication(slide: Slide): DeckValidationIssue[] {
    if (!slide.layout || CHROME_LAYOUTS.has(slide.layout)) return [];

    const normalizedTitle = slide.title.trim();
    if (!normalizedTitle) return [];

    const duplicates = slide.elements.filter(
      (element) =>
        element.type === "text" && element.text.trim() === normalizedTitle,
    );

    if (duplicates.length === 0) return [];

    return duplicates.map((element) => ({
      slideId: slide.id,
      category: "style",
      severity: "warning",
      message: `Slide '${slide.title}' duplicates the chrome title in canvas text element '${element.id}'.`,
      fixHint: "Remove the duplicate title text; the slide header already renders the title.",
    }));
  }
}

export const styleValidator = new StyleValidator();
