import type { VisualStyle } from "@design-system";
import {
  getBuiltinTemplate,
  getBuiltinTemplateByVisualStyle,
  listAutoPoolTemplates,
  requireBuiltinTemplate,
} from "./template-catalog";
import {
  APPLICATION_DEFAULT_TEMPLATE_ID,
  type ProjectTemplatePolicy,
  type ResolvedTemplateSelection,
  resolvedTemplateSelectionSchema,
  type TemplateCommunicationSignals,
  type TemplateDescriptor,
  type TemplateMatchScore,
} from "./template-protocol";

const AUTO_CONFIDENCE_THRESHOLD = 0.42;
const AUTO_SCORE_GAP_THRESHOLD = 0.08;

export interface ResolveTemplateInput {
  policy: ProjectTemplatePolicy;
  signals?: TemplateCommunicationSignals;
  /** Uploaded descriptors available in the current project library. */
  uploadedTemplates?: readonly TemplateDescriptor[];
}

export interface ResolveTemplateResult {
  selection: ResolvedTemplateSelection;
  template: TemplateDescriptor;
  scores: TemplateMatchScore[];
}

function normalizeText(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function tokenize(...parts: Array<string | undefined>): string[] {
  const text = parts.filter(Boolean).join(" ").toLowerCase();
  return text
    .split(/[\s,，、/;|]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function includesAny(haystack: string, needles: readonly string[]): string[] {
  return needles.filter((needle) => {
    const normalized = needle.toLowerCase();
    return normalized.length > 0 && haystack.includes(normalized);
  });
}

function scoreTemplate(
  template: TemplateDescriptor,
  signals: TemplateCommunicationSignals,
): TemplateMatchScore {
  const corpus = normalizeText(
    [
      signals.audience,
      signals.objective,
      signals.desiredOutcome,
      signals.coreMessage,
      signals.deliveryContext,
      signals.afterUse,
      ...(signals.topics ?? []),
    ]
      .filter(Boolean)
      .join(" "),
  );
  const tokens = new Set(
    tokenize(
      signals.audience,
      signals.objective,
      signals.desiredOutcome,
      signals.coreMessage,
      signals.deliveryContext,
      signals.afterUse,
      ...(signals.topics ?? []),
    ),
  );

  let score = 0;
  const matchedSignals: string[] = [];
  const penalties: string[] = [];

  const topicHits = includesAny(corpus, template.matching.topics);
  if (topicHits.length > 0) {
    score += Math.min(0.36, 0.18 + topicHits.length * 0.06);
    matchedSignals.push(`topics:${topicHits.slice(0, 3).join("|")}`);
  }

  const audienceHits = includesAny(corpus, template.matching.audiences);
  if (audienceHits.length > 0) {
    score += Math.min(0.24, 0.12 + audienceHits.length * 0.04);
    matchedSignals.push(`audience:${audienceHits.slice(0, 2).join("|")}`);
  }

  const deliveryHits = includesAny(corpus, template.matching.deliveryContexts);
  if (deliveryHits.length > 0) {
    score += Math.min(0.2, 0.1 + deliveryHits.length * 0.04);
    matchedSignals.push(`delivery:${deliveryHits.slice(0, 2).join("|")}`);
  }

  if (
    signals.preferredArgumentMode &&
    template.matching.argumentModes.includes(signals.preferredArgumentMode)
  ) {
    score += 0.12;
    matchedSignals.push(`argumentMode:${signals.preferredArgumentMode}`);
  } else if (signals.preferredArgumentMode) {
    score -= 0.08;
    penalties.push(`argumentMode-mismatch:${signals.preferredArgumentMode}`);
  }

  if (
    signals.preferredReadingMode &&
    template.matching.readingModes.includes(signals.preferredReadingMode)
  ) {
    score += 0.1;
    matchedSignals.push(`readingMode:${signals.preferredReadingMode}`);
  }

  if (signals.preferredDensity && template.matching.density.includes(signals.preferredDensity)) {
    score += 0.08;
    matchedSignals.push(`density:${signals.preferredDensity}`);
  }

  const required = signals.requiredCapabilities ?? [];
  for (const capability of required) {
    if (template.matching.capabilities.includes(capability)) {
      score += 0.05;
      matchedSignals.push(`capability:${capability}`);
    } else {
      score -= 0.5;
      penalties.push(`missing-capability:${capability}`);
    }
  }

  // Weak single-token matches should not dominate.
  const weakOnly = matchedSignals.length === 1 && score < 0.25;
  if (weakOnly && tokens.size <= 2) {
    score *= 0.5;
    penalties.push("weak-signal");
  }

  return {
    templateId: template.id,
    score: Number(score.toFixed(4)),
    matchedSignals,
    penalties,
  };
}

function findUploaded(
  uploaded: readonly TemplateDescriptor[],
  templateId: string,
  revisionId?: string,
): TemplateDescriptor | undefined {
  return uploaded.find(
    (item) => item.id === templateId && (!revisionId || item.revisionId === revisionId),
  );
}

function selectionFor(
  template: TemplateDescriptor,
  source: ResolvedTemplateSelection["source"],
  reasons: string[],
  options?: {
    confidence?: number;
    fallbackReason?: string;
  },
): ResolveTemplateResult {
  const selection = resolvedTemplateSelectionSchema.parse({
    templateId: template.id,
    templateRevisionId: template.revisionId,
    source,
    confidence: options?.confidence,
    reasons,
    fallbackReason: options?.fallbackReason,
    supportLevel: template.supportLevel,
  });
  return { selection, template, scores: [] };
}

function resolveDefaultTemplate(policy: ProjectTemplatePolicy): TemplateDescriptor {
  const builtin = getBuiltinTemplate(policy.defaultTemplateId);
  if (builtin?.fallbackEligible || builtin) {
    return builtin;
  }
  return requireBuiltinTemplate(APPLICATION_DEFAULT_TEMPLATE_ID);
}

/**
 * Deterministic template resolution. Models may supply signals / explicit
 * preferences; they must not invent template IDs outside the catalog/library.
 */
export function resolveProjectTemplate(input: ResolveTemplateInput): ResolveTemplateResult {
  const signals = input.signals ?? {};
  const uploaded = input.uploadedTemplates ?? [];
  const policy = input.policy;

  if (signals.explicitTemplateId) {
    const uploadedHit = findUploaded(uploaded, signals.explicitTemplateId);
    if (uploadedHit) {
      return selectionFor(uploadedHit, "explicit-custom", [
        `User selected uploaded template ${uploadedHit.id}`,
      ]);
    }
    const builtinHit = getBuiltinTemplate(signals.explicitTemplateId);
    if (builtinHit) {
      return selectionFor(builtinHit, "explicit-builtin", [
        `User selected builtin template ${builtinHit.id}`,
      ]);
    }
    throw new Error(`Unknown template id: ${signals.explicitTemplateId}`);
  }

  if (signals.explicitVisualStyle) {
    const template = getBuiltinTemplateByVisualStyle(signals.explicitVisualStyle as VisualStyle);
    if (!template) {
      throw new Error(`Unknown visual style: ${signals.explicitVisualStyle}`);
    }
    return selectionFor(template, "explicit-builtin", [
      `User named visual style ${signals.explicitVisualStyle}`,
    ]);
  }

  if (policy.mode === "custom") {
    const customId = policy.customTemplateId ?? "";
    const customRevision = policy.customTemplateRevisionId;
    const custom = findUploaded(uploaded, customId, customRevision);
    if (!custom) {
      throw new Error(
        `Project policy mode=custom pins ${customId}@${customRevision ?? "?"}, ` +
          "but that revision is missing under design/templates/**. " +
          "Re-import/apply the package or switch the policy away from custom.",
      );
    }
    return selectionFor(custom, "explicit-custom", [
      `Project policy mode=custom → ${custom.id}@${custom.revisionId}`,
    ]);
  }

  if (policy.mode === "default") {
    const template = resolveDefaultTemplate(policy);
    return selectionFor(template, "fallback", [`Project policy mode=default → ${template.id}`], {
      confidence: 1,
    });
  }

  // mode=auto
  const pool = listAutoPoolTemplates();
  const scores = pool
    .map((template) => scoreTemplate(template, signals))
    .filter((item) => !item.penalties.some((penalty) => penalty.startsWith("missing-capability:")))
    .sort(
      (left, right) => right.score - left.score || left.templateId.localeCompare(right.templateId),
    );

  const best = scores[0];
  const second = scores[1];
  const defaultTemplate = resolveDefaultTemplate(policy);

  if (
    !best ||
    best.score < AUTO_CONFIDENCE_THRESHOLD ||
    (second && best.score - second.score < AUTO_SCORE_GAP_THRESHOLD)
  ) {
    const fallbackReason =
      !best || best.score < AUTO_CONFIDENCE_THRESHOLD
        ? "low-confidence"
        : "ambiguous-top-candidates";
    const result = selectionFor(
      defaultTemplate,
      "fallback",
      [`Auto-match ${fallbackReason}; using project default ${defaultTemplate.id}`],
      {
        confidence: best?.score ?? 0,
        fallbackReason,
      },
    );
    return { ...result, scores };
  }

  const template = requireBuiltinTemplate(best.templateId);
  const confidence = Math.min(1, best.score);
  const result = selectionFor(
    template,
    "auto",
    [...best.matchedSignals, `score=${best.score.toFixed(2)}`],
    { confidence },
  );
  return { ...result, scores };
}

export function assertDesignSystemMatchesTemplate(
  designSystem: TemplateDescriptor["designSystem"],
  template: TemplateDescriptor,
): void {
  if (
    designSystem.argumentMode !== template.designSystem.argumentMode ||
    designSystem.visualStyle !== template.designSystem.visualStyle ||
    designSystem.readingMode !== template.designSystem.readingMode
  ) {
    throw new Error(
      `presentationDesignSystem axes must match template ${template.id} ` +
        `(${template.designSystem.visualStyle}).`,
    );
  }
}
