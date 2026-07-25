import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { posix } from "node:path";
import JSZip from "jszip";

import type { Presentation } from "@shared/presentation";

const PPTX_SLIDE_WIDTH_EMU = 9_144_000;
const PPTX_SLIDE_HEIGHT_EMU = 5_143_500;
const SVG_PAGE_WIDTH_PX = 1_280;
const SVG_PAGE_HEIGHT_PX = 720;
const PNG_SIGNATURE_HEX = "89504e470d0a1a0a";

export interface PptxSlidePostflight {
  slideNumber: number;
  textRuns: number;
  shapes: number;
  pictures: number;
  graphicFrames: number;
  editableObjects: number;
  expectedChartPrimitives: number;
  expectedNativeCharts: number;
  titlePresent: boolean;
  svgSourcePresent: boolean;
}

export interface PptxPostflightReport {
  passed: boolean;
  fileSizeBytes: number;
  slideCount: number;
  mediaCount: number;
  chartPartCount: number;
  notesPartCount: number;
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

function parseXmlAttributes(fragment: string): Map<string, string> {
  const attributes = new Map<string, string>();
  for (const match of fragment.matchAll(
    /([A-Za-z_][A-Za-z0-9_.:-]*)\s*=\s*(["'])(.*?)\2/g,
  )) {
    attributes.set(
      match[1],
      match[3]
        .replaceAll("&amp;", "&")
        .replaceAll("&quot;", '"')
        .replaceAll("&apos;", "'")
        .replaceAll("&lt;", "<")
        .replaceAll("&gt;", ">"),
    );
  }
  return attributes;
}

function resolveRelationshipTarget(slidePath: string, target: string): string {
  const normalizedTarget = target.replace(/\\/g, "/");
  const packagePath = normalizedTarget.startsWith("/")
    ? normalizedTarget.slice(1)
    : posix.normalize(posix.join(posix.dirname(slidePath), normalizedTarget));
  try {
    return decodeURIComponent(packagePath);
  } catch {
    return packagePath;
  }
}

interface SlideRelationship {
  target: string;
  type?: string;
}

async function relationshipsForSlide(
  archive: JSZip,
  slidePath: string,
): Promise<Map<string, SlideRelationship>> {
  const relationshipPath = posix.join(
    posix.dirname(slidePath),
    "_rels",
    `${posix.basename(slidePath)}.rels`,
  );
  const relationshipFile = archive.file(relationshipPath);
  if (!relationshipFile) return new Map();
  const relationshipXml = await relationshipFile.async("string");
  const relationships = new Map<string, SlideRelationship>();
  for (const match of relationshipXml.matchAll(/<Relationship\b([^>]*)\/?>/gi)) {
    const attributes = parseXmlAttributes(match[1]);
    const id = attributes.get("Id");
    const target = attributes.get("Target");
    if (!id || !target || attributes.get("TargetMode") === "External") continue;
    relationships.set(id, {
      target: resolveRelationshipTarget(slidePath, target),
      type: attributes.get("Type"),
    });
  }
  return relationships;
}

function extractXmlElements(xml: string, qualifiedName: string): string[] {
  const escapedName = qualifiedName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return Array.from(
    xml.matchAll(new RegExp(
      `<${escapedName}\\b[^>]*>[\\s\\S]*?<\\/${escapedName}>`,
      "gi",
    )),
    (match) => match[0],
  );
}

function isNonFalseOpenXmlValue(value: string | undefined): boolean {
  return value !== undefined
    && value !== "0"
    && value.toLowerCase() !== "false";
}

function hasPngSignature(bytes: Uint8Array): boolean {
  return bytes.length >= 8
    && Buffer.from(bytes.subarray(0, 8)).toString("hex") === PNG_SIGNATURE_HEX;
}

function readUint32BigEndian(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] * 0x1000000)
    + (bytes[offset + 1] << 16)
    + (bytes[offset + 2] << 8)
    + bytes[offset + 3]
  ) >>> 0;
}

