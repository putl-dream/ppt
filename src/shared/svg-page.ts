export const SVG_PAGE_WIDTH = 1280;
export const SVG_PAGE_HEIGHT = 720;
export const SVG_PAGE_VIEW_BOX = `0 0 ${SVG_PAGE_WIDTH} ${SVG_PAGE_HEIGHT}`;
export const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

export type SvgPageValidationIssueCode =
  | "empty-markup"
  | "invalid-xml"
  | "invalid-root"
  | "invalid-namespace"
  | "invalid-view-box"
  | "invalid-dimensions"
  | "forbidden-declaration"
  | "forbidden-element"
  | "forbidden-css"
  | "event-handler"
  | "unsafe-url"
  | "invalid-image-href"
  | "duplicate-id"
  | "missing-reference"
  | "non-finite-number"
  | "validation-limit";

export interface SvgPageValidationIssue {
  code: SvgPageValidationIssueCode;
  message: string;
  index?: number;
  element?: string;
  attribute?: string;
}

export interface SvgPageValidationResult {
  valid: boolean;
  width: typeof SVG_PAGE_WIDTH;
  height: typeof SVG_PAGE_HEIGHT;
  viewBox: typeof SVG_PAGE_VIEW_BOX;
  issues: SvgPageValidationIssue[];
}

interface ParsedAttribute {
  name: string;
  value: string;
  index: number;
}

interface ParsedStartTag {
  name: string;
  attributes: ParsedAttribute[];
  selfClosing: boolean;
}

interface Reference {
  id: string;
  index: number;
  element: string;
  attribute: string;
}

const FORBIDDEN_ELEMENTS = new Set([
  "script",
  "foreignobject",
  "iframe",
  "object",
  "embed",
  "audio",
  "video",
  "style",
  "animate",
  "animatemotion",
  "animatetransform",
  "set",
  "discard",
  "filter",
  "mask",
  "textpath",
  "switch",
]);

const DATA_IMAGE_HREF =
  /^data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/]+={0,2}$/i;
const NON_FINITE_NUMBER = /(^|[^a-z0-9_])(?:nan|[-+]?infinity)(?=$|[^a-z0-9_])/i;
const XML_NAME = /^[A-Za-z_][A-Za-z0-9_.:-]*/;
export const MAX_SVG_VALIDATION_ISSUES = 200;
const issueKeysByCollection = new WeakMap<
  SvgPageValidationIssue[],
  Set<string>
>();
const truncatedIssueCollections = new WeakSet<SvgPageValidationIssue[]>();

function localName(name: string): string {
  return (name.includes(":") ? name.slice(name.lastIndexOf(":") + 1) : name).toLowerCase();
}

function createResult(issues: SvgPageValidationIssue[]): SvgPageValidationResult {
  return {
    valid: issues.length === 0,
    width: SVG_PAGE_WIDTH,
    height: SVG_PAGE_HEIGHT,
    viewBox: SVG_PAGE_VIEW_BOX,
    issues,
  };
}

function addIssue(
  issues: SvgPageValidationIssue[],
  issue: SvgPageValidationIssue,
): void {
  let issueKeys = issueKeysByCollection.get(issues);
  if (!issueKeys) {
    issueKeys = new Set<string>();
    issueKeysByCollection.set(issues, issueKeys);
  }
  if (issues.length >= MAX_SVG_VALIDATION_ISSUES) {
    if (!truncatedIssueCollections.has(issues)) {
      truncatedIssueCollections.add(issues);
      issues.push({
        code: "validation-limit",
        message:
          `SVG validation stopped collecting issues after ${MAX_SVG_VALIDATION_ISSUES} findings.`,
      });
    }
    return;
  }
  const issueKey = `${issue.code}\0${issue.index ?? ""}\0${issue.message}`;
  if (issueKeys.has(issueKey)) return;
  issueKeys.add(issueKey);
  issues.push(issue);
}

function isValidXmlCodePoint(codePoint: number): boolean {
  return codePoint === 0x09
    || codePoint === 0x0a
    || codePoint === 0x0d
    || (codePoint >= 0x20 && codePoint <= 0xd7ff)
    || (codePoint >= 0xe000 && codePoint <= 0xfffd)
    || (codePoint >= 0x10000 && codePoint <= 0x10ffff);
}

