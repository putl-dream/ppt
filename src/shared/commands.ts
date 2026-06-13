import { z } from "zod";
import type { Presentation, Slide } from "./presentation";
import { slideSchema, slideElementSchema } from "./presentation";

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
