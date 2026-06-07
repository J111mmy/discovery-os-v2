import { parseDocument } from "htmlparser2";
import sanitizeHtml from "sanitize-html";

export const ARTIFACT_HTML_ALLOWED_TAGS = [
  "h1",
  "h2",
  "h3",
  "h4",
  "p",
  "span",
  "div",
  "section",
  "header",
  "ul",
  "ol",
  "li",
  "blockquote",
  "strong",
  "em",
  "b",
  "a",
  "cite",
  "br",
  "hr",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "code",
  "pre",
] as const;

export const ARTIFACT_HTML_ALLOWED_CLASSES = [
  "dp-hero",
  "kicker",
  "lede",
  "dp-meta",
  "who",
  "dot",
  "sec",
  "dp-h2",
  "dp-num",
  "dp-h3",
  "ev",
  "pq",
  "pq-text",
  "pq-cite",
  "callout",
  "info",
  "warn",
  "pos",
  "neg",
  "ct",
  "takeaway",
  "tk-label",
  "stat-grid",
  "cols-2",
  "cols-3",
  "cols-4",
  "stat-cell",
  "n",
  "l",
  "dp-list",
  "dp-table",
  "flow",
  "flow-step",
  "pain",
  "fs-n",
  "fs-t",
  "fs-d",
  "dp-split",
] as const;

type AllowedTag = (typeof ARTIFACT_HTML_ALLOWED_TAGS)[number];
type HtmlNode = {
  type?: string;
  name?: string;
  attribs?: Record<string, string>;
  children?: HtmlNode[];
};

const ALLOWED_TAGS = new Set<string>(ARTIFACT_HTML_ALLOWED_TAGS);
const ALLOWED_CLASSES = new Set<string>(ARTIFACT_HTML_ALLOWED_CLASSES);
const ALLOWED_HREF_SCHEMES = new Set(["http", "https", "mailto"]);
const SECTION_ID_RE = /^[a-z0-9-]+$/;
const DATA_N_RE = /^[1-9]\d{0,3}$/;

export class ArtifactHtmlValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArtifactHtmlValidationError";
  }
}

function cleanClassList(value: string | undefined): string | undefined {
  if (!value) return undefined;

  const classes = value
    .split(/\s+/)
    .map((className) => className.trim())
    .filter((className) => className && ALLOWED_CLASSES.has(className));

  const deduped = Array.from(new Set(classes));
  return deduped.length > 0 ? deduped.join(" ") : undefined;
}

function cleanDataSection(value: string | undefined): string | undefined {
  if (!value) return undefined;

  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return cleaned.length > 0 ? cleaned.slice(0, 120) : undefined;
}

function isAllowedHref(value: string | undefined): value is string {
  if (!value) return false;

  const trimmed = value.trim();
  const match = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(trimmed);
  if (!match) return false;

  return ALLOWED_HREF_SCHEMES.has(match[1].toLowerCase());
}

function hasClass(attribs: Record<string, string>, className: string): boolean {
  return (attribs.class ?? "").split(/\s+/).includes(className);
}

function filterAttributes(tagName: string, attribs: sanitizeHtml.Attributes): sanitizeHtml.Attributes {
  const next: sanitizeHtml.Attributes = {};
  const className = cleanClassList(attribs.class);

  if (className) {
    next.class = className;
  }

  if (tagName === "a" && isAllowedHref(attribs.href)) {
    next.href = attribs.href.trim();
  }

  if (tagName === "section" && attribs.id && SECTION_ID_RE.test(attribs.id)) {
    next.id = attribs.id;
  }

  if (tagName === "h2") {
    const dataSection = cleanDataSection(attribs["data-section"]);
    if (dataSection) next["data-section"] = dataSection;
  }

  if (tagName === "cite" && attribs["data-n"] && DATA_N_RE.test(attribs["data-n"])) {
    next["data-n"] = attribs["data-n"];
  }

  if (tagName === "span" && next.class && hasClass(next, "ev") && attribs["data-n"] && DATA_N_RE.test(attribs["data-n"])) {
    next["data-n"] = attribs["data-n"];
  }

  return next;
}

