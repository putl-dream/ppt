import pptxgen from "pptxgenjs";
import type { Presentation } from "@shared/presentation";
import type { ExportPresentationOptions } from "@shared/ipc";

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

export async function exportToPptx(
  presentation: Presentation,
  options: ExportPresentationOptions,
  filePath: string,
): Promise<void> {
  const pptx = new pptxgen();

  // Determine theme styling properties (matching PPTMirror.tsx)
  let slideBg = "#ffffff";
  let titleColor = "#1e293b";
  let bodyColor = "#475569";
  let fontFace = "Arial";

  const presentationTheme = (presentation as any).theme || options.theme || "nordic";
  const presentationPalette = (presentation as any).palette || options.palette || "cyan";

  switch (presentationTheme) {
    case "nordic":
      slideBg = "#fbfbfa";
      titleColor = "#0f172a";
      bodyColor = "#334155";
      fontFace = "Georgia";
      break;
    case "midnight":
      slideBg = "#0e1115";
      titleColor = "#f8fafc";
      bodyColor = "#94a3b8";
      fontFace = "Courier New";
      break;
    case "ocean":
      slideBg = "#0f172a"; // Solid fallback for gradient
      titleColor = "#f8fafc";
      bodyColor = "#cbd5e1";
      fontFace = "Arial";
      break;
    case "sunset":
      slideBg = "#fffcf4"; // Solid fallback for gradient
      titleColor = "#3c2a21";
      bodyColor = "#776b5d";
      fontFace = "Georgia";
      break;
    case "purple":
      slideBg = "#1c1537"; // Solid fallback for gradient
      titleColor = "#f8fafc";
      bodyColor = "#b4befe";
      fontFace = "Arial";
      break;
  }

  let accentColor = "#0ea5e9";
  switch (presentationPalette) {
    case "cyan":
      accentColor = "#0ea5e9";
      break;
    case "green":
      accentColor = "#10b981";
      break;
    case "purple":
      accentColor = "#a855f7";
      break;
    case "orange":
      accentColor = "#f97316";
      break;
  }

  const cleanBg = cleanColor(slideBg);
  const cleanTitleColor = cleanColor(titleColor);
  const cleanBodyColor = cleanColor(bodyColor);
  const cleanAccentColor = cleanColor(accentColor);

  // Canvas is 1280x720 px; PPT slide is 10x5.625 in → divide by 128.
  const px = (value: number) => value / 128;

  for (let i = 0; i < presentation.slides.length; i++) {
    const slideData = presentation.slides[i];
    const slide = pptx.addSlide();
    const showChromeHeader =
      slideData.layout !== "cover" && slideData.layout !== "section";

    // Set background
    slide.background = { fill: cleanBg };

    // 1. Logo (if any)
    if (options.logoUrl) {
      const isData = options.logoUrl.startsWith("data:");
      const cleanLogoPath = options.logoUrl.startsWith("file:///")
        ? options.logoUrl.substring(8)
        : options.logoUrl.startsWith("file://")
        ? options.logoUrl.substring(7)
        : options.logoUrl;

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
        fontSize: 36,
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
        slide.addText(element.text, {
          x,
          y,
          w,
          h,
          fontSize: element.fontSize * 0.75,
          color: element.color ? cleanColor(element.color) : cleanBodyColor,
          fontFace,
          bold: !!element.bold,
          align: element.align || "left",
          valign: "middle",
        });
      } else if (element.type === "image") {
        try {
          if (element.url.startsWith("data:")) {
            slide.addImage({
              data: element.url,
              x,
              y,
              w,
              h,
            });
          } else {
            const cleanImgPath = element.url.startsWith("file:///")
              ? element.url.substring(8)
              : element.url.startsWith("file://")
              ? element.url.substring(7)
              : element.url;
            slide.addImage({
              path: cleanImgPath,
              x,
              y,
              w,
              h,
            });
          }
        } catch (e) {
          console.error("Failed to add slide element image:", e);
        }
      } else if (element.type === "shape") {
        let shapeType = (pptx as any).shapes.RECTANGLE;
        if (element.shapeType === "circle") {
          shapeType = (pptx as any).shapes.OVAL;
        } else if (element.shapeType === "arrow") {
          shapeType = (pptx as any).shapes.RIGHT_ARROW;
        } else if (element.shapeType === "line") {
          shapeType = (pptx as any).shapes.LINE;
        }

        const cleanFill = cleanColor(element.fillColor);
        const cleanStroke = cleanColor(element.strokeColor);

        slide.addShape(shapeType, {
          x,
          y,
          w,
          h,
          fill: { color: cleanFill },
          line: { color: cleanStroke, width: 2 },
        });
      }
    }
  }

  await pptx.writeFile({ fileName: filePath });
}
