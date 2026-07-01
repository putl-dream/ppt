import type { AgentEditorContext } from "./ipc";
import type { DeckValidationIssue } from "./deck-validation";
import type { DesignConstraints } from "./deck-persistence";
import { designConstraintsSchema } from "./deck-persistence";

export interface DeckAgentContextSlideSpec {
  storyboardId: string;
  title: string;
  keyPoints: string[];
  suggestedLayout?: string;
  index: number;
}

export interface DeckAgentContext {
  deck: {
    title: string;
    theme: string;
    palette: string;
    totalSlides: number;
    completedSlides: number;
  };
  batch?: {
    index: number;
    slideSpecs: DeckAgentContextSlideSpec[];
  };
  design: {
    theme: Record<string, unknown>;
    tone?: string;
    audience?: string;
    constraints: string[];
  };
  neighbors: {
    previousSlide?: { title: string; layout?: string };
    nextSlide?: { title: string; keyPoints: string[] };
  };
  editor: {
    currentSlideId?: string;
    selectedElementIds: string[];
  };
  existingSlidesSummary: Array<{
    id: string;
    title: string;
    layout?: string;
  }>;
  brief?: {
    title?: string;
    purpose?: string;
    audience?: string;
    style?: string;
  };
  outlineTitles?: string[];
  validationIssues?: DeckValidationIssue[];
}

export interface BriefSummary {
  title?: string;
  purpose?: string;
  audience?: string;
  style?: string;
}

