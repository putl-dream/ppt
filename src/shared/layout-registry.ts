import type { BackgroundVariant } from "./slide-background";
import type { SlideLayoutType } from "./slide-layouts";
import type { SlideVariant } from "./slide-variant";
import type { Slide, SlideElement } from "./presentation";

export interface LayoutContext {
  slide: Slide;
  theme: string;
  palette: string;
  colors: {
    bg: string;
    title: string;
    body: string;
    accent: string;
    cardBg: string;
    cardStroke: string;
  };
  textElements: import("./presentation").TextElement[];
  imageElements: import("./presentation").ImageElement[];
  userShapes: import("./presentation").ShapeElement[];
  titleEl?: import("./presentation").TextElement;
  bodyTexts: import("./presentation").TextElement[];
  elements: SlideElement[];
  placedImageIds: Set<string>;
  theme_: string;
  helpers: LayoutHelpers;
}

export interface LayoutHelpers {
  createCard: (x: number, y: number, w: number, h: number) => import("./presentation").ShapeElement;
  createAccentBlock: (
    x: number,
    y: number,
    w: number,
    h: number,
    opts?: { opacity?: number; radius?: number },
  ) => import("./presentation").ShapeElement;
  createAccentBar: (x: number, y: number, w: number) => import("./presentation").ShapeElement;
  createProcessArrow: (x: number, y: number, w: number, h: number) => import("./presentation").ShapeElement;
  assignTextRole: (
    el: import("./presentation").TextElement,
    role: import("./typography").TextRole,
  ) => import("./presentation").TextElement;
  placeImageInSlot: (
    image: import("./presentation").ImageElement,
    rect: { x: number; y: number; width: number; height: number },
    slotName: string,
  ) => import("./presentation").ImageElement;
  pickImageForSlot: (slotName: string, fallbackUnslottedOnly?: boolean) => import("./presentation").ImageElement | undefined;
}

export type LayoutHandler = (ctx: LayoutContext) => void;

export interface LayoutDefinition {
  id: SlideLayoutType;
  label: string;
  defaultBackgroundVariant: BackgroundVariant;
  defaultSlideVariant?: SlideVariant;
  isChrome: boolean;
  apply: LayoutHandler;
}

class LayoutRegistryImpl {
  private layouts = new Map<string, LayoutDefinition>();

  register(definition: LayoutDefinition): void {
    this.layouts.set(definition.id, definition);
  }

  get(id: string): LayoutDefinition | undefined {
    return this.layouts.get(id);
  }

  getOrThrow(id: string): LayoutDefinition {
    const def = this.layouts.get(id);
    if (!def) throw new Error(`Unknown layout: ${id}`);
    return def;
  }

  has(id: string): boolean {
    return this.layouts.has(id);
  }

  getAll(): LayoutDefinition[] {
    return [...this.layouts.values()];
  }

  get ids(): SlideLayoutType[] {
    return [...this.layouts.keys()] as SlideLayoutType[];
  }
}

export const layoutRegistry = new LayoutRegistryImpl();
