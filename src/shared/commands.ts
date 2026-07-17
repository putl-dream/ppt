import { z } from "zod";
import type { Presentation, Slide } from "./presentation";
import {
  hexColorSchema,
  slideSchema,
  slideElementSchema,
  slideElementsSchema,
} from "./presentation";
import { applyLayout } from "./layout";
import { SLIDE_LAYOUTS } from "./slide-layouts";
import { SLIDE_VARIANTS } from "./slide-variant";
import { resolveFontFamily } from "./typography";
import {
  designSystemV1Schema,
  resolveSlideStyle,
  slideDesignOverrideSchema,
} from "@design-system";

export const presentationCommandSchema = z.discriminatedUnion("type", [
  z.object({
    id: z.string(),
    type: z.literal("add-slide"),
    slide: slideSchema,
    index: z.number().int().nonnegative(),
  }),
  z.object({
    id: z.string(),
    type: z.literal("remove-slide"),
    slideId: z.string(),
  }),
  z.object({
    id: z.string(),
    type: z.literal("set-presentation-title"),
    title: z.string().min(1),
  }),
  z.object({
    id: z.string(),
    type: z.literal("set-slide-title"),
    slideId: z.string(),
    title: z.string().min(1),
  }),
  z.object({
    id: z.string(),
    type: z.literal("add-element"),
    slideId: z.string(),
    element: slideElementSchema,
  }),
  z.object({
    id: z.string(),
    type: z.literal("remove-element"),
    slideId: z.string(),
    elementId: z.string(),
  }),
  z.object({
    id: z.string(),
    type: z.literal("update-element"),
    slideId: z.string(),
    elementId: z.string(),
    element: slideElementSchema,
  }),
  z.object({
    id: z.string(),
    type: z.literal("set-design-system"),
    designSystem: designSystemV1Schema,
  }),
  z.object({
    id: z.string(),
    type: z.literal("set-slide-design"),
    slideId: z.string(),
    designOverride: slideDesignOverrideSchema,
  }),
  z.object({
    id: z.string(),
    type: z.literal("update-slide-variant"),
    slideId: z.string(),
    slideVariant: z.enum(SLIDE_VARIANTS).optional(),
  }),
  z.object({
    id: z.string(),
    type: z.literal("update-slide-layout"),
    slideId: z.string(),
    layout: z.enum(SLIDE_LAYOUTS),
    grammarVariant: z.string().optional(),
    designOverride: slideDesignOverrideSchema.optional(),
  }),
  z.object({
    id: z.string(),
    type: z.literal("update-text-style"),
    slideId: z.string(),
    elementId: z.string(),
    fontSize: z.number().positive().optional(),
    bold: z.boolean().optional(),
    color: hexColorSchema.optional(),
    align: z.enum(["left", "center", "right"]).optional(),
    textRole: z.enum(["kicker", "body", "metric", "caption"]).optional(),
    fontFamily: z.enum(["serif", "sans", "mono"]).optional(),
  }),
  z.object({
    id: z.string(),
    type: z.literal("move-element"),
    slideId: z.string(),
    elementId: z.string(),
    x: z.number(),
    y: z.number(),
  }),
  z.object({
    id: z.string(),
    type: z.literal("resize-element"),
    slideId: z.string(),
    elementId: z.string(),
    width: z.number().positive(),
    height: z.number().positive(),
  }),
  z.object({
    id: z.string(),
    type: z.literal("restore-slide-elements"),
    slideId: z.string(),
    elements: slideElementsSchema,
  }),
  z.object({
    id: z.string(),
    type: z.literal("restore-slide"),
    slide: slideSchema,
  }),
]);

export type PresentationCommand = z.infer<typeof presentationCommandSchema>;

export interface ExecutedCommand {
  command: PresentationCommand;
  inverse: PresentationCommand;
}

function nextRevision(presentation: Presentation): Presentation {
  return { ...presentation, revision: presentation.revision + 1 };
}