export function parseBriefSummary(content: string): BriefSummary {
  const summary: BriefSummary = {};

  const formPatterns: Array<[keyof BriefSummary, RegExp]> = [
    ["title", /-\s+\*\*项目名称\*\*:\s*(.*)/],
    ["purpose", /-\s+\*\*核心目的\*\*:\s*(.*)/],
    ["audience", /-\s+\*\*目标听众\*\*:\s*(.*)/],
    ["style", /-\s+\*\*期望风格\*\*:\s*(.*)/],
  ];

  for (const [key, pattern] of formPatterns) {
    const match = content.match(pattern);
    if (match?.[1]?.trim()) summary[key] = match[1].trim();
  }

  const sectionPatterns: Array<[keyof BriefSummary, RegExp]> = [
    ["purpose", /##\s*目的\s*\n([\s\S]*?)(?=\n##|\n$)/i],
    ["audience", /##\s*受众\s*\n([\s\S]*?)(?=\n##|\n$)/i],
    ["style", /##\s*方向\s*\n([\s\S]*?)(?=\n##|\n$)/i],
  ];

  for (const [key, pattern] of sectionPatterns) {
    if (summary[key]) continue;
    const match = content.match(pattern);
    if (!match?.[1]) continue;
    const line = match[1]
      .split("\n")
      .map((item) => item.replace(/^-\s*/, "").trim())
      .find(Boolean);
    if (line) summary[key] = line.slice(0, 200);
  }

  const titleMatch = content.match(/^#\s*(?:Brief:\s*)?(.+)$/m);
  if (!summary.title && titleMatch?.[1]?.trim()) {
    summary.title = titleMatch[1].trim();
  }

  return summary;
}

export function extractOutlineTitles(content: string): string[] {
  const titles: string[] = [];
  for (const line of content.split("\n")) {
    const heading = line.match(/^#{1,3}\s+(.+)$/);
    if (heading?.[1]) {
      const title = heading[1].trim();
      if (!/^outline:/i.test(title) && !/^核心观点$/i.test(title) && !/^待确认问题$/i.test(title)) {
        titles.push(title);
      }
      continue;
    }
    const numbered = line.match(/^\d+\.\s+(.+)$/);
    if (numbered?.[1]) titles.push(numbered[1].trim());
  }
  return titles.slice(0, 30);
}

export function parseThemeArtifact(content: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(content);
    return typeof parsed === "object" && parsed !== null ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export function parseDesignConstraints(content: string | undefined): string[] {
  if (!content?.trim()) return [];
  try {
    const parsed = designConstraintsSchema.parse(JSON.parse(content));
    return parsed.forbidden;
  } catch {
    return [];
  }
}

export function parseDesignConstraintsObject(content: string | undefined): DesignConstraints | undefined {
  if (!content?.trim()) return undefined;
  try {
    return designConstraintsSchema.parse(JSON.parse(content));
  } catch {
    return undefined;
  }
}

export function formatDeckAgentContextSummary(context: DeckAgentContext): string {
  const lines: string[] = [
    "## DeckAgentContext (structured summary — not full Presentation JSON)",
    "",
    "### Deck overview",
    `- title: ${context.deck.title}`,
    `- theme: ${context.deck.theme}`,
    `- palette: ${context.deck.palette}`,
    `- progress: ${context.deck.completedSlides}/${context.deck.totalSlides} slides completed`,
    "",
  ];

  if (context.brief && Object.values(context.brief).some(Boolean)) {
    lines.push("### Brief summary");
    if (context.brief.title) lines.push(`- title: ${context.brief.title}`);
    if (context.brief.purpose) lines.push(`- purpose: ${context.brief.purpose}`);
    if (context.brief.audience) lines.push(`- audience: ${context.brief.audience}`);
    if (context.brief.style) lines.push(`- style: ${context.brief.style}`);
    lines.push("");
  }

  if (context.outlineTitles && context.outlineTitles.length > 0) {
    lines.push("### Outline titles");
    for (const title of context.outlineTitles) {
      lines.push(`- ${title}`);
    }
    lines.push("");
  }

  if (context.batch) {
    lines.push(`### Current batch (index ${context.batch.index})`);
    for (const spec of context.batch.slideSpecs) {
      lines.push(
        `- Slide ${spec.index + 1} [${spec.storyboardId}] layout=${spec.suggestedLayout ?? "concept"} title="${spec.title}"`,
      );
      if (spec.keyPoints.length > 0) {
        lines.push(`  keyPoints: ${spec.keyPoints.join(" | ")}`);
      }
    }
    lines.push("");
  }

  lines.push("### Design contract");
  if (context.design.tone) lines.push(`- tone: ${context.design.tone}`);
  if (context.design.audience) lines.push(`- audience: ${context.design.audience}`);
  if (context.design.constraints.length > 0) {
    lines.push("- constraints:");
    for (const rule of context.design.constraints) {
      lines.push(`  - ${rule}`);
    }
  }
  lines.push("");

  if (context.neighbors.previousSlide || context.neighbors.nextSlide) {
    lines.push("### Narrative neighbors");
    if (context.neighbors.previousSlide) {
      lines.push(
        `- previous: "${context.neighbors.previousSlide.title}"${context.neighbors.previousSlide.layout ? ` (${context.neighbors.previousSlide.layout})` : ""}`,
      );
    }
    if (context.neighbors.nextSlide) {
      lines.push(`- next: "${context.neighbors.nextSlide.title}"`);
      if (context.neighbors.nextSlide.keyPoints.length > 0) {
        lines.push(`  keyPoints: ${context.neighbors.nextSlide.keyPoints.join(" | ")}`);
      }
    }
    lines.push("");
  }

  if (context.existingSlidesSummary.length > 0) {
    lines.push("### Existing slides summary (use ReadCurrentSlide for full detail when editing)");
    for (const slide of context.existingSlidesSummary) {
      lines.push(`- [${slide.id}] ${slide.title}${slide.layout ? ` (${slide.layout})` : ""}`);
    }
    lines.push("");
  }

  if (context.validationIssues && context.validationIssues.length > 0) {
    lines.push("### Validation issues to fix");
    for (const issue of context.validationIssues) {
      lines.push(
        `- [${issue.severity}] ${issue.category}${issue.slideId ? ` slide=${issue.slideId}` : ""}: ${issue.message}`,
      );
      if (issue.fixHint) lines.push(`  fixHint: ${issue.fixHint}`);
    }
    lines.push("");
  }

  if (context.editor.currentSlideId || context.editor.selectedElementIds.length > 0) {
    lines.push("### Editor focus");
    lines.push(`- currentSlideId: ${context.editor.currentSlideId ?? "none"}`);
    lines.push(`- selectedElementIds: ${context.editor.selectedElementIds.join(", ") || "none"}`);
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}

export function formatDeckAgentContextForSystemPrompt(context: DeckAgentContext): string {
  const lines: string[] = ["## Deck 生成上下文"];

  if (context.batch) {
    const slideNumbers = context.batch.slideSpecs.map((spec) => spec.index + 1).join(", ");
    lines.push("");
    lines.push("### 批次范围约束");
    lines.push(`- 当前批次 index=${context.batch.index}，仅生成 slides ${slideNumbers}。`);
    lines.push(`- 禁止修改已完成页（index < ${context.batch.slideSpecs[0]?.index ?? 0}），除非用户明确要求 revise。`);
    lines.push("- 完整 Presentation JSON 未注入；已有页见 existingSlidesSummary，编辑时用 ReadCurrentSlide。");
  }

  if (context.design.constraints.length > 0) {
    lines.push("");
    lines.push("### 设计约束 (design/constraints.json)");
    for (const rule of context.design.constraints) {
      lines.push(`- ${rule}`);
    }
  }

  const themeTone = context.design.tone ?? (typeof context.design.theme.tone === "string" ? context.design.theme.tone : undefined);
  if (themeTone) {
    lines.push("");
    lines.push(`### 主题基调: ${themeTone}`);
  }

  return lines.join("\n");
}

export function mergeEditorContext(
  context: DeckAgentContext,
  editorContext?: AgentEditorContext,
): DeckAgentContext {
  if (!editorContext) return context;
  return {
    ...context,
    editor: {
      currentSlideId: editorContext.currentSlideId,
      selectedElementIds: [...editorContext.selectedElementIds],
    },
  };
}
