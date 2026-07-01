import type { AgentEditorContext } from "@shared/ipc";
import type { Presentation } from "@shared/presentation";
import type { StoryboardSlideSpec } from "@shared/storyboard";
import type { DeckValidationIssue } from "@shared/deck-validation";
import type { DeckAgentContext, DeckAgentContextSlideSpec } from "@shared/deck-agent-context";
import {
  extractOutlineTitles,
  formatDeckAgentContextSummary,
  parseBriefSummary,
  parseDesignConstraints,
  parseThemeArtifact,
} from "@shared/deck-agent-context";
import type { DeckBatchPlan } from "./deck-batch-planner";

export interface DeckContextArtifactReader {
  read(path: string): Promise<string | undefined>;
}

export interface BuildDeckAgentContextInput {
  presentation: Presentation;
  storyboard: StoryboardSlideSpec[];
  batch?: DeckBatchPlan;
  editorContext?: AgentEditorContext;
  readArtifact: DeckContextArtifactReader;
  validationIssues?: DeckValidationIssue[];
}

function resolveLayout(slide: StoryboardSlideSpec): string {
  return slide.suggestedLayout ?? slide.layout ?? "concept";
}

function toBatchSlideSpec(
  spec: StoryboardSlideSpec,
  index: number,
): DeckAgentContextSlideSpec {
  return {
    storyboardId: spec.id,
    title: spec.title,
    keyPoints: spec.keyPoints,
    suggestedLayout: resolveLayout(spec),
    index,
  };
}

/**
 * 从 session presentation 与 project artifacts 组装分层 DeckAgentContext。
 */
export class DeckContextBuilder {
  async build(input: BuildDeckAgentContextInput): Promise<DeckAgentContext> {
    const [briefContent, outlineContent, themeContent, constraintsContent] = await Promise.all([
      input.readArtifact.read("brief.md"),
      input.readArtifact.read("outline.md"),
      input.readArtifact.read("design/theme.json"),
      input.readArtifact.read("design/constraints.json"),
    ]);

    const themeObject = parseThemeArtifact(themeContent ?? "{}");
    const brief = briefContent ? parseBriefSummary(briefContent) : undefined;
    const outlineTitles = outlineContent ? extractOutlineTitles(outlineContent) : undefined;
    const constraints = parseDesignConstraints(constraintsContent);

    const totalSlides = Math.max(input.storyboard.length, input.presentation.slides.length);
    const completedSlides = input.storyboard.filter((slide) => slide.status === "done").length;

    const batchIndices = new Set(input.batch?.slideIndices ?? []);
    const existingSlidesSummary = input.presentation.slides
      .filter((_, index) => !batchIndices.has(index))
      .map((slide) => ({
        id: slide.id,
        title: slide.title,
        layout: slide.layout,
      }));

    const neighbors = this.buildNeighbors(input.storyboard, input.batch);

    const context: DeckAgentContext = {
      deck: {
        title: input.presentation.title,
        theme: input.presentation.theme ?? "modern-tech",
        palette: input.presentation.palette ?? "blue-violet",
        totalSlides,
        completedSlides,
      },
      design: {
        theme: themeObject,
        tone: typeof themeObject.tone === "string" ? themeObject.tone : undefined,
        audience: brief?.audience,
        constraints,
      },
      neighbors,
      editor: {
        currentSlideId: input.editorContext?.currentSlideId,
        selectedElementIds: input.editorContext?.selectedElementIds ?? [],
      },
      existingSlidesSummary,
      brief,
      outlineTitles,
      validationIssues: input.validationIssues,
    };

    if (input.batch) {
      context.batch = {
        index: input.batch.batchIndex,
        slideSpecs: input.batch.slideIndices.map((index) =>
          toBatchSlideSpec(input.storyboard[index], index),
        ),
      };
    }

    return context;
  }

  private buildNeighbors(
    storyboard: StoryboardSlideSpec[],
    batch?: DeckBatchPlan,
  ): DeckAgentContext["neighbors"] {
    if (!batch || batch.slideIndices.length === 0) {
      return {};
    }

    const firstIndex = batch.slideIndices[0];
    const lastIndex = batch.slideIndices[batch.slideIndices.length - 1];
    const neighbors: DeckAgentContext["neighbors"] = {};

    if (firstIndex > 0) {
      const previousStoryboard = storyboard[firstIndex - 1];
      const previousPresentationIndex = firstIndex - 1;
      neighbors.previousSlide = {
        title: previousStoryboard?.title ?? `Slide ${firstIndex}`,
        layout: previousStoryboard ? resolveLayout(previousStoryboard) : undefined,
      };
      void previousPresentationIndex;
    }

    if (lastIndex + 1 < storyboard.length) {
      const nextStoryboard = storyboard[lastIndex + 1];
      neighbors.nextSlide = {
        title: nextStoryboard.title,
        keyPoints: nextStoryboard.keyPoints,
      };
    }

    return neighbors;
  }
}

export const deckContextBuilder = new DeckContextBuilder();

export function createArtifactReader(
  readFn: (path: string) => Promise<{ content?: string } | string | undefined>,
): DeckContextArtifactReader {
  return {
    async read(path: string): Promise<string | undefined> {
      const result = await readFn(path);
      if (typeof result === "string") return result;
      return result?.content;
    },
  };
}

export interface DeckAgentPromptMetadata {
  sessionId: string;
  stage: string;
  intent: string;
  targetArtifactId?: string;
  targetPath?: string;
}

export function buildDeckAgentStructuredPrompt(
  userPrompt: string,
  context: DeckAgentContext,
  metadata: DeckAgentPromptMetadata,
): string {
  return [
    "You are operating inside a file-native PPT creation workspace.",
    "Use the structured DeckAgentContext below as the source of truth. Do not assume the renderer state is authoritative.",
    "Do NOT rely on a full Presentation JSON dump — use existingSlidesSummary and ReadCurrentSlide when you need slide detail.",
    "",
    "User prompt:",
    userPrompt.trim(),
    "",
    "Run metadata:",
    `- sessionId: ${metadata.sessionId}`,
    `- stage: ${metadata.stage}`,
    `- intent: ${metadata.intent}`,
    `- targetArtifactId: ${metadata.targetArtifactId ?? "none"}`,
    `- targetPath: ${metadata.targetPath ?? "deck/snapshot.json"}`,
    "",
    formatDeckAgentContextSummary(context),
    "",
    metadata.stage === "deck"
      ? "For deck work, you MUST only return a command_proposal containing PresentationCommands. You are not allowed to return artifact_patch or ordinary message content as the final outcome."
      : "For artifact work, you MUST return an artifact_patch containing the proposed changes. Do not return command_proposal.",
  ].join("\n");
}
