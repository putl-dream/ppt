import { layoutRegistry } from "./layout-registry";
import { SLIDE_LAYOUTS } from "./slide-layouts";

/** Register built-in layout metadata. Handlers remain in layout.ts until fully extracted. */
export function registerBuiltinLayouts(): void {
  const definitions: Array<{
    id: (typeof SLIDE_LAYOUTS)[number];
    label: string;
    defaultBackgroundVariant: "default" | "hero" | "muted";
    defaultSlideVariant?: "light" | "dark" | "hero";
    isChrome: boolean;
  }> = [
    { id: "cover", label: "Cover", defaultBackgroundVariant: "hero", defaultSlideVariant: "hero", isChrome: true },
    { id: "section", label: "Section", defaultBackgroundVariant: "hero", defaultSlideVariant: "hero", isChrome: true },
    { id: "concept", label: "Concept", defaultBackgroundVariant: "default", isChrome: false },
    { id: "comparison", label: "Comparison", defaultBackgroundVariant: "default", isChrome: false },
    { id: "process", label: "Process", defaultBackgroundVariant: "default", isChrome: false },
    { id: "architecture", label: "Architecture", defaultBackgroundVariant: "default", isChrome: false },
    { id: "case", label: "Case Study", defaultBackgroundVariant: "default", isChrome: false },
    { id: "summary", label: "Summary", defaultBackgroundVariant: "default", isChrome: false },
    { id: "toc", label: "Table of Contents", defaultBackgroundVariant: "default", isChrome: false },
    { id: "quote", label: "Quote", defaultBackgroundVariant: "muted", defaultSlideVariant: "light", isChrome: false },
    { id: "image-grid", label: "Image Grid", defaultBackgroundVariant: "default", isChrome: false },
  ];

  for (const def of definitions) {
    if (layoutRegistry.has(def.id)) continue;
    layoutRegistry.register({
      ...def,
      apply: () => {
        throw new Error(
          `Layout handler for "${def.id}" is applied via applyLayout() in layout.ts`,
        );
      },
    });
  }
}

registerBuiltinLayouts();

export { layoutRegistry };
