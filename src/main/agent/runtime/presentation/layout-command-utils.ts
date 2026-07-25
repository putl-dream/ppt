import type { PresentationCommand } from "@shared/commands";
import { executeCommand } from "@shared/commands";
import type { Presentation } from "@shared/presentation";

/** Commands that materially change resolved slide visuals. */
export const LAYOUT_VISUAL_COMMAND_TYPES = new Set<PresentationCommand["type"]>([
  "add-slide",
  "set-design-system",
  "set-slide-design",
  "update-slide-layout",
  "update-slide-variant",
  "update-text-style",
  "restore-slide",
]);

export function hasLayoutVisualCommands(commands: PresentationCommand[]): boolean {
  return commands.some((command) => LAYOUT_VISUAL_COMMAND_TYPES.has(command.type));
}

export function applyCommandsToDraft(
  presentation: Presentation,
  commands: PresentationCommand[],
): Presentation {
  let draft = structuredClone(presentation);
  for (const command of commands) {
    draft = executeCommand(draft, command).presentation;
  }
  return draft;
}

/** Slide IDs touched by layout/visual commands; deck design changes affect every slide. */
export function collectAffectedSlideIds(
  commands: PresentationCommand[],
  draft: Presentation,
): string[] {
  const ids = new Set<string>();
  let designSystemChanged = false;

  for (const command of commands) {
    if (command.type === "set-design-system") {
      designSystemChanged = true;
    }
    if (command.type === "add-slide") {
      ids.add(command.slide.id);
    } else if (
      command.type !== "remove-slide"
      && "slideId" in command
      && typeof command.slideId === "string"
    ) {
      ids.add(command.slideId);
    }
    if (command.type === "restore-slide") {
      ids.add(command.slide.id);
    }
  }

  if (designSystemChanged) {
    for (const slide of draft.slides) ids.add(slide.id);
  }

  if (ids.size === 0 && hasLayoutVisualCommands(commands)) {
    return draft.slides.map((slide) => slide.id);
  }

  const existingIds = new Set(draft.slides.map((slide) => slide.id));
  return [...ids].filter((id) => existingIds.has(id));
}