function readPngDimensions(bytes: Uint8Array): { width: number; height: number } | undefined {
  if (
    !hasPngSignature(bytes)
    || bytes.length < 24
    || Buffer.from(bytes.subarray(12, 16)).toString("ascii") !== "IHDR"
  ) {
    return undefined;
  }
  return {
    width: readUint32BigEndian(bytes, 16),
    height: readUint32BigEndian(bytes, 20),
  };
}

function inspectSvgPictureGeometry(
  pictureXml: string,
  slideNumber: number,
  errors: string[],
): void {
  const transform = pictureXml.match(
    /<p:spPr\b[^>]*>[\s\S]*?<a:xfrm\b([^>]*)>([\s\S]*?)<\/a:xfrm>[\s\S]*?<\/p:spPr>/i,
  );
  if (!transform) {
    errors.push(`Slide ${slideNumber} SVG picture is missing its p:spPr/a:xfrm geometry.`);
    return;
  }

  const transformAttributes = parseXmlAttributes(transform[1]);
  const rotationValue = transformAttributes.get("rot");
  if (
    rotationValue !== undefined
    && (!/^-?\d+$/.test(rotationValue) || Number(rotationValue) !== 0)
  ) {
    errors.push(`Slide ${slideNumber} SVG picture must not be rotated.`);
  }
  if (
    isNonFalseOpenXmlValue(transformAttributes.get("flipH"))
    || isNonFalseOpenXmlValue(transformAttributes.get("flipV"))
  ) {
    errors.push(`Slide ${slideNumber} SVG picture must not be flipped.`);
  }

  const offset = transform[2].match(/<a:off\b([^>]*)\/?>/i);
  const offsetAttributes = offset ? parseXmlAttributes(offset[1]) : new Map<string, string>();
  if (
    offsetAttributes.get("x") !== "0"
    || offsetAttributes.get("y") !== "0"
  ) {
    errors.push(
      `Slide ${slideNumber} SVG picture offset must be (0,0), found (${offsetAttributes.get("x") ?? "missing"},${offsetAttributes.get("y") ?? "missing"}).`,
    );
  }

  const extent = transform[2].match(/<a:ext\b([^>]*)\/?>/i);
  const extentAttributes = extent ? parseXmlAttributes(extent[1]) : new Map<string, string>();
  if (
    extentAttributes.get("cx") !== String(PPTX_SLIDE_WIDTH_EMU)
    || extentAttributes.get("cy") !== String(PPTX_SLIDE_HEIGHT_EMU)
  ) {
    errors.push(
      `Slide ${slideNumber} SVG picture extent must be ${PPTX_SLIDE_WIDTH_EMU}x${PPTX_SLIDE_HEIGHT_EMU}, found ${extentAttributes.get("cx") ?? "missing"}x${extentAttributes.get("cy") ?? "missing"}.`,
    );
  }

  if (/<a:srcRect\b/i.test(pictureXml)) {
    errors.push(`Slide ${slideNumber} SVG picture must not be cropped.`);
  }
}