function decodeXmlAttribute(
  rawValue: string,
  index: number,
  issues: SvgPageValidationIssue[],
): string {
  let invalidEntity = false;
  const decoded = rawValue.replace(
    /&(#x[0-9a-f]+|#\d+|[A-Za-z][A-Za-z0-9._:-]*);/gi,
    (token, entity: string) => {
      const builtIns: Record<string, string> = {
        amp: "&",
        apos: "'",
        gt: ">",
        lt: "<",
        quot: '"',
      };
      const normalized = entity.toLowerCase();
      if (builtIns[normalized] !== undefined) return builtIns[normalized];

      let codePoint: number | undefined;
      if (normalized.startsWith("#x")) {
        codePoint = Number.parseInt(normalized.slice(2), 16);
      } else if (normalized.startsWith("#")) {
        codePoint = Number.parseInt(normalized.slice(1), 10);
      }
      if (
        codePoint === undefined
        || !Number.isInteger(codePoint)
        || !isValidXmlCodePoint(codePoint)
      ) {
        invalidEntity = true;
        return token;
      }
      return String.fromCodePoint(codePoint);
    },
  );

  const withoutValidEntities = rawValue.replace(
    /&(?:#x[0-9a-f]+|#\d+|amp|apos|gt|lt|quot);/gi,
    "",
  );
  if (invalidEntity || withoutValidEntities.includes("&")) {
    addIssue(issues, {
      code: "invalid-xml",
      message: "SVG attributes may use only valid numeric or built-in XML entities.",
      index,
    });
  }
  return decoded;
}

function findTagEnd(markup: string, start: number): number {
  let quote: '"' | "'" | null = null;
  for (let index = start; index < markup.length; index += 1) {
    const character = markup[index];
    if (quote) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
    } else if (character === ">") {
      return index;
    }
  }
  return -1;
}

function parseStartTag(
  source: string,
  absoluteIndex: number,
  issues: SvgPageValidationIssue[],
): ParsedStartTag | null {
  let cursor = 0;
  while (/\s/.test(source[cursor] ?? "")) cursor += 1;
  const nameMatch = source.slice(cursor).match(XML_NAME);
  if (!nameMatch) {
    addIssue(issues, {
      code: "invalid-xml",
      message: "SVG contains an opening tag without a valid XML name.",
      index: absoluteIndex,
    });
    return null;
  }

  const name = nameMatch[0];
  cursor += name.length;
  const attributes: ParsedAttribute[] = [];
  const attributeNames = new Set<string>();
  let selfClosing = false;

  while (cursor < source.length) {
    while (/\s/.test(source[cursor] ?? "")) cursor += 1;
    if (cursor >= source.length) break;
    if (source[cursor] === "/") {
      cursor += 1;
      while (/\s/.test(source[cursor] ?? "")) cursor += 1;
      if (cursor !== source.length) {
        addIssue(issues, {
          code: "invalid-xml",
          message: `Element <${name}> has content after its self-closing slash.`,
          index: absoluteIndex + cursor,
          element: name,
        });
        return null;
      }
      selfClosing = true;
      break;
    }

    const attributeIndex = cursor;
    const attributeMatch = source.slice(cursor).match(XML_NAME);
    if (!attributeMatch) {
      addIssue(issues, {
        code: "invalid-xml",
        message: `Element <${name}> contains invalid attribute syntax.`,
        index: absoluteIndex + cursor,
        element: name,
      });
      return null;
    }
    const attributeName = attributeMatch[0];
    cursor += attributeName.length;
    while (/\s/.test(source[cursor] ?? "")) cursor += 1;
    if (source[cursor] !== "=") {
      addIssue(issues, {
        code: "invalid-xml",
        message: `Attribute ${attributeName} on <${name}> must have a quoted value.`,
        index: absoluteIndex + attributeIndex,
        element: name,
        attribute: attributeName,
      });
      return null;
    }
    cursor += 1;
    while (/\s/.test(source[cursor] ?? "")) cursor += 1;
    const quote = source[cursor];
    if (quote !== '"' && quote !== "'") {
      addIssue(issues, {
        code: "invalid-xml",
        message: `Attribute ${attributeName} on <${name}> must use quotes.`,
        index: absoluteIndex + attributeIndex,
        element: name,
        attribute: attributeName,
      });
      return null;
    }
    cursor += 1;
    const valueStart = cursor;
    const valueEnd = source.indexOf(quote, valueStart);
    if (valueEnd < 0) {
      addIssue(issues, {
        code: "invalid-xml",
        message: `Attribute ${attributeName} on <${name}> has an unterminated value.`,
        index: absoluteIndex + attributeIndex,
        element: name,
        attribute: attributeName,
      });
      return null;
    }
    const normalizedAttributeName = attributeName.toLowerCase();
    if (attributeNames.has(normalizedAttributeName)) {
      addIssue(issues, {
        code: "invalid-xml",
        message: `Element <${name}> contains duplicate attribute ${attributeName}.`,
        index: absoluteIndex + attributeIndex,
        element: name,
        attribute: attributeName,
      });
    }
    attributeNames.add(normalizedAttributeName);
    attributes.push({
      name: attributeName,
      value: decodeXmlAttribute(
        source.slice(valueStart, valueEnd),
        absoluteIndex + valueStart,
        issues,
      ),
      index: absoluteIndex + attributeIndex,
    });
    cursor = valueEnd + 1;
  }

  return { name, attributes, selfClosing };
}

function attributeByName(
  attributes: ParsedAttribute[],
  name: string,
): ParsedAttribute | undefined {
  return attributes.find((attribute) => attribute.name === name);
}

function hasUnsafeUrl(value: string): boolean {
  const compact = value.replace(/[\u0000-\u0020\u007f]+/g, "").toLowerCase();
  return /(?:https?|ftp|ftps|ws|wss|file|javascript):/.test(compact)
    || compact.startsWith("//");
}

function collectCssUrlReferences(
  value: string,
  element: string,
  attribute: ParsedAttribute,
  references: Reference[],
  issues: SvgPageValidationIssue[],
): void {
  const pattern = /url\(\s*(?:(["'])(.*?)\1|([^)]*?))\s*\)/gi;
  for (const match of value.matchAll(pattern)) {
    const target = (match[2] ?? match[3] ?? "").trim();
    if (/^#[A-Za-z_][A-Za-z0-9_.:-]*$/.test(target)) {
      references.push({
        id: target.slice(1),
        index: attribute.index + (match.index ?? 0),
        element,
        attribute: attribute.name,
      });
      continue;
    }
    addIssue(issues, {
      code: "unsafe-url",
      message: `Attribute ${attribute.name} on <${element}> may use url() only for a local #id reference.`,
      index: attribute.index + (match.index ?? 0),
      element,
      attribute: attribute.name,
    });
  }
}

function inspectElement(
  tag: ParsedStartTag,
  index: number,
  ids: Map<string, number>,
  references: Reference[],
  issues: SvgPageValidationIssue[],
): void {
  const element = localName(tag.name);
  if (FORBIDDEN_ELEMENTS.has(element) || element.startsWith("animate")) {
    addIssue(issues, {
      code: "forbidden-element",
      message: `Element <${tag.name}> is forbidden in an SVG page.`,
      index,
      element: tag.name,
    });
  }

  const imageHrefAttributes: ParsedAttribute[] = [];
  for (const attribute of tag.attributes) {
    const attributeLocalName = localName(attribute.name);
    const isNamespace = attribute.name === "xmlns" || attribute.name.startsWith("xmlns:");
    if (attributeLocalName.startsWith("on") && attributeLocalName.length > 2) {
      addIssue(issues, {
        code: "event-handler",
        message: `Event attribute ${attribute.name} on <${tag.name}> is forbidden.`,
        index: attribute.index,
        element: tag.name,
        attribute: attribute.name,
      });
    }
    if (
      !attribute.value.toLowerCase().startsWith("data:image/")
      && NON_FINITE_NUMBER.test(attribute.value)
    ) {
      addIssue(issues, {
        code: "non-finite-number",
        message: `Attribute ${attribute.name} on <${tag.name}> contains NaN or Infinity.`,
        index: attribute.index,
        element: tag.name,
        attribute: attribute.name,
      });
    }
    if (!isNamespace && hasUnsafeUrl(attribute.value)) {
      addIssue(issues, {
        code: "unsafe-url",
        message: `Attribute ${attribute.name} on <${tag.name}> contains a remote, file, or javascript URL.`,
        index: attribute.index,
        element: tag.name,
        attribute: attribute.name,
      });
    }
    if (/@import\b|@font-face\b/i.test(attribute.value)) {
      addIssue(issues, {
        code: "forbidden-css",
        message: `Attribute ${attribute.name} on <${tag.name}> contains forbidden CSS loading syntax.`,
        index: attribute.index,
        element: tag.name,
        attribute: attribute.name,
      });
    }
    if (attribute.value.includes("\\") || attribute.value.includes("/*")) {
      addIssue(issues, {
        code: "forbidden-css",
        message: `Attribute ${attribute.name} on <${tag.name}> contains CSS token-smuggling syntax.`,
        index: attribute.index,
        element: tag.name,
        attribute: attribute.name,
      });
    }
    if (
      attributeLocalName === "style"
      && (
        /(?:^|[;\s])(?:filter|mask|mix-blend-mode|isolation|behavior|-moz-binding)\s*:/i
          .test(attribute.value)
        || /\bexpression\s*\(/i.test(attribute.value)
      )
    ) {
      addIssue(issues, {
        code: "forbidden-css",
        message: `Style attribute on <${tag.name}> uses CSS outside the Office-safe page subset.`,
        index: attribute.index,
        element: tag.name,
        attribute: attribute.name,
      });
    }
    if (attributeLocalName === "filter" || attributeLocalName === "mask") {
      addIssue(issues, {
        code: "forbidden-css",
        message: `Attribute ${attribute.name} on <${tag.name}> is outside the Office-safe page subset.`,
        index: attribute.index,
        element: tag.name,
        attribute: attribute.name,
      });
    }

    collectCssUrlReferences(
      attribute.value,
      tag.name,
      attribute,
      references,
      issues,
    );

    if (attributeLocalName === "id") {
      const previousIndex = ids.get(attribute.value);
      if (previousIndex !== undefined) {
        addIssue(issues, {
          code: "duplicate-id",
          message: `SVG id "${attribute.value}" is duplicated.`,
          index: attribute.index,
          element: tag.name,
          attribute: attribute.name,
        });
      } else {
        ids.set(attribute.value, attribute.index);
      }
    }

    if (attributeLocalName !== "href") continue;
    if (element === "image") {
      imageHrefAttributes.push(attribute);
      if (!DATA_IMAGE_HREF.test(attribute.value)) {
        addIssue(issues, {
          code: "invalid-image-href",
          message:
            `Image href on <${tag.name}> must be a base64 data URI using PNG, JPEG, GIF, or WebP.`,
          index: attribute.index,
          element: tag.name,
          attribute: attribute.name,
        });
      }
      continue;
    }

    if (/^#[A-Za-z_][A-Za-z0-9_.:-]*$/.test(attribute.value)) {
      references.push({
        id: attribute.value.slice(1),
        index: attribute.index,
        element: tag.name,
        attribute: attribute.name,
      });
    } else {
      addIssue(issues, {
        code: "unsafe-url",
        message: `Attribute ${attribute.name} on <${tag.name}> must reference a local #id.`,
        index: attribute.index,
        element: tag.name,
        attribute: attribute.name,
      });
    }
  }

  if (element === "image" && imageHrefAttributes.length === 0) {
    addIssue(issues, {
      code: "invalid-image-href",
      message: `Element <${tag.name}> must have an href or xlink:href data image.`,
      index,
      element: tag.name,
    });
  } else if (element === "image" && imageHrefAttributes.length > 1) {
    addIssue(issues, {
      code: "invalid-image-href",
      message: `Element <${tag.name}> must declare exactly one href or xlink:href.`,
      index,
      element: tag.name,
    });
  }
}

function inspectTextOutsideRoot(
  text: string,
  index: number,
  rootSeen: boolean,
  rootClosed: boolean,
  issues: SvgPageValidationIssue[],
): void {
  if (text.trim() && (!rootSeen || rootClosed)) {
    addIssue(issues, {
      code: "invalid-xml",
      message: "SVG contains text outside its root element.",
      index,
    });
  }
}

function inspectXmlTextEntities(
  text: string,
  index: number,
  issues: SvgPageValidationIssue[],
): void {
  let invalidEntity = false;
  text.replace(
    /&(#x[0-9a-f]+|#\d+|[A-Za-z][A-Za-z0-9._:-]*);/gi,
    (_token, entity: string) => {
      const normalized = entity.toLowerCase();
      if (["amp", "apos", "gt", "lt", "quot"].includes(normalized)) return "";
      const codePoint = normalized.startsWith("#x")
        ? Number.parseInt(normalized.slice(2), 16)
        : normalized.startsWith("#")
          ? Number.parseInt(normalized.slice(1), 10)
          : Number.NaN;
      if (!Number.isInteger(codePoint) || !isValidXmlCodePoint(codePoint)) {
        invalidEntity = true;
      }
      return "";
    },
  );
  const withoutValidEntities = text.replace(
    /&(?:#x[0-9a-f]+|#\d+|amp|apos|gt|lt|quot);/gi,
    "",
  );
  if (invalidEntity || withoutValidEntities.includes("&")) {
    addIssue(issues, {
      code: "invalid-xml",
      message: "SVG text may use only valid numeric or built-in XML entities.",
      index,
    });
  }
}

export function validateSvgPage(markup: string): SvgPageValidationResult {
  const issues: SvgPageValidationIssue[] = [];
  if (!markup.trim()) {
    addIssue(issues, {
      code: "empty-markup",
      message: "SVG page markup must not be empty.",
      index: 0,
    });
    return createResult(issues);
  }
  for (let index = 0; index < markup.length;) {
    const codePoint = markup.codePointAt(index)!;
    if (!isValidXmlCodePoint(codePoint)) {
      addIssue(issues, {
        code: "invalid-xml",
        message: "SVG contains a character that is not valid in XML 1.0.",
        index,
      });
      break;
    }
    index += codePoint > 0xffff ? 2 : 1;
  }

  for (const match of markup.matchAll(/<!\s*(DOCTYPE|ENTITY)\b/gi)) {
    addIssue(issues, {
      code: "forbidden-declaration",
      message: `SVG declaration ${match[1].toUpperCase()} is forbidden.`,
      index: match.index,
    });
  }
  for (const match of markup.matchAll(/@(import|font-face)\b/gi)) {
    addIssue(issues, {
      code: "forbidden-css",
      message: `CSS @${match[1].toLowerCase()} is forbidden in an SVG page.`,
      index: match.index,
    });
  }

  const ids = new Map<string, number>();
  const references: Reference[] = [];
  const openElements: Array<{ name: string; index: number }> = [];
  let root: ParsedStartTag | null = null;
  let rootSeen = false;
  let rootClosed = false;
  let xmlDeclarationSeen = false;
  let usesXlinkPrefix = false;
  let cursor = 0;

  while (cursor < markup.length) {
    const tagStart = markup.indexOf("<", cursor);
    if (tagStart < 0) {
      inspectXmlTextEntities(markup.slice(cursor), cursor, issues);
      inspectTextOutsideRoot(
        markup.slice(cursor),
        cursor,
        rootSeen,
        rootClosed,
        issues,
      );
      break;
    }
    inspectXmlTextEntities(markup.slice(cursor, tagStart), cursor, issues);
    inspectTextOutsideRoot(
      markup.slice(cursor, tagStart),
      cursor,
      rootSeen,
      rootClosed,
      issues,
    );

    if (markup.startsWith("<!--", tagStart)) {
      const commentEnd = markup.indexOf("-->", tagStart + 4);
      if (commentEnd < 0) {
        addIssue(issues, {
          code: "invalid-xml",
          message: "SVG contains an unterminated XML comment.",
          index: tagStart,
        });
        break;
      }
      const comment = markup.slice(tagStart + 4, commentEnd);
      if (comment.includes("--") || comment.endsWith("-")) {
        addIssue(issues, {
          code: "invalid-xml",
          message: "XML comments must not contain '--'.",
          index: tagStart,
        });
      }
      cursor = commentEnd + 3;
      continue;
    }
    if (markup.startsWith("<![CDATA[", tagStart)) {
      const cdataEnd = markup.indexOf("]]>", tagStart + 9);
      if (cdataEnd < 0) {
        addIssue(issues, {
          code: "invalid-xml",
          message: "SVG contains an unterminated CDATA section.",
          index: tagStart,
        });
        break;
      }
      if (!rootSeen || rootClosed) {
        inspectTextOutsideRoot(
          markup.slice(tagStart + 9, cdataEnd),
          tagStart + 9,
          rootSeen,
          rootClosed,
          issues,
        );
      }
      cursor = cdataEnd + 3;
      continue;
    }
    if (markup.startsWith("<?", tagStart)) {
      const instructionEnd = markup.indexOf("?>", tagStart + 2);
      if (instructionEnd < 0) {
        addIssue(issues, {
          code: "invalid-xml",
          message: "SVG contains an unterminated processing instruction.",
          index: tagStart,
        });
        break;
      }
      const instruction = markup.slice(tagStart + 2, instructionEnd).trim();
      const validXmlDeclaration =
        /^xml\s+version\s*=\s*(["'])1\.0\1(?:\s+encoding\s*=\s*(["'])utf-8\2)?(?:\s+standalone\s*=\s*(["'])(?:yes|no)\3)?\s*$/i
          .test(instruction);
      if (
        !/^xml(?:\s|$)/i.test(instruction)
        || xmlDeclarationSeen
        || rootSeen
        || markup.slice(0, tagStart).trim()
      ) {
        addIssue(issues, {
          code: "forbidden-declaration",
          message: "Only one leading XML declaration is allowed.",
          index: tagStart,
        });
      } else if (!validXmlDeclaration) {
        addIssue(issues, {
          code: "invalid-xml",
          message: "The XML declaration is malformed or uses an unsupported encoding.",
          index: tagStart,
        });
        xmlDeclarationSeen = true;
      } else {
        xmlDeclarationSeen = true;
      }
      cursor = instructionEnd + 2;
      continue;
    }
    if (markup.startsWith("<!", tagStart)) {
      const declarationEnd = findTagEnd(markup, tagStart + 2);
      addIssue(issues, {
        code: "forbidden-declaration",
        message: "SVG declarations other than comments and CDATA are forbidden.",
        index: tagStart,
      });
      if (declarationEnd < 0) break;
      cursor = declarationEnd + 1;
      continue;
    }

    const tagEnd = findTagEnd(markup, tagStart + 1);
    if (tagEnd < 0) {
      addIssue(issues, {
        code: "invalid-xml",
        message: "SVG contains an unterminated element tag.",
        index: tagStart,
      });
      break;
    }
    const tagSource = markup.slice(tagStart + 1, tagEnd);
    if (/^\s*\//.test(tagSource)) {
      const closingMatch = tagSource.match(/^\s*\/\s*([A-Za-z_][A-Za-z0-9_.:-]*)\s*$/);
      if (!closingMatch) {
        addIssue(issues, {
          code: "invalid-xml",
          message: "SVG contains an invalid closing tag.",
          index: tagStart,
        });
      } else {
        const closingName = closingMatch[1];
        const opening = openElements.pop();
        if (!opening || opening.name !== closingName) {
          addIssue(issues, {
            code: "invalid-xml",
            message: opening
              ? `Closing tag </${closingName}> does not match <${opening.name}>.`
              : `Closing tag </${closingName}> has no matching opening tag.`,
            index: tagStart,
            element: closingName,
          });
        }
        if (openElements.length === 0 && rootSeen) rootClosed = true;
      }
      cursor = tagEnd + 1;
      continue;
    }

    const tag = parseStartTag(tagSource, tagStart + 1, issues);
    if (!tag) {
      cursor = tagEnd + 1;
      continue;
    }
    const isRootTag = !rootSeen && openElements.length === 0;
    if (tag.name.includes(":")) {
      addIssue(issues, {
        code: "invalid-namespace",
        message: `Prefixed element <${tag.name}> is outside the SVG page namespace subset.`,
        index: tagStart,
        element: tag.name,
      });
    }
    for (const attribute of tag.attributes) {
      if (!attribute.name.includes(":")) continue;
      const normalizedName = attribute.name.toLowerCase();
      const allowedXlinkHref = normalizedName === "xlink:href";
      const allowedRootBinding = isRootTag && normalizedName === "xmlns:xlink";
      if (allowedXlinkHref || allowedRootBinding) continue;
      addIssue(issues, {
        code: "invalid-namespace",
        message: `Attribute ${attribute.name} on <${tag.name}> uses an unsupported namespace prefix.`,
        index: attribute.index,
        element: tag.name,
        attribute: attribute.name,
      });
    }
    if (openElements.length === 0) {
      if (rootSeen) {
        addIssue(issues, {
          code: "invalid-root",
          message: "SVG page must contain exactly one root element.",
          index: tagStart,
          element: tag.name,
        });
      } else {
        rootSeen = true;
        root = tag;
      }
    }
    if (
      tag.name.toLowerCase().startsWith("xlink:")
      || tag.attributes.some((attribute) =>
        attribute.name.toLowerCase().startsWith("xlink:")
      )
    ) {
      usesXlinkPrefix = true;
    }

    inspectElement(tag, tagStart, ids, references, issues);
    if (!tag.selfClosing) {
      openElements.push({ name: tag.name, index: tagStart });
    } else if (openElements.length === 0) {
      rootClosed = true;
    }
    cursor = tagEnd + 1;
  }

  if (!root) {
    addIssue(issues, {
      code: "invalid-root",
      message: "SVG page must have an <svg> root element.",
      index: 0,
    });
  } else {
    if (root.name !== "svg") {
      addIssue(issues, {
        code: "invalid-root",
        message: `SVG page root must be <svg>, received <${root.name}>.`,
        index: 0,
        element: root.name,
      });
    }
    const namespace = attributeByName(root.attributes, "xmlns");
    if (!namespace || namespace.value !== SVG_NAMESPACE) {
      addIssue(issues, {
        code: "invalid-namespace",
        message: `Root <svg> must declare xmlns="${SVG_NAMESPACE}".`,
        index: namespace?.index ?? 0,
        element: root.name,
        attribute: "xmlns",
      });
    }
    const xlinkNamespace = attributeByName(root.attributes, "xmlns:xlink");
    if (
      usesXlinkPrefix
      && (!xlinkNamespace || xlinkNamespace.value !== "http://www.w3.org/1999/xlink")
    ) {
      addIssue(issues, {
        code: "invalid-namespace",
        message:
          'The xlink prefix requires xmlns:xlink="http://www.w3.org/1999/xlink" on the root.',
        index: xlinkNamespace?.index ?? 0,
        element: root.name,
        attribute: "xmlns:xlink",
      });
    }
    const viewBox = attributeByName(root.attributes, "viewBox");
    if (!viewBox || viewBox.value.trim() !== SVG_PAGE_VIEW_BOX) {
      addIssue(issues, {
        code: "invalid-view-box",
        message: `Root <svg> must declare viewBox="${SVG_PAGE_VIEW_BOX}".`,
        index: viewBox?.index ?? 0,
        element: root.name,
        attribute: "viewBox",
      });
    }
    const width = attributeByName(root.attributes, "width");
    const height = attributeByName(root.attributes, "height");
    if (
      width?.value.trim() !== String(SVG_PAGE_WIDTH)
      || height?.value.trim() !== String(SVG_PAGE_HEIGHT)
    ) {
      addIssue(issues, {
        code: "invalid-dimensions",
        message:
          `Root <svg> must declare width="${SVG_PAGE_WIDTH}" and height="${SVG_PAGE_HEIGHT}".`,
        index: width?.index ?? height?.index ?? 0,
        element: root.name,
      });
    }
    const rootTransform = attributeByName(root.attributes, "transform");
    if (rootTransform) {
      addIssue(issues, {
        code: "invalid-root",
        message: "Root <svg> must not use transform; author geometry in the canonical page coordinates.",
        index: rootTransform.index,
        element: root.name,
        attribute: rootTransform.name,
      });
    }
  }

  if (openElements.length > 0) {
    const opening = openElements[openElements.length - 1];
    addIssue(issues, {
      code: "invalid-xml",
      message: `Element <${opening.name}> is not closed.`,
      index: opening.index,
      element: opening.name,
    });
  }

  for (const reference of references) {
    if (ids.has(reference.id)) continue;
    addIssue(issues, {
      code: "missing-reference",
      message: `Reference "#${reference.id}" on <${reference.element}> does not resolve to an SVG id.`,
      index: reference.index,
      element: reference.element,
      attribute: reference.attribute,
    });
  }

  return createResult(issues);
}

export class SvgPageValidationError extends Error {
  readonly issues: SvgPageValidationIssue[];

  constructor(issues: SvgPageValidationIssue[]) {
    const details = issues
      .map((issue, index) => `${index + 1}. [${issue.code}] ${issue.message}`)
      .join("\n");
    super(`Invalid SVG page (${issues.length} issue${issues.length === 1 ? "" : "s"}):\n${details}`);
    this.name = "SvgPageValidationError";
    this.issues = issues;
  }
}

export function assertValidSvgPage(markup: string): void {
  const result = validateSvgPage(markup);
  if (!result.valid) throw new SvgPageValidationError(result.issues);
}

export function svgMarkupToDataUri(markup: string): string {
  assertValidSvgPage(markup);
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
}
