import type { LayoutGrammarContext, LayoutGrammarHandler } from "../layout-grammar";
import { layoutGrammarRegistry } from "../layout-grammar";
import { LAYOUT_GRAMMAR_VARIANTS } from "../layout-grammar-variants";
import { CONTENT, styleText } from "./utils";

type QuoteVariant = "centered-card" | "editorial-pullquote" | "quote-band";

function resolveVariant(ctx: LayoutGrammarContext): QuoteVariant {
  if (LAYOUT_GRAMMAR_VARIANTS.quote.includes(ctx.grammarVariant as QuoteVariant)) {
    return ctx.grammarVariant as QuoteVariant;
  }
  if (ctx.style.tokens.fontMood === "editorial") return "editorial-pullquote";
  if (ctx.style.tokens.backgroundStyle === "dark") return "quote-band";
  return "centered-card";
}

function joinedQuote(ctx: LayoutGrammarContext): { quote?: typeof ctx.bodyTexts[number]; attribution?: typeof ctx.bodyTexts[number] } {
  const quote = ctx.bodyTexts[0];
  const attribution = ctx.bodyTexts.length > 1 ? ctx.bodyTexts.at(-1) : undefined;
  if (quote && ctx.bodyTexts.length > 2) {
    quote.text = [quote.text, ...ctx.bodyTexts.slice(1, -1).map((item) => item.text)].join("\n");
  }
  return { quote, attribution };
}

function applyQuote(ctx: LayoutGrammarContext, variant: QuoteVariant): void {
  const { quote, attribution } = joinedQuote(ctx);
  if (!quote) return;
  if (variant === "quote-band") {
    ctx.elements.push(ctx.helpers.createCard(CONTENT.x, CONTENT.y + 92, CONTENT.width, 264));
    ctx.elements.push(ctx.helpers.createAccentBlock(CONTENT.x, CONTENT.y + 92, 16, 264, { opacity: 1 }));
    ctx.elements.push(styleText(ctx, quote, {
      x: 178, y: CONTENT.y + 124, width: 920, height: 176,
      role: "kicker", baseSize: 34, align: "left",
    }));
  } else if (variant === "editorial-pullquote") {
    ctx.elements.push(ctx.helpers.createCard(220, CONTENT.y, 840, CONTENT.height));
    ctx.elements.push(ctx.helpers.createAccentBlock(244, CONTENT.y + 28, 92, 12, { opacity: 1 }));
    ctx.elements.push(styleText(ctx, quote, {
      x: 276, y: CONTENT.y + 70, width: 728, height: 260,
      role: "kicker", baseSize: 38, align: "left",
    }));
  } else {
    ctx.elements.push(ctx.helpers.createCard(140, CONTENT.y + 20, 1000, CONTENT.height - 40));
    ctx.elements.push(ctx.helpers.createAccentBlock(160, CONTENT.y + 36, 80, 80, { opacity: 0.1 }));
    ctx.elements.push(styleText(ctx, quote, {
      x: 180, y: CONTENT.y + 56, width: 920, height: CONTENT.height - 160,
      role: "kicker", baseSize: 36, align: "center",
    }));
  }
  if (attribution) {
    ctx.elements.push(styleText(ctx, attribution, {
      x: 220, y: CONTENT.y + CONTENT.height - 72, width: 840, height: 40,
      role: "caption", baseSize: 17,
      align: variant === "editorial-pullquote" ? "right" : "center",
    }));
  }
}

export const quoteGrammarHandler: LayoutGrammarHandler = {
  id: "quote",
  supportedVariants: LAYOUT_GRAMMAR_VARIANTS.quote,
  defaultVariant: "centered-card",
  contentSlots: ["quote", "attribution"],
  visualSlots: ["quote-mark", "band"],
  apply(ctx) {
    const variant = resolveVariant(ctx);
    applyQuote(ctx, variant);
    return variant;
  },
};

layoutGrammarRegistry.register(quoteGrammarHandler);
