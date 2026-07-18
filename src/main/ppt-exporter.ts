import pptxgen from "pptxgenjs";
import type { Presentation } from "@shared/presentation";
import type { ExportPresentationOptions } from "@shared/ipc";
import { fontFamilyToPptxFace, resolveElementFontFamily } from "@shared/typography";
import { resolveChromeTitleFontSize, resolveImageTreatment, resolveSlideStyle } from "@design-system";
import { renderGradientToPng } from "@shared/gradient-export";
import { iconToSvgString, iconSvgToDataUri } from "@shared/icon-registry";
import { createModuleLogger } from "./agent/logger";
import {
  assertSupportedLocalImageFile,
  resolveLocalImagePath,
} from "./local-image-file";

const logger = createModuleLogger("ppt-exporter");

// Helper to clean colors (e.g. #ffffff -> ffffff)
function cleanColor(colorStr: string): string {
  if (!/^#[0-9a-f]{6}$/i.test(colorStr)) {
    throw new Error(`Invalid hex color '${colorStr}'.`);
  }
  let clean = colorStr.trim();
  if (clean.startsWith("#")) {
    clean = clean.substring(1);
  }
  if (clean.length === 3) {
    clean = clean[0] + clean[0] + clean[1] + clean[1] + clean[2] + clean[2];
  }
  return clean;
}

function exportFailure(
  kind: string,
  slideIndex: number,
  elementId: string | undefined,
  error: unknown,
): Error {
  const reason = error instanceof Error ? error.message : String(error);
  return new Error(
    `Unable to export ${kind} on slide ${slideIndex + 1}${elementId ? ` (element '${elementId}')` : ""}: ${reason}`,
    { cause: error },
  );
}

