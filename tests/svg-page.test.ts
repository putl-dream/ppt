import { describe, expect, it } from "vitest";
import { slideSchema } from "../src/shared/presentation";
import {
  assertValidSvgPage,
  MAX_SVG_VALIDATION_ISSUES,
  SVG_NAMESPACE,
  SVG_PAGE_HEIGHT,
  SVG_PAGE_VIEW_BOX,
  SVG_PAGE_WIDTH,
  SvgPageValidationError,
  svgMarkupToDataUri,
  validateSvgPage,
} from "../src/shared/svg-page";

function page(body = ""): string {
  return `<svg xmlns="${SVG_NAMESPACE}" width="${SVG_PAGE_WIDTH}" height="${SVG_PAGE_HEIGHT}" viewBox="${SVG_PAGE_VIEW_BOX}">${body}</svg>`;
}

describe("svg-page", () => {
  it("accepts a canonical 1280x720 SVG with local references and data images", () => {
    const markup = page(`
      <defs>
        <linearGradient id="accent"><stop offset="0" stop-color="#ffffff"/></linearGradient>
        <g id="mark"><circle cx="24" cy="24" r="12"/></g>
      </defs>
      <rect width="1280" height="720" fill="url(#accent)"/>
      <use href="#mark"/>
      <image href="data:image/webp;base64,AAAA" x="100" y="100" width="320" height="180"/>
    `);

    expect(validateSvgPage(markup)).toEqual({
      valid: true,
      width: 1280,
      height: 720,
      viewBox: "0 0 1280 720",
      issues: [],
    });
    expect(() => assertValidSvgPage(markup)).not.toThrow();
    expect(SVG_PAGE_WIDTH).toBe(1280);
    expect(SVG_PAGE_HEIGHT).toBe(720);
  });

  it("requires the canonical svg root, namespace, and viewBox", () => {
    const result = validateSvgPage('<g xmlns="http://example.com" viewBox="0 0 1920 1080"></g>');

    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "invalid-root",
        "invalid-namespace",
        "invalid-view-box",
        "invalid-dimensions",
      ]),
    );
  });

  it("rejects non-canonical root dimensions and root transforms", () => {
    const wrongSize = validateSvgPage(
      `<svg xmlns="${SVG_NAMESPACE}" width="640" height="360" viewBox="${SVG_PAGE_VIEW_BOX}"/>`,
    );
    expect(wrongSize.issues.map((issue) => issue.code)).toContain("invalid-dimensions");

    const transformed = validateSvgPage(
      page().replace("<svg ", '<svg transform="translate(1 1)" '),
    );
    expect(transformed.issues.map((issue) => issue.code)).toContain("invalid-root");
  });

  it.each([
    ["doctype", `<!DOCTYPE svg>${page()}`, "forbidden-declaration"],
    ["entity", `<!ENTITY xxe SYSTEM "file:///etc/passwd">${page()}`, "forbidden-declaration"],
    ["script", page("<script>alert(1)</script>"), "forbidden-element"],
    ["foreignObject", page("<foreignObject/>"), "forbidden-element"],
    ["iframe", page("<iframe/>"), "forbidden-element"],
    ["object", page("<object/>"), "forbidden-element"],
    ["embed", page("<embed/>"), "forbidden-element"],
    ["audio", page("<audio/>"), "forbidden-element"],
    ["video", page("<video/>"), "forbidden-element"],
    ["style", page("<style>.a { fill: red }</style>"), "forbidden-element"],
    ["animate", page('<animate attributeName="x" from="0" to="10"/>'), "forbidden-element"],
    ["animateColor", page('<animateColor attributeName="fill"/>'), "forbidden-element"],
    ["set", page('<set attributeName="fill" to="red"/>'), "forbidden-element"],
    ["discard", page("<discard/>"), "forbidden-element"],
    ["filter", page("<filter/>"), "forbidden-element"],
    ["mask", page("<mask/>"), "forbidden-element"],
    ["textPath", page("<textPath/>"), "forbidden-element"],
    ["@import", page('<rect style="@import url(#theme)"/>'), "forbidden-css"],
    ["@font-face", page('<text style="@font-face{}">Text</text>'), "forbidden-css"],
  ])("rejects forbidden %s content", (_label, markup, expectedCode) => {
    const result = validateSvgPage(markup);
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.code === expectedCode)).toBe(true);
  });

  it("rejects event attributes, including namespaced and mixed-case forms", () => {
    const result = validateSvgPage(
      page('<g onload="run()" svg:onClick="run()"><rect width="10" height="10"/></g>'),
    );

    expect(result.issues.filter((issue) => issue.code === "event-handler")).toHaveLength(2);
  });

  it.each([
    "https://example.com/a.png",
    "http://example.com/a.png",
    "//example.com/a.png",
    "file:///tmp/a.png",
    "javascript:alert(1)",
  ])("rejects unsafe image URL %s", (href) => {
    const result = validateSvgPage(page(`<image href="${href}"/>`));
    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain("invalid-image-href");
  });

  it.each(["png", "jpeg", "gif", "webp"])("accepts hydrated base64 %s image hrefs", (format) => {
    expect(validateSvgPage(page(`<image href="data:image/${format};base64,AAAA"/>`)).valid).toBe(
      true,
    );
  });

  it("rejects missing, SVG, and non-base64 image hrefs", () => {
    const result = validateSvgPage(
      page(`
      <image/>
      <image href="data:image/svg+xml;base64,PHN2Zy8+"/>
      <image href="data:image/png,AAAA"/>
    `),
    );

    expect(result.issues.filter((issue) => issue.code === "invalid-image-href")).toHaveLength(3);
  });

  it("rejects remote, file, and javascript URLs outside image elements", () => {
    const result = validateSvgPage(
      page(`
      <a href="https://example.com"/>
      <rect style="fill:url(file:///tmp/fill.png)"/>
      <use href="javascript:alert(1)"/>
    `),
    );

    expect(result.valid).toBe(false);
    expect(
      result.issues.filter((issue) => issue.code === "unsafe-url").length,
    ).toBeGreaterThanOrEqual(3);
  });

  it.each([
    String.raw`<rect style="fill:u\72l(h\74tps\3a //example.com/pixel.png)"/>`,
    String.raw`<rect fill="u\72l(h\74tps\3a //example.com/pixel.png)"/>`,
    '<rect fill="url(/*comment*/#paint)"/>',
  ])("rejects CSS token-smuggling syntax in attributes", (element) => {
    const result = validateSvgPage(page(element));
    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain("forbidden-css");
  });

  it("reports duplicate ids and every unresolved fragment reference", () => {
    const result = validateSvgPage(
      page(`
      <defs><linearGradient id="duplicate"/></defs>
      <g id="duplicate"/>
      <rect fill="url(#missing-fill)"/>
      <use href="#missing-use"/>
    `),
    );

    expect(result.issues.map((issue) => issue.code)).toContain("duplicate-id");
    expect(
      result.issues
        .filter((issue) => issue.code === "missing-reference")
        .map((issue) => issue.message),
    ).toEqual([expect.stringContaining("#missing-fill"), expect.stringContaining("#missing-use")]);
  });

  it.each([
    '<rect x="NaN" width="10" height="10"/>',
    '<rect x="Infinity" width="10" height="10"/>',
    '<path d="M 0 0 L -Infinity 10"/>',
  ])("rejects non-finite numeric values in attributes", (element) => {
    const result = validateSvgPage(page(element));
    expect(result.issues.map((issue) => issue.code)).toContain("non-finite-number");
  });

  it("rejects malformed XML and unknown entities", () => {
    const malformed = validateSvgPage(page("<g><rect></g>"));
    expect(malformed.issues.map((issue) => issue.code)).toContain("invalid-xml");

    const entity = validateSvgPage(page('<text aria-label="&custom;">Text</text>'));
    expect(entity.issues.map((issue) => issue.code)).toContain("invalid-xml");

    const bareTextAmpersand = validateSvgPage(page("<text>R&D</text>"));
    expect(bareTextAmpersand.issues.map((issue) => issue.code)).toContain("invalid-xml");

    expect(validateSvgPage(page("<text>R&amp;D</text>")).valid).toBe(true);
  });

  it.each([
    page("<text>A\u0000B</text>"),
    page("<!-- a -- b -->"),
    page("<!-- a --->"),
    `<?xml nonsense?>${page()}`,
  ])("rejects XML that a conforming renderer cannot parse", (markup) => {
    expect(validateSvgPage(markup).issues.map((issue) => issue.code)).toContain("invalid-xml");
  });

  it("requires declared, closed namespaces", () => {
    expect(
      validateSvgPage(page('<use xlink:href="#x"/><g id="x"/>')).issues.map((issue) => issue.code),
    ).toContain("invalid-namespace");
    expect(
      validateSvgPage(page('<foo:g/><use foo:href="#x"/><g id="x"/>')).issues.map(
        (issue) => issue.code,
      ),
    ).toContain("invalid-namespace");

    const withXlink = [
      `<svg xmlns="${SVG_NAMESPACE}" xmlns:xlink="http://www.w3.org/1999/xlink" `,
      `width="${SVG_PAGE_WIDTH}" height="${SVG_PAGE_HEIGHT}" `,
      `viewBox="${SVG_PAGE_VIEW_BOX}"><g id="x"/><use xlink:href="#x"/></svg>`,
    ].join("");
    expect(validateSvgPage(withXlink).valid).toBe(true);
  });

  it("bounds validation findings for adversarial SVG input", () => {
    const body = Array.from(
      { length: 2_000 },
      (_, index) => `<rect onclick="event${index}()" x="${index}"/>`,
    ).join("");
    const result = validateSvgPage(page(body));

    expect(result.valid).toBe(false);
    expect(result.issues).toHaveLength(MAX_SVG_VALIDATION_ISSUES + 1);
    expect(result.issues.at(-1)?.code).toBe("validation-limit");
  });

  it("preserves SVG bytes in schema parsing and rejects legacy element fields", () => {
    const markup = `\n${page('<rect width="1280" height="720"/>')}\n`;
    const baseSlide = {
      id: "svg-schema",
      title: "Schema",
      visualSource: {
        kind: "svg" as const,
        markup,
        width: 1280 as const,
        height: 720 as const,
        sha256: "a".repeat(64),
        sourcePath: "slides/svg/P01.svg",
        resources: [],
      },
    };

    expect(slideSchema.parse(baseSlide).visualSource?.markup).toBe(markup);
    expect(
      slideSchema.safeParse({
        ...baseSlide,
        elements: [],
      }).success,
    ).toBe(false);
  });

  it("throws one structured error whose message includes every issue", () => {
    const markup = '<svg viewBox="0 0 1 1"><script/></svg>';

    expect(() => assertValidSvgPage(markup)).toThrowError(SvgPageValidationError);
    try {
      assertValidSvgPage(markup);
      throw new Error("Expected SVG validation to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(SvgPageValidationError);
      const validationError = error as SvgPageValidationError;
      expect(validationError.issues.length).toBeGreaterThanOrEqual(3);
      for (const issue of validationError.issues) {
        expect(validationError.message).toContain(`[${issue.code}] ${issue.message}`);
      }
    }
  });

  it("returns a validated, percent-encoded SVG data URI for browser preview", () => {
    const markup = page('<text x="40" y="80">R&amp;D #1</text>');
    const dataUri = svgMarkupToDataUri(markup);

    expect(dataUri).toMatch(/^data:image\/svg\+xml;charset=utf-8,/);
    expect(decodeURIComponent(dataUri.slice(dataUri.indexOf(",") + 1))).toBe(markup);
    expect(() => svgMarkupToDataUri("<svg/>")).toThrow(SvgPageValidationError);
  });
});