const transformTags = Object.fromEntries(
  ARTIFACT_HTML_ALLOWED_TAGS.map((tagName) => [
    tagName,
    (currentTagName: string, attribs: sanitizeHtml.Attributes) => ({
      tagName: currentTagName,
      attribs: filterAttributes(currentTagName, attribs),
    }),
  ])
) as Record<AllowedTag, sanitizeHtml.Transformer>;

export const ARTIFACT_HTML_SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [...ARTIFACT_HTML_ALLOWED_TAGS],
  allowedAttributes: {
    "*": ["class"],
    a: ["href", "class"],
    section: ["id", "class"],
    h2: ["data-section", "class"],
    cite: ["data-n", "class"],
    span: ["data-n", "class"],
  },
  allowedClasses: {
    "*": [...ARTIFACT_HTML_ALLOWED_CLASSES],
  },
  allowedSchemes: Array.from(ALLOWED_HREF_SCHEMES),
  allowedSchemesByTag: {
    a: Array.from(ALLOWED_HREF_SCHEMES),
  },
  allowedSchemesAppliedToAttributes: ["href"],
  allowProtocolRelative: false,
  allowedStyles: {},
  disallowedTagsMode: "discard",
  enforceHtmlBoundary: true,
  parseStyleAttributes: false,
  transformTags,
};

function expectedAttributesForTag(tagName: string, attribs: Record<string, string>): Set<string> {
  const attrs = new Set<string>(["class"]);

  if (tagName === "a") attrs.add("href");
  if (tagName === "section") attrs.add("id");
  if (tagName === "h2") attrs.add("data-section");
  if (tagName === "cite") attrs.add("data-n");
  if (tagName === "span" && hasClass(attribs, "ev")) attrs.add("data-n");

  return attrs;
}

function validateElement(tagName: string, attribs: Record<string, string>): void {
  if (!ALLOWED_TAGS.has(tagName)) {
    throw new ArtifactHtmlValidationError(`Unexpected artifact HTML tag: ${tagName}`);
  }

  const expectedAttrs = expectedAttributesForTag(tagName, attribs);

  for (const [attrName, value] of Object.entries(attribs)) {
    if (!expectedAttrs.has(attrName)) {
      throw new ArtifactHtmlValidationError(`Unexpected ${tagName} attribute: ${attrName}`);
    }

    if (attrName === "class") {
      const classes = value.split(/\s+/).filter(Boolean);
      if (classes.length === 0 || classes.some((className) => !ALLOWED_CLASSES.has(className))) {
        throw new ArtifactHtmlValidationError(`Unexpected artifact HTML class on ${tagName}`);
      }
    }

    if (attrName === "href" && !isAllowedHref(value)) {
      throw new ArtifactHtmlValidationError("Unexpected artifact HTML href scheme");
    }

    if (attrName === "id" && !SECTION_ID_RE.test(value)) {
      throw new ArtifactHtmlValidationError("Unexpected artifact HTML section id");
    }

    if (attrName === "data-section" && cleanDataSection(value) !== value) {
      throw new ArtifactHtmlValidationError("Unexpected artifact HTML data-section");
    }

    if (attrName === "data-n" && !DATA_N_RE.test(value)) {
      throw new ArtifactHtmlValidationError("Unexpected artifact HTML data-n");
    }
  }
}

function walkSanitizedNode(node: HtmlNode): void {
  if (node.type === "comment") {
    throw new ArtifactHtmlValidationError("Unexpected artifact HTML comment");
  }

  if (node.name) {
    validateElement(node.name, node.attribs ?? {});
  }

  for (const child of node.children ?? []) {
    walkSanitizedNode(child);
  }
}

export function validateSanitizedArtifactHtml(html: string): void {
  const doc = parseDocument(html, {
    lowerCaseAttributeNames: true,
    lowerCaseTags: true,
  }) as HtmlNode;

  walkSanitizedNode(doc);
}

export function sanitizeArtifactHtml(input: string): string {
  const sanitized = sanitizeHtml(input, ARTIFACT_HTML_SANITIZE_OPTIONS).trim();
  validateSanitizedArtifactHtml(sanitized);
  return sanitized;
}
