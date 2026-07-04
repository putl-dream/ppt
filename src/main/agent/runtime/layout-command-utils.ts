import type { PresentationCommand } from "@shared/commands";
import { executeCommand } from "@shared/commands";
import type { Presentation } from "@shared/presentation";

/** Commands that materially change slide visuals (theme, layout, typography). */
export const LAYOUT_VISUAL_COMMAND_TYPES = new Set<PresentationCommand["type"]>([
  "set-theme",
  "update-slide-layout",
  "update-slide-variant",
  "set-slide-background",
  "update-text-style",
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

/** Slide IDs touched by layout/visual commands; falls back to all slides after set-theme. */
export function collectAffectedSlideIds(
  commands: PresentationCommand[],
  draft: Presentation,
): string[] {
  const ids = new Set<string>();
  let themeChanged = false;

  for (const command of commands) {
    if (command.type === "set-theme") {
      themeChanged = true;
    }
    if ("slideId" in command && typeof command.slideId === "string") {
      ids.add(command.slideId);
    }
  }

  if (themeChanged && ids.size === 0) {
    return draft.slides.map((slide) => slide.id);
  }

  if (ids.size === 0 && hasLayoutVisualCommands(commands)) {
    return draft.slides.map((slide) => slide.id);
  }

  return [...ids];
}
