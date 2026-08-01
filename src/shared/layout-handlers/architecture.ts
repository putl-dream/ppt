import type { LayoutGrammarContext, LayoutGrammarHandler } from "../layout-grammar";
import { layoutGrammarRegistry } from "../layout-grammar";
import { LAYOUT_GRAMMAR_VARIANTS } from "../layout-grammar-variants";
import { CONTENT, layoutSpacing, styleText } from "./utils";

function applyLayers(ctx: LayoutGrammarContext): void {
  const layers = ctx.bodyTexts;
  const count = Math.max(layers.length, 1);
  const spacing = layoutSpacing(ctx);
  const layerGap = Math.max(8, spacing.gutter - 12);
  const layerH = (CONTENT.height - (count - 1) * layerGap) / count;
  const accentW = 6;

  layers.forEach((element, index) => {
    const rowY = CONTENT.y + index * (layerH + layerGap);
    ctx.elements.unshift(ctx.helpers.createCard(CONTENT.x, rowY, CONTENT.width, layerH));
    ctx.elements.push(ctx.helpers.createAccentBlock(
      CONTENT.x + spacing.compactPadding,
      rowY + spacing.compactPadding,
      accentW,
      layerH - spacing.compactPadding * 2,
      { opacity: 1, radius: ctx.style.shape.radius },
    ));
    ctx.elements.push(styleText(ctx, element, {
      x: CONTENT.x + spacing.compactPadding + accentW + 16,
      y: rowY + 10,
      width: CONTENT.width - spacing.compactPadding * 2 - accentW - 16,
      height: layerH - 20,
      role: "kicker",
      baseSize: 22,
      bold: true,
      color: ctx.colors.title,
      align: "center",
    }));
  });
}

export const architectureGrammarHandler: LayoutGrammarHandler = {
  id: "architecture",
  supportedVariants: LAYOUT_GRAMMAR_VARIANTS.architecture,
  defaultVariant: "layers",
  contentSlots: ["layer"],
  visualSlots: ["accent"],
  apply(ctx) {
    applyLayers(ctx);
    return "layers";
  },
};

layoutGrammarRegistry.register(architectureGrammarHandler);