async function inspectSvgFallbackPng(
  archive: JSZip,
  pictureXml: string,
  relationships: ReadonlyMap<string, SlideRelationship>,
  slideNumber: number,
  warnings: string[],
): Promise<void> {
  const fallbackBlip = pictureXml.match(/<a:blip\b([^>]*)>/i);
  const fallbackRelationshipId = fallbackBlip
    ? parseXmlAttributes(fallbackBlip[1]).get("r:embed")
    : undefined;
  const fallbackRelationship = fallbackRelationshipId
    ? relationships.get(fallbackRelationshipId)
    : undefined;
  if (!fallbackRelationship) {
    warnings.push(`Slide ${slideNumber} SVG picture has no internal PNG fallback relationship.`);
    return;
  }

  const fallbackFile = archive.file(fallbackRelationship.target);
  if (!fallbackFile) {
    warnings.push(
      `Slide ${slideNumber} SVG picture fallback media is missing: ${fallbackRelationship.target}.`,
    );
    return;
  }

  const bytes = await fallbackFile.async("uint8array");
  if (!hasPngSignature(bytes)) {
    warnings.push(
      `Slide ${slideNumber} SVG picture fallback media is not a valid PNG: ${fallbackRelationship.target} (signature ${Buffer.from(bytes.subarray(0, 8)).toString("hex") || "empty"}).`,
    );
    return;
  }

  const dimensions = readPngDimensions(bytes);
  if (
    !dimensions
    || dimensions.width !== SVG_PAGE_WIDTH_PX
    || dimensions.height !== SVG_PAGE_HEIGHT_PX
  ) {
    warnings.push(
      `Slide ${slideNumber} SVG picture has a valid PNG fallback, but it is not the canonical ${SVG_PAGE_WIDTH_PX}x${SVG_PAGE_HEIGHT_PX} page raster${dimensions ? ` (${dimensions.width}x${dimensions.height})` : ""}.`,
    );
  }
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
  const presentationFile = archive.file("ppt/presentation.xml");
  if (presentationFile) {
    const presentationXml = await presentationFile.async("string");
    const slideSize = presentationXml.match(/<p:sldSz\b([^>]*)\/?>/i);
    const slideSizeAttributes = slideSize
      ? parseXmlAttributes(slideSize[1])
      : new Map<string, string>();
    if (
      slideSizeAttributes.get("cx") !== String(PPTX_SLIDE_WIDTH_EMU)
      || slideSizeAttributes.get("cy") !== String(PPTX_SLIDE_HEIGHT_EMU)
    ) {
      errors.push(
        `Presentation slide size must be ${PPTX_SLIDE_WIDTH_EMU}x${PPTX_SLIDE_HEIGHT_EMU}, found ${slideSizeAttributes.get("cx") ?? "missing"}x${slideSizeAttributes.get("cy") ?? "missing"}.`,
      );
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
  const svgMediaPaths = Object.keys(archive.files)
    .filter((path) => /^ppt\/media\/[^/]+\.svg$/i.test(path));
  const svgMediaHashesByPath = new Map(await Promise.all(svgMediaPaths.map(async (path) => {
    const bytes = await archive.file(path)!.async("uint8array");
    return [path, createHash("sha256").update(bytes).digest("hex")] as const;
  })));

  const slides: PptxSlidePostflight[] = [];
  for (const [index, path] of slidePaths.entries()) {
    const xml = await archive.file(path)!.async("string");
    const relationships = await relationshipsForSlide(archive, path);
    const textRuns = countMatches(xml, /<a:t(?:\s[^>]*)?>/g);
    const shapes = countMatches(xml, /<p:sp(?:\s[^>]*)?>/g);
    const pictureElements = extractXmlElements(xml, "p:pic");
    const pictures = pictureElements.length;
    const graphicFrames = countMatches(xml, /<p:graphicFrame(?:\s[^>]*)?>/g);
    const editableObjects = textRuns + shapes + pictures + graphicFrames;
    const expectedSlide = presentation.slides[index];
    const expectedSvgSource = expectedSlide?.visualSource?.kind === "svg"
      ? expectedSlide.visualSource
      : undefined;
    const expectedChartPrimitives = expectedSvgSource
      ? 0
      : (
          expectedSlide?.elements.reduce((sum, element) => {
            if (
              element.type !== "chart"
              || element.chartType === "bar"
              || element.chartType === "h-bar"
            ) return sum;
            return sum
              + (element.data.items?.length ?? element.data.labels?.length ?? 0);
          }, 0) ?? 0
        );
    const expectedNativeCharts = expectedSvgSource
      ? 0
      : (
          expectedSlide?.elements.filter((element) =>
            element.type === "chart"
            && (element.chartType === "bar" || element.chartType === "h-bar")
          ).length ?? 0
        );

    let svgSourcePresent = false;
    if (expectedSvgSource) {
      if (pictures !== 1) {
        errors.push(
          `Slide ${index + 1} SVG page must contain exactly one p:pic; found ${pictures}.`,
        );
      }
      if (shapes > 0 || textRuns > 0 || graphicFrames > 0) {
        errors.push(
          `Slide ${index + 1} SVG page contains extra objects (p:sp=${shapes}, a:t=${textRuns}, p:graphicFrame=${graphicFrames}).`,
        );
      }

      if (pictureElements.length === 1) {
        const pictureXml = pictureElements[0];
        const svgBlips = Array.from(
          pictureXml.matchAll(/<asvg:svgBlip\b([^>]*)\/?>/gi),
        );
        if (svgBlips.length !== 1) {
          errors.push(
            `Slide ${index + 1} SVG picture must contain exactly one asvg:svgBlip; found ${svgBlips.length}.`,
          );
        }
        const svgRelationshipId = svgBlips.length === 1
          ? parseXmlAttributes(svgBlips[0][1]).get("r:embed")
          : undefined;
        const svgRelationship = svgRelationshipId
          ? relationships.get(svgRelationshipId)
          : undefined;
        const svgTarget = svgRelationship?.type?.endsWith("/image")
          ? svgRelationship.target
          : undefined;
        const svgHash = svgTarget
          ? svgMediaHashesByPath.get(svgTarget)
          : undefined;
        svgSourcePresent = svgHash === expectedSvgSource.sha256;

        inspectSvgPictureGeometry(pictureXml, index + 1, errors);
        await inspectSvgFallbackPng(
          archive,
          pictureXml,
          relationships,
          index + 1,
          warnings,
        );
      }

      if (!svgSourcePresent) {
        errors.push(
          `Slide ${index + 1} SVG picture's asvg:svgBlip is not related to its exact SVG source ${expectedSvgSource.sha256.slice(0, 12)}.`,
        );
      }
    }
    const titlePresent = expectedSvgSource
      ? svgSourcePresent
      : expectedSlide
        ? xml.includes(xmlText(expectedSlide.title))
        : false;

    if (editableObjects === 0) {
      errors.push(`Slide ${index + 1} contains no renderable page objects.`);
    }
    if (!expectedSvgSource && expectedSlide && !titlePresent) {
      errors.push(`Slide ${index + 1} is missing its title text after export.`);
    }
    if (expectedChartPrimitives > 0 && shapes < expectedChartPrimitives) {
      errors.push(
        `Slide ${index + 1} exported ${shapes} shape(s), fewer than the ${expectedChartPrimitives} required chart primitives.`,
      );
    }
    if (graphicFrames < expectedNativeCharts) {
      errors.push(
        `Slide ${index + 1} exported ${graphicFrames} graphic frame(s), fewer than the ${expectedNativeCharts} required native chart(s).`,
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
      expectedNativeCharts,
      titlePresent,
      svgSourcePresent,
    });
  }

  const mediaCount = Object.keys(archive.files)
    .filter((path) => /^ppt\/media\/[^/]+$/.test(path)).length;
  const expectedImages = presentation.slides.filter(
    (slide) => slide.visualSource?.kind === "svg",
  ).length + presentation.slides.flatMap((slide) =>
    slide.visualSource?.kind === "svg" ? [] : slide.elements
  )
    .filter((element) => element.type === "image").length;
  if (expectedImages > 0 && mediaCount === 0) {
    errors.push("Presentation contains image elements but the PPTX has no media parts.");
  }
  if (expectedImages === 0 && mediaCount === 0) {
    warnings.push("The deck intentionally uses native typography, shapes and data visuals without raster media.");
  }
  const chartPartCount = Object.keys(archive.files)
    .filter((path) => /^ppt\/charts\/chart\d+\.xml$/.test(path)).length;
  const expectedNativeChartCount = presentation.slides.flatMap((slide) =>
    slide.visualSource?.kind === "svg" ? [] : slide.elements
  )
    .filter((element) =>
      element.type === "chart"
      && (element.chartType === "bar" || element.chartType === "h-bar")
    ).length;
  if (chartPartCount < expectedNativeChartCount) {
    errors.push(
      `PPTX contains ${chartPartCount} native chart part(s), fewer than the ${expectedNativeChartCount} required by the Presentation.`,
    );
  }
  const notesPartCount = Object.keys(archive.files)
    .filter((path) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(path)).length;
  const expectedNotesCount = presentation.slides.filter((slide) => Boolean(slide.speakerNotes)).length;
  if (notesPartCount < expectedNotesCount) {
    errors.push(
      `PPTX contains ${notesPartCount} notes slide part(s), fewer than the ${expectedNotesCount} required by the Presentation.`,
    );
  }
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
    notesPartCount,
    totals,
    slides,
    errors,
    warnings,
  };
}