export async function exportToPptx(
  presentation: Presentation,
  options: ExportPresentationOptions,
  filePath: string,
  workspaceRoot?: string,
): Promise<void> {
  const pptx = new pptxgen();

  // Canvas is 1280x720 px; PPT slide is 10x5.625 in → divide by 128.
  const px = (value: number) => value / 128;

  for (let i = 0; i < presentation.slides.length; i++) {
    const slideData = presentation.slides[i];
    const slide = pptx.addSlide();
    const style = resolveSlideStyle(presentation.designSystem, slideData);
    const { colors } = style;
    const fontFace = style.typography.pptxFace;
    const cleanTitleColor = cleanColor(colors.title);
    const cleanBodyColor = cleanColor(colors.body);
    const cleanAccentColor = cleanColor(colors.accent);
    const showChromeHeader =
      slideData.layout !== "cover" && slideData.layout !== "section";

    const slideBackground = style.background;

    if (slideBackground.gradient) {
      const bgPng = renderGradientToPng(slideBackground.gradient);
      slide.background = { data: bgPng };
    } else {
      slide.background = { fill: cleanColor(slideBackground.fill) };
    }

    if (slideBackground.pattern?.type === "grid") {
      const gridSize = slideBackground.pattern.size;
      const gridColor = cleanColor(slideBackground.pattern.color);
      for (let x = gridSize; x < 1280; x += gridSize) {
        slide.addShape((pptx as any).shapes.LINE, {
          x: px(x), y: 0, w: 0, h: px(720),
          line: { color: gridColor, width: 0.35, transparency: 45 },
        });
      }
      for (let y = gridSize; y < 720; y += gridSize) {
        slide.addShape((pptx as any).shapes.LINE, {
          x: 0, y: px(y), w: px(1280), h: 0,
          line: { color: gridColor, width: 0.35, transparency: 45 },
        });
      }
    }

    // 1. Logo (if any)
    if (options.logoUrl) {
      try {
        slide.addImage({
          data: options.logoUrl,
          x: 8.8,
          y: 0.31,
          w: 0.78,
          h: 0.25,
        });
      } catch (e) {
        logger.error("logo.add.failed", { slideIndex: i, error: e });
        throw exportFailure("logo", i, undefined, e);
      }
    }

    // 2. Slide Number
    slide.addText((i + 1).toString(), {
      x: px(1160),
      y: px(650),
      w: px(80),
      h: px(40),
      fontSize: 11,
      color: cleanBodyColor,
      fontFace,
      align: "right",
    });

    // 3. Chrome header (matches PPTMirror .slide-header-text — not used on cover/section)
    if (showChromeHeader) {
      slide.addText(slideData.title, {
        x: px(120),
        y: px(50),
        w: px(1040),
        h: px(60),
        fontSize: resolveChromeTitleFontSize(slideData.title),
        color: cleanTitleColor,
        fontFace,
        bold: true,
        valign: "bottom",
      });

      slide.addShape((pptx as any).shapes.LINE, {
        x: px(120),
        y: px(112),
        w: px(1040),
        h: 0.01,
        line: { color: cleanAccentColor, width: 2 },
      });
    }

    // 4. Slide Elements (skip text that duplicates chrome title)
    const exportElements = showChromeHeader
      ? slideData.elements.filter(
          (element) =>
            element.type !== "text" ||
            element.text.trim() !== slideData.title.trim(),
        )
      : slideData.elements;

    for (const element of exportElements) {
      const x = px(element.x);
      const y = px(element.y);
      const w = px(element.width);
      const h = px(element.height);

      if (element.type === "text") {
        const elementFont = element.fontFamily ?? (
          element.textRole
            ? resolveElementFontFamily(element, style.typography.family)
            : style.typography.family
        );
        slide.addText(element.text, {
          x,
          y,
          w,
          h,
          fontSize: element.fontSize * 0.75,
          color: element.color ? cleanColor(element.color) : cleanBodyColor,
          fontFace: fontFamilyToPptxFace(elementFont),
          bold: !!element.bold,
          align: element.align || "left",
          valign: "middle",
        });
      } else if (element.type === "image") {
        try {
          const treatment = resolveImageTreatment(
            element.imageTreatment,
            style.image.treatment,
            element.borderRadius,
            colors,
          );
          if (treatment.treatment === "framed" || treatment.treatment === "captioned") {
            slide.addShape((pptx as any).shapes.ROUNDED_RECTANGLE, {
              x,
              y,
              w,
              h,
              fill: { color: cleanColor(treatment.backgroundColor) },
              line: { color: cleanColor(treatment.borderColor), width: 1 },
              shadow: {
                type: "outer",
                color: "0F172A",
                blur: 2,
                offset: 1,
                angle: 90,
                opacity: 0.12,
              },
            });
          }
          const inset = px(treatment.padding);
          const imageX = x + inset;
          const imageY = y + inset;
          const imageW = Math.max(0.01, w - inset * 2);
          const imageH = Math.max(0.01, h - inset * 2);
          const sizing = element.crop
            && element.asset?.pixelWidth
            && element.asset.pixelHeight
            ? {
                type: "crop" as const,
                x: (element.asset.pixelWidth * element.crop.x) / 96,
                y: (element.asset.pixelHeight * element.crop.y) / 96,
                w: (element.asset.pixelWidth * element.crop.width) / 96,
                h: (element.asset.pixelHeight * element.crop.height) / 96,
              }
            : {
                type: element.objectFit ?? "cover",
                w: imageW,
                h: imageH,
              } as const;
          const imageOptions = {
            x: imageX,
            y: imageY,
            w: imageW,
            h: imageH,
            sizing,
            ...(treatment.treatment === "masked" ? { rounding: true } : {}),
            ...(element.asset?.description ? { altText: element.asset.description } : {}),
          };
          if (element.url.startsWith("data:")) {
            slide.addImage({
              data: element.url,
              ...imageOptions,
            });
          } else {
            const cleanImgPath = resolveLocalImagePath(element.url, workspaceRoot);
            await assertSupportedLocalImageFile(cleanImgPath);
            slide.addImage({
              path: cleanImgPath,
              ...imageOptions,
            });
          }
        } catch (e) {
          logger.error("slide.image.add.failed", { slideIndex: i, error: e });
          throw exportFailure("image", i, element.id, e);
        }
      } else if (element.type === "shape") {
        const fillIsTransparent = element.fillColor === "transparent";
        const strokeIsTransparent = element.strokeColor === "transparent";
        const cleanFill = fillIsTransparent ? "000000" : cleanColor(element.fillColor);
        const cleanStroke = strokeIsTransparent ? "000000" : cleanColor(element.strokeColor);
        const fillTransparency =
          fillIsTransparent
            ? 100
            : element.fillOpacity != null ? (1 - element.fillOpacity) * 100 : 0;

        if (element.shapeType === "line") {
          slide.addShape((pptx as any).shapes.LINE, {
            x,
            y: y + h / 2,
            w,
            h: 0,
            line: {
              color: cleanStroke,
              width: Math.max(1, h * 0.75),
              ...(strokeIsTransparent ? { transparency: 100 } : {}),
            },
          });
        } else {
          let shapeType = (pptx as any).shapes.RECTANGLE;
          if (element.shapeType === "circle") {
            shapeType = (pptx as any).shapes.OVAL;
          } else if (element.shapeType === "arrow") {
            shapeType = (pptx as any).shapes.RIGHT_ARROW;
          } else if (element.shapeType === "roundedRect" || element.cornerRadius != null) {
            shapeType = (pptx as any).shapes.ROUNDED_RECTANGLE;
          }

          const shapeOpts: Record<string, unknown> = {
            x,
            y,
            w,
            h,
            fill: { color: cleanFill, transparency: fillTransparency },
            line: {
              color: cleanStroke,
              width: 2,
              ...(strokeIsTransparent ? { transparency: 100 } : {}),
            },
          };

          if (element.cornerRadius != null) {
            shapeOpts.rectRadius = px(element.cornerRadius);
          }

          if (element.shadow) {
            shapeOpts.shadow = {
              type: "outer",
              color: cleanColor(element.shadow.color),
              blur: element.shadow.blur,
              offset: element.shadow.offsetY,
              angle: 90,
              opacity: element.shadow.opacity,
            };
          }

          slide.addShape(shapeType, shapeOpts);
        }
      } else if (element.type === "chart") {
        try {
          const items = element.data.items ?? (
            element.data.labels ?? []
          ).map((label, index) => ({
            label,
            value: element.data.values?.[index] ?? 0,
          }));
          const maxValue = Math.max(1, ...items.map((item) => Math.abs(item.value)));
          if (element.chartType === "bar") {
            const gap = w * 0.03;
            const barW = Math.max(0.08, (w - gap * (items.length + 1)) / items.length);
            items.forEach((item, index) => {
              const barH = Math.max(0.04, h * 0.68 * (Math.abs(item.value) / maxValue));
              const barX = x + gap + index * (barW + gap);
              const barY = y + h * 0.76 - barH;
              slide.addShape((pptx as any).shapes.RECTANGLE, {
                x: barX, y: barY, w: barW, h: barH,
                fill: { color: cleanAccentColor },
                line: { color: cleanAccentColor, transparency: 100 },
              });
              slide.addText(`${item.value}`, {
                x: barX, y: Math.max(y, barY - 0.22), w: barW, h: 0.2,
                fontSize: 10, bold: true, align: "center",
                color: cleanBodyColor, fontFace,
              });
              slide.addText(item.label, {
                x: barX - gap / 2, y: y + h * 0.78, w: barW + gap, h: h * 0.2,
                fontSize: 9, align: "center", valign: "top",
                color: cleanBodyColor, fontFace,
              });
            });
          } else if (element.chartType === "h-bar") {
            const rowH = h / Math.max(1, items.length);
            items.forEach((item, index) => {
              const rowY = y + index * rowH;
              const barX = x + w * 0.28;
              const barW = Math.max(0.04, w * 0.62 * (Math.abs(item.value) / maxValue));
              slide.addText(item.label, {
                x, y: rowY, w: w * 0.25, h: rowH,
                fontSize: 9, valign: "middle", align: "right",
                color: cleanBodyColor, fontFace,
              });
              slide.addShape((pptx as any).shapes.ROUNDED_RECTANGLE, {
                x: barX, y: rowY + rowH * 0.24, w: barW, h: rowH * 0.52,
                fill: { color: cleanAccentColor },
                line: { color: cleanAccentColor, transparency: 100 },
              });
              slide.addText(`${item.value}`, {
                x: barX + barW + 0.04, y: rowY, w: w * 0.1, h: rowH,
                fontSize: 9, bold: true, valign: "middle",
                color: cleanBodyColor, fontFace,
              });
            });
          } else if (element.chartType === "timeline") {
            const lineY = y + h * 0.48;
            slide.addShape((pptx as any).shapes.LINE, {
              x: x + w * 0.08, y: lineY, w: w * 0.84, h: 0,
              line: { color: cleanAccentColor, width: 2 },
            });
            items.forEach((item, index) => {
              const pointX = x + w * (0.1 + (items.length === 1 ? 0.4 : index * 0.8 / (items.length - 1)));
              slide.addShape((pptx as any).shapes.OVAL, {
                x: pointX - 0.08, y: lineY - 0.08, w: 0.16, h: 0.16,
                fill: { color: cleanAccentColor },
                line: { color: cleanAccentColor },
              });
              slide.addText(item.label, {
                x: pointX - w * 0.08,
                y: index % 2 === 0 ? lineY - h * 0.34 : lineY + 0.12,
                w: w * 0.16,
                h: h * 0.25,
                fontSize: 9,
                bold: true,
                align: "center",
                valign: "middle",
                color: cleanBodyColor,
                fontFace,
              });
            });
          } else {
            const cardGap = w * 0.03;
            const cardW = (w - cardGap * (items.length - 1)) / Math.max(1, items.length);
            items.forEach((item, index) => {
              const cardX = x + index * (cardW + cardGap);
              slide.addShape((pptx as any).shapes.ROUNDED_RECTANGLE, {
                x: cardX, y, w: cardW, h,
                fill: { color: cleanColor(colors.cardBg) },
                line: { color: cleanColor(colors.cardStroke), width: 1 },
              });
              slide.addText(`${item.value}`, {
                x: cardX, y: y + h * 0.18, w: cardW, h: h * 0.34,
                fontSize: 24, bold: true, align: "center", valign: "middle",
                color: cleanAccentColor, fontFace,
              });
              slide.addText(item.label, {
                x: cardX + 0.05, y: y + h * 0.55, w: cardW - 0.1, h: h * 0.25,
                fontSize: 10, align: "center", valign: "middle",
                color: cleanBodyColor, fontFace,
              });
            });
          }
        } catch (e) {
          logger.error("slide.chart.add.failed", { slideIndex: i, error: e });
          throw exportFailure("chart", i, element.id, e);
        }
      } else if (element.type === "table") {
        try {
          const tableRows = element.rows.map((row, rowIndex) =>
            row.map((cell) => {
              const isHeader = Boolean(element.headerRow) && rowIndex === 0;
              const isStripe = Boolean(element.zebraStripe) && rowIndex % 2 === 1;
              const fillColor = isHeader
                ? colors.muted
                : isStripe ? colors.cardBg : colors.bg;
              return {
              text: cell,
              options: {
                fontFace,
                fontSize: 12,
                color: cleanBodyColor,
                fill: { color: cleanColor(fillColor) },
                bold: isHeader,
              },
              };
            }),
          );
          slide.addTable(tableRows, {
            x,
            y,
            w,
            h,
            border: { type: "solid", color: cleanColor(colors.cardStroke), pt: 1 },
            autoPage: false,
          });
        } catch (e) {
          logger.error("slide.table.add.failed", { slideIndex: i, error: e });
          throw exportFailure("table", i, element.id, e);
        }
      } else if (element.type === "icon") {
        try {
          const svg = iconToSvgString(
            element.name,
            element.color ?? colors.accent,
            element.strokeWidth ?? 2,
          );
          if (svg) {
            slide.addImage({
              data: iconSvgToDataUri(svg),
              x,
              y,
              w,
              h,
            });
          }
        } catch (e) {
          logger.error("slide.icon.add.failed", { slideIndex: i, error: e });
          throw exportFailure("icon", i, element.id, e);
        }
      }
    }
  }

  try {
    await pptx.writeFile({ fileName: filePath });
  } catch (error) {
    logger.error("pptx.write.failed", { filePath, error });
    throw new Error(
      `Unable to write PPTX export: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}
