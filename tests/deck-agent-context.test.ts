import { describe, expect, it } from "vitest";
import { createStarterPresentation } from "../src/shared/presentation";
import { normalizeStoryboardSlide } from "../src/shared/storyboard";
import {
  extractOutlineTitles,
  formatDeckAgentContextForSystemPrompt,
  formatDeckAgentContextSummary,
  parseBriefSummary,
} from "../src/shared/deck-agent-context";
import { DeckContextBuilder } from "../src/main/deck/deck-context-builder";
import { planDeckBatches } from "../src/main/deck/deck-batch-planner";
import { SystemPromptBuilder } from "../src/main/agent/runtime/system-prompt";
import { askUserTool } from "../src/main/agent/tools/core/ask-user";
import { createDefaultDesignConstraints } from "../src/shared/deck-persistence";

describe("deck agent context helpers", () => {
  it("parses brief summary from form-style markdown", () => {
    const summary = parseBriefSummary(
      "# 演示文稿 Brief\n\n- **项目名称**: Q3 汇报\n- **核心目的**: 争取预算\n- **目标听众**: 管理层\n- **期望风格**: 专业简洁\n",
    );
    expect(summary.title).toBe("Q3 汇报");
    expect(summary.purpose).toBe("争取预算");
    expect(summary.audience).toBe("管理层");
    expect(summary.style).toBe("专业简洁");
  });

  it("extracts outline section titles without dumping full markdown", () => {
    const titles = extractOutlineTitles(
      "# Outline: Demo\n\n## 核心观点\n- one\n\n## 章节结构\n1. 开场\n2. 方案\n",
    );
    expect(titles).toContain("章节结构");
    expect(titles).toContain("开场");
    expect(titles).toContain("方案");
  });

  it("formats a compact DeckAgentContext summary without full presentation JSON", () => {
    const summary = formatDeckAgentContextSummary({
      deck: {
        title: "Demo Deck",
        theme: "modern-tech",
        palette: "blue-violet",
        totalSlides: 5,
        completedSlides: 2,
      },
      batch: {
        index: 1,
        slideSpecs: [
          {
            storyboardId: "sb-3",
            title: "Problem",
            keyPoints: ["pain point"],
            suggestedLayout: "concept",
            index: 2,
          },
        ],
      },
      design: {
        theme: { tone: "professional" },
        tone: "professional",
        audience: "executives",
        constraints: createDefaultDesignConstraints().forbidden.slice(0, 2),
      },
      neighbors: {
        previousSlide: { title: "Intro", layout: "cover" },
        nextSlide: { title: "Solution", keyPoints: ["approach"] },
      },
      editor: { selectedElementIds: [] },
      existingSlidesSummary: [{ id: "slide-1", title: "Cover", layout: "cover" }],
      outlineTitles: ["开场", "方案"],
    });

    expect(summary).toContain("DeckAgentContext");
    expect(summary).toContain("progress: 2/5");
    expect(summary).toContain("[sb-3]");
    expect(summary).toContain("Existing slides summary");
    expect(summary).not.toContain('"elements"');
    expect(summary).not.toContain("8000");
  });
});

describe("DeckContextBuilder", () => {
  it("assembles batch-scoped context from artifacts and presentation", async () => {
    const storyboard = Array.from({ length: 4 }, (_, index) =>
      normalizeStoryboardSlide(
        {
          id: `sb-${index + 1}`,
          title: `Slide ${index + 1}`,
          keyPoints: [`Point ${index + 1}`],
          layout: index === 0 ? "cover" : "concept",
          status: index < 2 ? "done" : "pending",
        },
        index,
      ),
    );
    const batches = planDeckBatches(storyboard);
    const batch = batches[1];
    const presentation = createStarterPresentation();
    presentation.title = "Batch Deck";
    presentation.slides = storyboard.slice(0, 2).map((slide, index) => ({
      id: `deck-${index + 1}`,
      title: slide.title,
      layout: slide.suggestedLayout,
      elements: [
        {
          id: `text-${index + 1}`,
          type: "text" as const,
          x: 80,
          y: 80,
          width: 400,
          height: 80,
          text: slide.title,
          fontSize: 32,
        },
      ],
    }));

    const artifacts = new Map<string, string>([
      [
        "brief.md",
        "# Brief: Batch Deck\n\n## 目的\n- 说明产品价值\n\n## 受众\n- 产品团队\n",
      ],
      ["outline.md", "# Outline\n\n1. 背景\n2. 方案\n"],
      ["design/theme.json", JSON.stringify({ tone: "professional", palette: { primary: "#2563eb" } })],
      ["design/constraints.json", JSON.stringify(createDefaultDesignConstraints())],
    ]);

    const builder = new DeckContextBuilder();
    const context = await builder.build({
      presentation,
      storyboard,
      batch,
      readArtifact: {
        read: async (path) => artifacts.get(path),
      },
    });

    expect(context.deck.completedSlides).toBe(2);
    expect(context.batch?.index).toBe(batch.batchIndex);
    expect(context.batch?.slideSpecs.length).toBe(batch.slideIndices.length);
    // batch[1] covers storyboard indices [1, 2]; presentation index 1 is in-batch, only cover (index 0) remains
    expect(context.existingSlidesSummary).toHaveLength(1);
    expect(context.existingSlidesSummary[0]?.title).toBe("Slide 1");
    expect(context.existingSlidesSummary[0]?.layout).toBe("cover");
    expect(context.design.constraints.length).toBeGreaterThan(0);
    expect(context.brief?.purpose).toContain("产品价值");
    expect(context.neighbors.previousSlide?.title).toBeTruthy();
  });
});

describe("SystemPromptBuilder deck context", () => {
  it("includes batch scope and design constraints when DeckAgentContext is provided", () => {
    const prompt = SystemPromptBuilder.build({
      coreTools: [askUserTool],
      deckAgentContext: {
        deck: {
          title: "Demo",
          theme: "modern-tech",
          palette: "blue-violet",
          totalSlides: 3,
          completedSlides: 1,
        },
        batch: {
          index: 1,
          slideSpecs: [
            {
              storyboardId: "sb-2",
              title: "Body",
              keyPoints: ["a"],
              suggestedLayout: "concept",
              index: 1,
            },
          ],
        },
        design: {
          theme: {},
          constraints: ["Do not duplicate titles"],
        },
        neighbors: {},
        editor: { selectedElementIds: [] },
        existingSlidesSummary: [],
      },
    });

    expect(prompt).toContain("批次范围约束");
    expect(prompt).toContain("仅生成 slides 2");
    expect(prompt).toContain("Do not duplicate titles");
    expect(formatDeckAgentContextForSystemPrompt({
      deck: {
        title: "Demo",
        theme: "modern-tech",
        palette: "blue-violet",
        totalSlides: 3,
        completedSlides: 1,
      },
      design: { theme: {}, constraints: ["rule-a"] },
      neighbors: {},
      editor: { selectedElementIds: [] },
      existingSlidesSummary: [],
      batch: {
        index: 0,
        slideSpecs: [{
          storyboardId: "sb-1",
          title: "Cover",
          keyPoints: [],
          index: 0,
        }],
      },
    })).toContain("rule-a");
  });
});