export function executeCommand(
  presentation: Presentation,
  input: PresentationCommand,
): { presentation: Presentation; executed: ExecutedCommand } {
  const command = presentationCommandSchema.parse(input);

  if (command.type === "add-slide") {
    if (presentation.slides.some((slide) => slide.id === command.slide.id)) {
      throw new Error(`Duplicate slide id: ${command.slide.id}`);
    }
    const index = Math.min(command.index, presentation.slides.length);
    const slides = [...presentation.slides];
    slides.splice(index, 0, command.slide);
    return {
      presentation: nextRevision({ ...presentation, slides }),
      executed: {
        command,
        inverse: { id: crypto.randomUUID(), type: "remove-slide", slideId: command.slide.id },
      },
    };
  }

  if (command.type === "remove-slide") {
    const index = presentation.slides.findIndex((slide) => slide.id === command.slideId);
    if (index < 0) throw new Error(`Slide not found: ${command.slideId}`);
    const slide = presentation.slides[index];
    return {
      presentation: nextRevision({
        ...presentation,
        slides: presentation.slides.filter((item) => item.id !== command.slideId),
      }),
      executed: {
        command,
        inverse: { id: crypto.randomUUID(), type: "add-slide", slide, index },
      },
    };
  }

  if (command.type === "set-presentation-title") {
    return {
      presentation: nextRevision({ ...presentation, title: command.title }),
      executed: {
        command,
        inverse: {
          id: crypto.randomUUID(),
          type: "set-presentation-title",
          title: presentation.title,
        },
      },
    };
  }

  if (command.type === "set-slide-title") {
    const slideIndex = presentation.slides.findIndex((slide) => slide.id === command.slideId);
    if (slideIndex < 0) throw new Error(`Slide not found: ${command.slideId}`);
    const previousSlide: Slide = presentation.slides[slideIndex];
    const slides = presentation.slides.map((slide) =>
      slide.id === command.slideId ? { ...slide, title: command.title } : slide,
    );
    return {
      presentation: nextRevision({ ...presentation, slides }),
      executed: {
        command,
        inverse: {
          id: crypto.randomUUID(),
          type: "set-slide-title",
          slideId: command.slideId,
          title: previousSlide.title,
        },
      },
    };
  }

  if (command.type === "add-element") {
    const slideIndex = presentation.slides.findIndex((slide) => slide.id === command.slideId);
    if (slideIndex < 0) throw new Error(`Slide not found: ${command.slideId}`);
    const targetSlide = presentation.slides[slideIndex];
    if (targetSlide.elements.some((element) => element.id === command.element.id)) {
      throw new Error(`Duplicate element id: ${command.element.id}`);
    }
    const elements = [...targetSlide.elements, command.element];
    const slides = presentation.slides.map((slide) =>
      slide.id === command.slideId ? { ...slide, elements } : slide,
    );
    return {
      presentation: nextRevision({ ...presentation, slides }),
      executed: {
        command,
        inverse: {
          id: crypto.randomUUID(),
          type: "remove-element",
          slideId: command.slideId,
          elementId: command.element.id,
        },
      },
    };
  }

  if (command.type === "remove-element") {
    const slideIndex = presentation.slides.findIndex((slide) => slide.id === command.slideId);
    if (slideIndex < 0) throw new Error(`Slide not found: ${command.slideId}`);
    const targetSlide = presentation.slides[slideIndex];
    const elementIndex = targetSlide.elements.findIndex((el) => el.id === command.elementId);
    if (elementIndex < 0) throw new Error(`Element not found: ${command.elementId}`);
    const targetElement = targetSlide.elements[elementIndex];
    const elements = targetSlide.elements.filter((el) => el.id !== command.elementId);
    const slides = presentation.slides.map((slide) =>
      slide.id === command.slideId ? { ...slide, elements } : slide,
    );
    return {
      presentation: nextRevision({ ...presentation, slides }),
      executed: {
        command,
        inverse: {
          id: crypto.randomUUID(),
          type: "add-element",
          slideId: command.slideId,
          element: targetElement,
        },
      },
    };
  }

  if (command.type === "update-element") {
    const slideIndex = presentation.slides.findIndex((slide) => slide.id === command.slideId);
    if (slideIndex < 0) throw new Error(`Slide not found: ${command.slideId}`);
    const targetSlide = presentation.slides[slideIndex];
    const elementIndex = targetSlide.elements.findIndex((el) => el.id === command.elementId);
    if (elementIndex < 0) throw new Error(`Element not found: ${command.elementId}`);
    const targetElement = targetSlide.elements[elementIndex];
    if (targetSlide.elements.some((element, index) =>
      index !== elementIndex && element.id === command.element.id
    )) {
      throw new Error(`Duplicate element id: ${command.element.id}`);
    }
    if (command.element.id !== command.elementId) {
      throw new Error(
        `Element id mismatch: expected ${command.elementId}, received ${command.element.id}`,
      );
    }
    const elements = targetSlide.elements.map((el) =>
      el.id === command.elementId ? command.element : el,
    );
    const slides = presentation.slides.map((slide) =>
      slide.id === command.slideId ? { ...slide, elements } : slide,
    );
    return {
      presentation: nextRevision({ ...presentation, slides }),
      executed: {
        command,
        inverse: {
          id: crypto.randomUUID(),
          type: "update-element",
          slideId: command.slideId,
          elementId: command.elementId,
          element: targetElement,
        },
      },
    };
  }

  if (command.type === "set-design-system") {
    const previousDesignSystem = presentation.designSystem;
    const slides = presentation.slides.map((slide) => {
      const style = resolveSlideStyle(command.designSystem, slide);
      const restyledSlide: Slide = {
        ...slide,
        elements: slide.elements.map((element) => (
          element.type === "text"
            ? {
                ...element,
                fontFamily: resolveFontFamily(
                  undefined,
                  element.textRole ?? "body",
                  style.typography.family,
                ),
              }
            : element
        )),
      };
      if (!slide.layout || !SLIDE_LAYOUTS.includes(slide.layout as (typeof SLIDE_LAYOUTS)[number])) {
        return restyledSlide;
      }
      return applyLayout(restyledSlide, slide.layout as (typeof SLIDE_LAYOUTS)[number], style, {
        grammarVariant: slide.grammarVariant,
        designOverride: slide.designOverride,
      });
    });
    return {
      presentation: nextRevision({
        ...presentation,
        designSystem: command.designSystem,
        slides,
      }),
      executed: {
        command,
        inverse: {
          id: crypto.randomUUID(),
          type: "set-design-system",
          designSystem: previousDesignSystem,
        },
      },
    };
  }

  if (command.type === "set-slide-design") {
    const slideIndex = presentation.slides.findIndex((s) => s.id === command.slideId);
    if (slideIndex < 0) throw new Error(`Slide not found: ${command.slideId}`);
    const targetSlide = presentation.slides[slideIndex];
    const designedSlide = { ...targetSlide, designOverride: command.designOverride };
    const updatedSlide = targetSlide.layout && SLIDE_LAYOUTS.includes(targetSlide.layout as (typeof SLIDE_LAYOUTS)[number])
      ? applyLayout(
          designedSlide,
          targetSlide.layout as (typeof SLIDE_LAYOUTS)[number],
          resolveSlideStyle(presentation.designSystem, designedSlide),
          { grammarVariant: targetSlide.grammarVariant, designOverride: command.designOverride },
        )
      : designedSlide;
    const slides = presentation.slides.map((s) => s.id === command.slideId ? updatedSlide : s);
    return {
      presentation: nextRevision({ ...presentation, slides }),
      executed: {
        command,
        inverse: {
          id: crypto.randomUUID(),
          type: "restore-slide",
          slide: structuredClone(targetSlide),
        },
      },
    };
  }

  if (command.type === "update-slide-variant") {
    const slideIndex = presentation.slides.findIndex((s) => s.id === command.slideId);
    if (slideIndex < 0) throw new Error(`Slide not found: ${command.slideId}`);
    const targetSlide = presentation.slides[slideIndex];
    const slides = presentation.slides.map((s) => {
      if (s.id !== command.slideId) return s;
      let variantSlide: Slide;
      if (command.slideVariant === undefined) {
        const { slideVariant: _removed, ...rest } = s;
        variantSlide = rest as Slide;
      } else {
        variantSlide = { ...s, slideVariant: command.slideVariant };
      }
      if (
        variantSlide.layout &&
        SLIDE_LAYOUTS.includes(variantSlide.layout as (typeof SLIDE_LAYOUTS)[number])
      ) {
        const style = resolveSlideStyle(presentation.designSystem, variantSlide);
        return applyLayout(
          variantSlide,
          variantSlide.layout as (typeof SLIDE_LAYOUTS)[number],
          style,
          {
            grammarVariant: variantSlide.grammarVariant,
            designOverride: variantSlide.designOverride,
          },
        );
      }
      return variantSlide;
    });
    return {
      presentation: nextRevision({ ...presentation, slides }),
      executed: {
        command,
        inverse: {
          id: crypto.randomUUID(),
          type: "restore-slide",
          slide: structuredClone(targetSlide),
        },
      },
    };
  }

  if (command.type === "update-slide-layout") {
    const slideIndex = presentation.slides.findIndex((s) => s.id === command.slideId);
    if (slideIndex < 0) throw new Error(`Slide not found: ${command.slideId}`);
    const targetSlide = presentation.slides[slideIndex];
    const previousSlide = structuredClone(targetSlide);

    const designedSlide = command.designOverride
      ? { ...targetSlide, designOverride: command.designOverride }
      : targetSlide;
    const updatedSlide = applyLayout(
      designedSlide,
      command.layout,
      resolveSlideStyle(presentation.designSystem, designedSlide),
      {
        grammarVariant: command.grammarVariant,
        designOverride: command.designOverride ?? targetSlide.designOverride,
      },
    );

    const slides = presentation.slides.map((s) =>
      s.id === command.slideId ? updatedSlide : s
    );

    return {
      presentation: nextRevision({ ...presentation, slides }),
      executed: {
        command,
        inverse: {
          id: crypto.randomUUID(),
          type: "restore-slide",
          slide: previousSlide,
        },
      },
    };
  }

  if (command.type === "restore-slide") {
    const slideIndex = presentation.slides.findIndex((s) => s.id === command.slide.id);
    if (slideIndex < 0) throw new Error(`Slide not found: ${command.slide.id}`);
    const targetSlide = presentation.slides[slideIndex];

    const slides = presentation.slides.map((s) =>
      s.id === command.slide.id ? command.slide : s
    );

    return {
      presentation: nextRevision({ ...presentation, slides }),
      executed: {
        command,
        inverse: {
          id: crypto.randomUUID(),
          type: "restore-slide",
          slide: targetSlide,
        },
      },
    };
  }

  if (command.type === "restore-slide-elements") {
    const slideIndex = presentation.slides.findIndex((s) => s.id === command.slideId);
    if (slideIndex < 0) throw new Error(`Slide not found: ${command.slideId}`);
    const targetSlide = presentation.slides[slideIndex];

    const slides = presentation.slides.map((s) =>
      s.id === command.slideId ? { ...s, elements: command.elements } : s
    );

    return {
      presentation: nextRevision({ ...presentation, slides }),
      executed: {
        command,
        inverse: {
          id: crypto.randomUUID(),
          type: "restore-slide-elements",
          slideId: command.slideId,
          elements: targetSlide.elements,
        },
      },
    };
  }

  if (command.type === "update-text-style") {
    const slideIndex = presentation.slides.findIndex((s) => s.id === command.slideId);
    if (slideIndex < 0) throw new Error(`Slide not found: ${command.slideId}`);
    const targetSlide = presentation.slides[slideIndex];
    const elementIndex = targetSlide.elements.findIndex((el) => el.id === command.elementId);
    if (elementIndex < 0) throw new Error(`Element not found: ${command.elementId}`);
    const targetElement = targetSlide.elements[elementIndex];
    if (targetElement.type !== "text") throw new Error(`Element is not text: ${command.elementId}`);

    const updatedElement = {
      ...targetElement,
      fontSize: command.fontSize !== undefined ? command.fontSize : targetElement.fontSize,
      bold: command.bold !== undefined ? command.bold : targetElement.bold,
      color: command.color !== undefined ? command.color : targetElement.color,
      align: command.align !== undefined ? command.align : targetElement.align,
      textRole: command.textRole !== undefined ? command.textRole : targetElement.textRole,
      fontFamily: command.fontFamily !== undefined ? command.fontFamily : targetElement.fontFamily,
    };

    const elements = targetSlide.elements.map((el) =>
      el.id === command.elementId ? updatedElement : el
    );
    const slides = presentation.slides.map((s) =>
      s.id === command.slideId ? { ...s, elements } : s
    );

    return {
      presentation: nextRevision({ ...presentation, slides }),
      executed: {
        command,
        inverse: {
          id: crypto.randomUUID(),
          type: "update-text-style",
          slideId: command.slideId,
          elementId: command.elementId,
          fontSize: targetElement.fontSize,
          bold: targetElement.bold,
          color: targetElement.color,
          align: targetElement.align,
          textRole: targetElement.textRole,
          fontFamily: targetElement.fontFamily,
        },
      },
    };
  }

  if (command.type === "move-element") {
    const slideIndex = presentation.slides.findIndex((s) => s.id === command.slideId);
    if (slideIndex < 0) throw new Error(`Slide not found: ${command.slideId}`);
    const targetSlide = presentation.slides[slideIndex];
    const elementIndex = targetSlide.elements.findIndex((el) => el.id === command.elementId);
    if (elementIndex < 0) throw new Error(`Element not found: ${command.elementId}`);
    const targetElement = targetSlide.elements[elementIndex];

    const updatedElement = {
      ...targetElement,
      x: command.x,
      y: command.y,
    };

    const elements = targetSlide.elements.map((el) =>
      el.id === command.elementId ? updatedElement : el
    );
    const slides = presentation.slides.map((s) =>
      s.id === command.slideId ? { ...s, elements } : s
    );

    return {
      presentation: nextRevision({ ...presentation, slides }),
      executed: {
        command,
        inverse: {
          id: crypto.randomUUID(),
          type: "move-element",
          slideId: command.slideId,
          elementId: command.elementId,
          x: targetElement.x,
          y: targetElement.y,
        },
      },
    };
  }

  if (command.type === "resize-element") {
    const slideIndex = presentation.slides.findIndex((s) => s.id === command.slideId);
    if (slideIndex < 0) throw new Error(`Slide not found: ${command.slideId}`);
    const targetSlide = presentation.slides[slideIndex];
    const elementIndex = targetSlide.elements.findIndex((el) => el.id === command.elementId);
    if (elementIndex < 0) throw new Error(`Element not found: ${command.elementId}`);
    const targetElement = targetSlide.elements[elementIndex];

    const updatedElement = {
      ...targetElement,
      width: command.width,
      height: command.height,
    };

    const elements = targetSlide.elements.map((el) =>
      el.id === command.elementId ? updatedElement : el
    );
    const slides = presentation.slides.map((s) =>
      s.id === command.slideId ? { ...s, elements } : s
    );

    return {
      presentation: nextRevision({ ...presentation, slides }),
      executed: {
        command,
        inverse: {
          id: crypto.randomUUID(),
          type: "resize-element",
          slideId: command.slideId,
          elementId: command.elementId,
          width: targetElement.width,
          height: targetElement.height,
        },
      },
    };
  }

  throw new Error(`Unhandled command type`);
}

