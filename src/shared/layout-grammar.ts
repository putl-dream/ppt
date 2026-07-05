import type { DesignTokensV1 } from "./design-tokens";
import type { LayoutContext } from "./layout-registry";
import type { SlideLayoutType } from "./slide-layouts";

export interface LayoutGrammarContext extends LayoutContext {
  designTokens: DesignTokensV1;
  grammarVariant?: string;
  hasExplicitDesignTokens: boolean;
}

export interface LayoutGrammarHandler {
  id: SlideLayoutType;
  supportedVariants: readonly string[];
  defaultVariant: string;
  contentSlots: readonly string[];
  visualSlots: readonly string[];
  apply: (ctx: LayoutGrammarContext) => void;
}

class LayoutGrammarRegistry {
  private handlers = new Map<string, LayoutGrammarHandler>();

  register(handler: LayoutGrammarHandler): void {
    this.handlers.set(handler.id, handler);
  }

  get(id: string): LayoutGrammarHandler | undefined {
    return this.handlers.get(id);
  }

  has(id: string): boolean {
    return this.handlers.has(id);
  }

  getAll(): LayoutGrammarHandler[] {
    return [...this.handlers.values()];
  }
}

export const layoutGrammarRegistry = new LayoutGrammarRegistry();
