import { readFile, stat } from "node:fs/promises";
import JSZip from "jszip";

import type { Presentation } from "@shared/presentation";

export interface PptxSlidePostflight {
  slideNumber: number;
  textRuns: number;
  shapes: number;
  pictures: number;
  graphicFrames: number;
  editableObjects: number;
  expectedChartPrimitives: number;
  titlePresent: boolean;
}

export interface PptxPostflightReport {
  passed: boolean;
  fileSizeBytes: number;
  slideCount: number;
  mediaCount: number;
  chartPartCount: number;
  totals: {
    textRuns: number;
    shapes: number;
    pictures: number;
    graphicFrames: number;
    editableObjects: number;
  };
  slides: PptxSlidePostflight[];
  errors: string[];
  warnings: string[];
}

function xmlText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function countMatches(value: string, expression: RegExp): number {
  return value.match(expression)?.length ?? 0;
}

function slideNumberFromPath(path: string): number {
  return Number(path.match(/slide(\d+)\.xml$/)?.[1] ?? 0);
}

export async function inspectPptxExport(
  filePath: string,
  presentation: Presentation,
): Promise<PptxPostflightReport> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const info = await stat(filePath);
  const buffer = await readFile(filePath);
  if (buffer.subarray(0, 4).toString("hex") !== "504b0304") {
    throw new Error("PPTX postflight failed: file is not a ZIP-based Office document.");
  }

  const archive = await JSZip.loadAsync(buffer);
  for (const requiredPart of ["[Content_Types].xml", "ppt/presentation.xml"]) {
    if (!archive.file(requiredPart)) {
      errors.push(`Missing required PPTX part: ${requiredPart}`);
    }
  }
  const slidePaths = Object.keys(archive.files)
    .filter((path) => /^ppt\/slides\/slide\d+\.xml$/.test(path))
    .sort((left, right) => slideNumberFromPath(left) - slideNumberFromPath(right));
  if (slidePaths.length !== presentation.slides.length) {
    errors.push(
      `Slide part count ${slidePaths.length} does not match Presentation count ${presentation.slides.length}.`,
    );
  }

  const slides: PptxSlidePostflight[] = [];
  for (const [index, path] of slidePaths.entries()) {
    const xml = await archive.file(path)!.async("string");
    const textRuns = countMatches(xml, /<a:t(?:\s[^>]*)?>/g);
    const shapes = countMatches(xml, /<p:sp>/g);
    const pictures = countMatches(xml, /<p:pic>/g);
    const graphicFrames = countMatches(xml, /<p:graphicFrame>/g);
    const editableObjects = textRuns + shapes + pictures + graphicFrames;
    const expectedSlide = presentation.slides[index];
    const expectedChartPrimitives = expectedSlide?.elements
      .filter((element) => element.type === "chart")
      .reduce((sum, element) =>
        sum + (element.data.items?.length ?? element.data.labels?.length ?? 0), 0
      ) ?? 0;
    const titlePresent = expectedSlide
      ? xml.includes(xmlText(expectedSlide.title))
      : false;

    if (editableObjects === 0) {
      errors.push(`Slide ${index + 1} contains no editable native objects.`);
    }
    if (expectedSlide && !titlePresent) {
      errors.push(`Slide ${index + 1} is missing its title text after export.`);
    }
    if (expectedChartPrimitives > 0 && shapes < expectedChartPrimitives) {
      errors.push(
        `Slide ${index + 1} exported ${shapes} shape(s), fewer than the ${expectedChartPrimitives} required chart primitives.`,
      );
    }
    slides.push({
      slideNumber: index + 1,
      textRuns,
      shapes,
      pictures,
      graphicFrames,
      editableObjects,
      expectedChartPrimitives,
      titlePresent,
    });
  }

  const mediaCount = Object.keys(archive.files)
    .filter((path) => /^ppt\/media\/[^/]+$/.test(path)).length;
  const expectedImages = presentation.slides.flatMap((slide) => slide.elements)
    .filter((element) => element.type === "image").length;
  if (expectedImages > 0 && mediaCount === 0) {
    errors.push("Presentation contains image elements but the PPTX has no media parts.");
  }
  if (expectedImages === 0 && mediaCount === 0) {
    warnings.push("The deck intentionally uses native typography, shapes and data visuals without raster media.");
  }
  const chartPartCount = Object.keys(archive.files)
    .filter((path) => /^ppt\/charts\/chart\d+\.xml$/.test(path)).length;
  const totals = slides.reduce(
    (sum, slide) => ({
      textRuns: sum.textRuns + slide.textRuns,
      shapes: sum.shapes + slide.shapes,
      pictures: sum.pictures + slide.pictures,
      graphicFrames: sum.graphicFrames + slide.graphicFrames,
      editableObjects: sum.editableObjects + slide.editableObjects,
    }),
    { textRuns: 0, shapes: 0, pictures: 0, graphicFrames: 0, editableObjects: 0 },
  );

  return {
    passed: errors.length === 0,
    fileSizeBytes: info.size,
    slideCount: slidePaths.length,
    mediaCount,
    chartPartCount,
    totals,
    slides,
    errors,
    warnings,
  };
}
