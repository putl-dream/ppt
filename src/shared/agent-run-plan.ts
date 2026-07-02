import type { AgentIntent } from "./ipc";
import type { Presentation } from "./presentation";
import {
  primaryProjectArtifactPaths,
  projectStageIds,
  type ProjectStageId,
} from "./project";
import {
  createDefaultBriefMarkdown,
  createDefaultDesignTheme,
  createDefaultOutlineMarkdown,
  createDefaultResearchMarkdown,
  normalizeDesignTheme,
  parseBriefFields,
  parseDesignTheme,
  parseOutlineItems,
  parseResearchNotes,
  serializeBriefMarkdown,
  serializeDesignTheme,
  serializeOutlineMarkdown,
  serializeResearchNotes,
} from "./project-artifacts";

export const REFERENCED_ARTIFACTS_BY_STAGE: Record<ProjectStageId, ProjectStageId[]> = {
  brief: [],
  outline: ["brief"],
  research: ["brief", "outline"],
  design: ["brief"],
  slides: ["brief", "outline", "research", "design"],
  deck: ["brief", "outline", "research", "design", "slides"],
};

const STAGE_PIPELINE_ORDER: ProjectStageId[] = [
  "brief",
  "outline",
  "research",
  "design",
  "slides",
  "deck",
];

const STAGE_KEYWORDS: Record<ProjectStageId, RegExp[]> = {
  brief: [/brief/i, /需求/, /受众/, /目的/, /brief/i],
  outline: [/outline/i, /大纲/, /结构/, /章节/],
  research: [/research/i, /资料/, /调研/, /素材/, /研究/],
  design: [/design/i, /设计系统/, /版式/, /配色/, /主题风格/],
  slides: [/storyboard/i, /分镜/, /逐页/, /页面方案/, /幻灯片方案/],
  deck: [/\bppt\b/i, /幻灯片/, /演示文稿/, /生成.*ppt/i, /排版/, /deck/i, /导出/],
};

const DEFAULT_SLIDES_STORYBOARD = JSON.stringify(
  [
    {
      title: "封面页",
      layout: "cover",
      keyPoints: ["智能硬件市场推广", "主讲人: AI 助手"],
      quote: "",
    },
  ],
  null,
  2,
);

const DEFAULT_DECK_SNAPSHOT = JSON.stringify(
  {
    title: "新演示文稿",
    slides: [],
  },
  null,
  2,
);

export type ArtifactContentMap = Partial<Record<ProjectStageId, string>>;

export interface AgentRunPlanInput {
  prompt: string;
  artifactContents: ArtifactContentMap;
  presentation?: Presentation;
}

export interface AgentRunPlan {
  stage: ProjectStageId;
  intent: AgentIntent;
  targetArtifactId?: ProjectStageId;
  targetPath?: string;
  referencedArtifactIds: ProjectStageId[];
}

function normalizeJson(value: string): string {
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value.trim();
  }
}

function outlineStructureKey(content: string): string {
  const items = parseOutlineItems(content);
  return JSON.stringify(
    items.map((item) => ({
      title: item.title,
      pages: item.pages,
      points: item.points,
    })),
  );
}

function researchStructureKey(content: string): string {
  const notes = parseResearchNotes(content);
  return JSON.stringify(
    notes.map((note) => ({
      source: note.source,
      quote: note.quote,
    })),
  );
}

function designStructureKey(content: string): string {
  return JSON.stringify(normalizeDesignTheme(parseDesignTheme(content)));
}

function slidesStructureKey(content: string): string {
  try {
    const parsed = JSON.parse(content);
    if (!Array.isArray(parsed)) return content.trim();
    return JSON.stringify(
      parsed.map((slide) => ({
        title: slide?.title ?? "",
        layout: slide?.layout ?? "",
        keyPoints: slide?.keyPoints ?? [],
        quote: slide?.quote ?? "",
      })),
    );
  } catch {
    return content.trim();
  }
}

