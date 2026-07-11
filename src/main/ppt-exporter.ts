import pptxgen from "pptxgenjs";
import { fileURLToPath } from "node:url";
import type { Presentation } from "@shared/presentation";
import type { ExportPresentationOptions } from "@shared/ipc";
import { fontFamilyToPptxFace, resolveElementFontFamily } from "@shared/typography";
import { resolveChromeTitleFontSize, resolveImageTreatment, resolveSlideStyle } from "@design-system";
import { chartDataToSvgString, chartSvgToDataUri } from "@shared/chart-utils";
import { renderGradientToPng } from "@shared/gradient-export";
import { iconToSvgString, iconSvgToDataUri } from "@shared/icon-registry";

// Helper to clean colors (e.g. #ffffff -> ffffff)
function cleanColor(colorStr: string): string {
  if (!colorStr) return "000000";
  let clean = colorStr.trim();
  if (clean.startsWith("#")) {
    clean = clean.substring(1);
  }
  if (clean.length === 3) {
    clean = clean[0] + clean[0] + clean[1] + clean[1] + clean[2] + clean[2];
  }
  return clean;
}

function resolveLocalImagePath(value: string): string {
  return value.startsWith("file://") ? fileURLToPath(value) : value;
}

export async function exportToPptx(
  presentation: Presentation,
  options: ExportPresentationOptions,
  filePath: string,
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
      const isData = options.logoUrl.startsWith("data:");
      const cleanLogoPath = resolveLocalImagePath(options.logoUrl);

      try {
        if (isData) {
          slide.addImage({
            data: options.logoUrl,
            x: 8.8,
            y: 0.31,
            w: 0.78,
            h: 0.25,
          });
        } else {
          slide.addImage({
            path: cleanLogoPath,
            x: 8.8,
            y: 0.31,
            w: 0.78,
            h: 0.25,
          });
        }
      } catch (e) {
        console.error("Failed to add logo to PPTX:", e);
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
          const sizing = {
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
            const cleanImgPath = resolveLocalImagePath(element.url);
            slide.addImage({
              path: cleanImgPath,
              ...imageOptions,
            });
          }
        } catch (e) {
          console.error("Failed to add slide element image:", e);
        }
      } else if (element.type === "shape") {
        const cleanFill = cleanColor(element.fillColor);
        const cleanStroke = cleanColor(element.strokeColor);
        const fillTransparency =
          element.fillOpacity != null ? (1 - element.fillOpacity) * 100 : 0;

        if (element.shapeType === "line") {
          slide.addShape((pptx as any).shapes.LINE, {
            x,
            y: y + h / 2,
            w,
            h: 0,
            line: { color: cleanStroke, width: Math.max(1, h * 0.75) },
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
            line: { color: cleanStroke, width: 2 },
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
          const svg = chartDataToSvgString(
            element,
            colors.accent,
            style.chart.style,
            colors.body,
          );
          slide.addImage({
            data: chartSvgToDataUri(svg),
            x,
            y,
            w,
            h,
          });
        } catch (e) {
          console.error("Failed to add chart element:", e);
        }
      } else if (element.type === "table") {
        try {
          const tableRows = element.rows.map((row) =>
            row.map((cell) => ({
              text: cell,
              options: {
                fontFace,
                fontSize: 12,
                color: cleanBodyColor,
                fill: { color: cleanColor(colors.cardBg) },
              },
            })),
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
          console.error("Failed to add table element:", e);
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
          console.error("Failed to add icon element:", e);
        }
      }
    }
  }

  await pptx.writeFile({ fileName: filePath });
}
