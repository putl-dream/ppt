import { LayoutPolicy } from "../../agent/design/layout-policy";
import type { DeckValidationIssue } from "@shared/deck-validation";
import type { DesignConstraints } from "@shared/deck-persistence";
import { createDefaultDesignConstraints } from "@shared/deck-persistence";
import type { Presentation, Slide, SlideElement, TextElement } from "@shared/presentation";
import { isLayoutCard } from "@shared/layout-shape-utils";
import { CONTENT_LAYOUTS, type SlideLayoutType } from "@shared/slide-layouts";

function isLayoutCardElement(element: SlideElement): boolean {
  return isLayoutCard(element);
}

function isIntentionalFullBleedImage(slide: Slide, element: SlideElement): boolean {
  return (
    element.type === "image"
    && element.imageSlot === "hero"
    && slide.sceneRef?.sceneId === "cinematic-cover"
    && slide.sceneRef.variantId === "full-bleed"
    && element.x === 0
    && element.y === 0
    && element.width === LayoutPolicy.CANVAS_WIDTH
    && element.height === LayoutPolicy.CANVAS_HEIGHT
    && LayoutPolicy.isWithinCanvas(element)
  );
}

function isIntentionalLayoutOverlap(left: SlideElement, right: SlideElement): boolean {
  const pair = [left, right];
  const hasNumber = pair.some((element) => element.type === "text" && element.id.startsWith("num-"));
  const hasBadgeOrStepAccent = pair.some((element) =>
    element.type === "shape"
    && (element.id.startsWith("badge-") || element.id.startsWith("accent-")),
  );
  if (hasNumber && hasBadgeOrStepAccent) return true;

  const connector = pair.find((element) =>
    element.type === "shape"
    && element.provenance === "layout"
    && (element.shapeType === "line" || element.shapeType === "arrow"),
  );
  const node = pair.find((element) =>
    element.id.startsWith("badge-") || element.id.startsWith("num-"),
  );
  if (connector && node) return true;

  // Low-opacity layout accents are background motifs, not foreground collisions.
  return pair.some((element) =>
    element.type === "shape"
    && element.provenance === "layout"
    && element.id.startsWith("accent-")
    && (element.fillOpacity ?? 1) <= 0.25,
  );
}

function shouldCheckOverlap(left: SlideElement, right: SlideElement): boolean {
  if (isLayoutCardElement(left) || isLayoutCardElement(right)) return false;
  if (isIntentionalLayoutOverlap(left, right)) return false;
  return true;
}

export interface LayoutValidatorOptions {
  constraints?: DesignConstraints;
  slideIds?: string[];
}

export class LayoutValidator {
  validate(presentation: Presentation, options: LayoutValidatorOptions = {}): DeckValidationIssue[] {
    const constraints = options.constraints ?? createDefaultDesignConstraints();
    const slideIdSet = options.slideIds ? new Set(options.slideIds) : undefined;
    const issues: DeckValidationIssue[] = [];

    for (const slide of presentation.slides) {
      if (slideIdSet && !slideIdSet.has(slide.id)) continue;
      issues.push(...this.validateSlide(slide, constraints));
    }

    return issues;
  }

  private validateSlide(slide: Slide, constraints: DesignConstraints): DeckValidationIssue[] {
    const issues: DeckValidationIssue[] = [];

    if (slide.elements.length === 0 && slide.layout && CONTENT_LAYOUTS.has(slide.layout as SlideLayoutType)) {
      issues.push({
        slideId: slide.id,
        category: "layout",
        severity: "error",
        message: `Slide '${slide.title}' uses layout '${slide.layout}' but has no canvas elements.`,
        fixHint: "Add body content or run AutoLayoutSlide for this slide.",
      });
    } else if (slide.elements.length === 0) {
      issues.push({
        slideId: slide.id,
        category: "layout",
        severity: "warning",
        message: `Slide '${slide.title}' has no canvas elements.`,
        fixHint: "Add content elements or choose an appropriate layout.",
      });
    }

    if (slide.elements.length > constraints.layout.maxElementsPerSlide) {
      issues.push({
        slideId: slide.id,
        category: "layout",
        severity: "warning",
        message: `Slide '${slide.title}' has ${slide.elements.length} elements, exceeding the recommended maximum of ${constraints.layout.maxElementsPerSlide}.`,
        fixHint: "Split content across slides or simplify the layout.",
      });
    }

    for (const element of slide.elements) {
      if (
        !LayoutPolicy.isWithinSafeZone(element)
        && !isIntentionalFullBleedImage(slide, element)
      ) {
        issues.push({
          slideId: slide.id,
          category: "layout",
          severity: "error",
          message: `Element '${element.id}' (${element.type}) on slide '${slide.title}' is outside the safe margin.`,
          fixHint: "Move or resize the element to stay within the canvas safe zone.",
        });
      }
    }

    for (let i = 0; i < slide.elements.length; i += 1) {
      for (let j = i + 1; j < slide.elements.length; j += 1) {
        const left = slide.elements[i];
        const right = slide.elements[j];
        if (!shouldCheckOverlap(left, right)) continue;
        if (LayoutPolicy.isOverlapping(left, right)) {
          issues.push({
            slideId: slide.id,
            category: "layout",
            severity: "warning",
            message: `Elements '${left.id}' and '${right.id}' overlap on slide '${slide.title}'.`,
            fixHint: "Adjust positions or rerun AutoLayoutSlide.",
          });
        }
      }
    }

    if (slide.layout === "comparison") {
      issues.push(...this.validateComparisonLayout(slide));
    }

    return issues;
  }

  private validateComparisonLayout(slide: Slide): DeckValidationIssue[] {
    const textElements = slide.elements.filter((element): element is TextElement => element.type === "text");
    if (textElements.length < 2) {
      return [
        {
          slideId: slide.id,
          category: "layout",
          severity: "error",
          message: `Comparison layout on slide '${slide.title}' requires at least two body text columns.`,
          fixHint: "Add left and right column content before applying comparison layout.",
        },
      ];
    }

    const midpoint = LayoutPolicy.CANVAS_WIDTH / 2;
    const leftTexts = textElements.filter((element) => element.x + element.width / 2 < midpoint);
    const rightTexts = textElements.filter((element) => element.x + element.width / 2 >= midpoint);
    const issues: DeckValidationIssue[] = [];

    if (leftTexts.length === 0 || rightTexts.length === 0) {
      issues.push({
        slideId: slide.id,
        category: "layout",
        severity: "error",
        message: `Comparison layout on slide '${slide.title}' has an empty column.`,
        fixHint: "Place body text in both the left and right columns.",
      });
    }

    for (const element of textElements) {
      if (!element.text.trim()) {
        issues.push({
          slideId: slide.id,
          category: "layout",
          severity: "warning",
          message: `Comparison column text element '${element.id}' on slide '${slide.title}' is empty.`,
          fixHint: "Fill the column or remove the unused text box.",
        });
      }
    }

    return issues;
  }
}

export const layoutValidator = new LayoutValidator();