function deckStructureKey(content: string): string {
  try {
    const parsed = JSON.parse(content) as { title?: string; slides?: unknown[] };
    return JSON.stringify({
      title: parsed.title ?? "新演示文稿",
      slideCount: Array.isArray(parsed.slides) ? parsed.slides.length : 0,
    });
  } catch {
    return content.trim();
  }
}

export function isDefaultArtifactContent(stage: ProjectStageId, content: string): boolean {
  const trimmed = content.trim();
  if (!trimmed) return true;

  switch (stage) {
    case "brief":
      return serializeBriefMarkdown(parseBriefFields(trimmed))
        === serializeBriefMarkdown(parseBriefFields(createDefaultBriefMarkdown()));
    case "outline":
      return outlineStructureKey(trimmed)
        === outlineStructureKey(createDefaultOutlineMarkdown());
    case "research":
      return researchStructureKey(trimmed)
        === researchStructureKey(createDefaultResearchMarkdown());
    case "design":
      return designStructureKey(trimmed)
        === designStructureKey(serializeDesignTheme(createDefaultDesignTheme()));
    case "slides":
      return slidesStructureKey(trimmed) === slidesStructureKey(DEFAULT_SLIDES_STORYBOARD);
    case "deck":
      return deckStructureKey(trimmed) === deckStructureKey(DEFAULT_DECK_SNAPSHOT);
    default:
      return false;
  }
}

export function hasMeaningfulArtifactContent(
  stage: ProjectStageId,
  content: string | undefined,
): boolean {
  if (!content?.trim()) return false;
  return !isDefaultArtifactContent(stage, content);
}

function presentationHasDeckContent(presentation?: Presentation): boolean {
  return Boolean(presentation && (presentation.revision > 0 || presentation.slides.length > 0));
}

function detectStageFromPrompt(prompt: string): ProjectStageId | undefined {
  const normalized = prompt.trim();
  if (!normalized) return undefined;

  const matches = STAGE_PIPELINE_ORDER
    .map((stage) => ({
      stage,
      score: STAGE_KEYWORDS[stage].reduce(
        (score, pattern) => score + (pattern.test(normalized) ? 1 : 0),
        0,
      ),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || (
      STAGE_PIPELINE_ORDER.indexOf(right.stage) - STAGE_PIPELINE_ORDER.indexOf(left.stage)
    ));

  return matches[0]?.stage;
}

export function inferAgentStage(input: AgentRunPlanInput): ProjectStageId {
  const hintedStage = detectStageFromPrompt(input.prompt);
  if (hintedStage) return hintedStage;

  if (presentationHasDeckContent(input.presentation)) {
    return "deck";
  }

  for (const stage of STAGE_PIPELINE_ORDER) {
    if (stage === "deck") continue;
    const content = input.artifactContents[stage];
    if (!hasMeaningfulArtifactContent(stage, content)) {
      return stage;
    }
  }

  return "deck";
}

export function inferAgentIntent(
  stage: ProjectStageId,
  artifactContents: ArtifactContentMap,
  presentation?: Presentation,
): AgentIntent {
  if (stage === "deck") {
    return presentationHasDeckContent(presentation) ? "revise-deck" : "generate-deck";
  }

  const content = artifactContents[stage];
  return hasMeaningfulArtifactContent(stage, content)
    ? "revise-artifact"
    : "generate-artifact";
}

export function buildAgentRunPlan(input: AgentRunPlanInput): AgentRunPlan {
  const stage = inferAgentStage(input);
  const intent = inferAgentIntent(stage, input.artifactContents, input.presentation);

  return {
    stage,
    intent,
    targetArtifactId: stage === "deck" ? undefined : stage,
    targetPath: primaryProjectArtifactPaths[stage],
    referencedArtifactIds: REFERENCED_ARTIFACTS_BY_STAGE[stage],
  };
}

export function artifactContentsFromRecord(
  contents: ArtifactContentMap,
): Record<ProjectStageId, string> {
  return Object.fromEntries(
    projectStageIds.map((stageId) => [stageId, contents[stageId] ?? ""]),
  ) as Record<ProjectStageId, string>;
}