export class CommandBus {
  private undoStack: ExecutedCommand[] = [];
  private redoStack: ExecutedCommand[] = [];

  constructor(private presentation: Presentation) {}

  getSnapshot(): Presentation {
    return structuredClone(this.presentation);
  }

  execute(command: PresentationCommand): Presentation {
    const result = executeCommand(this.presentation, command);
    this.presentation = result.presentation;
    this.undoStack.push(result.executed);
    this.redoStack = [];
    return this.getSnapshot();
  }

  executeMany(commands: PresentationCommand[]): Presentation {
    let stagedPresentation = this.presentation;
    const stagedExecutions: ExecutedCommand[] = [];

    for (const command of commands) {
      const result = executeCommand(stagedPresentation, command);
      stagedPresentation = result.presentation;
      stagedExecutions.push(result.executed);
    }

    this.presentation = stagedPresentation;
    this.undoStack.push(...stagedExecutions);
    this.redoStack = [];
    return this.getSnapshot();
  }

  undo(): Presentation {
    const executed = this.undoStack.pop();
    if (!executed) return this.getSnapshot();
    const result = executeCommand(this.presentation, executed.inverse);
    this.presentation = result.presentation;
    this.redoStack.push(executed);
    return this.getSnapshot();
  }

  redo(): Presentation {
    const executed = this.redoStack.pop();
    if (!executed) return this.getSnapshot();
    const result = executeCommand(this.presentation, executed.command);
    this.presentation = result.presentation;
    this.undoStack.push(result.executed);
    return this.getSnapshot();
  }
}
