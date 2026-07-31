import { describe, expect, it, vi } from "vitest";
import { ToolPreflight } from
  "../src/main/agent/runtime/tools/tool-preflight";
import type {
  PptLifecycleToolBridge,
  ToolContext,
} from "../src/main/agent/tools/tool-definition";
import { createDefaultToolRegistry } from
  "../src/main/agent/tools/tool-registry";
import { WorkspaceFileService } from
  "../src/main/agent/tools/files/workspace-file-service";
import {
  asPptCapabilityRequestId,
  asPptJobId,
  asPresentationId,
  asQueryId,
  pptJobProjectionSchema,
  type PptCapability,
  type PptJobProjection,
} from "../src/shared/presentation-lifecycle";
import { createStarterPresentation } from "../src/shared/presentation";

const PRESENTATION_TOOL_NAMES = [
  "ExecuteLayoutPlan",
  "GetDesignReference",
  "InsertSlideImage",
  "PreviewCommands",
  "PreviewSlide",
  "PreviewSvgPage",
  "SearchSlideImages",
  "SubmitCommands",
  "SubmitPptReview",
  "SubmitSvgDeck",
  "WriteFile",
  "EditFile",
  "AnalyzeDeckConsistency",
  "ApplyDesignSystem",
  "ApplyTypography",
  "AutoLayoutSlide",
  "BeautifyChart",
  "BeautifyTable",
  "CompressText",
  "DetectOverflowText",
  "DetectRepeatedTitles",
  "ResolveDesignPlan",
  "RewriteSlideContent",
  "UpdateSlideVariant",
  "ValidateDeckLayout",
] as const;

function projection(capability: PptCapability): PptJobProjection {
  return pptJobProjectionSchema.parse({
    jobId: asPptJobId("job-capability-test"),
    presentationId: asPresentationId("presentation-capability-test"),
    capability,
    requestId: asPptCapabilityRequestId("request-capability-test"),
    queryId: asQueryId("query-capability-test"),
    status: "running",
    stage: "intent",
    stateRevision: 1,
    committedArtifacts: [],
    staleArtifacts: [],
    updatedAt: "2026-07-31T00:00:00.000Z",
  });
}

function lifecycleBridge(
  activeCapability?: PptCapability,
): PptLifecycleToolBridge & {
  requireActiveCapability: ReturnType<typeof vi.fn>;
} {
  const activeProjection = activeCapability
    ? projection(activeCapability)
    : undefined;
  const requireActiveCapability = vi.fn(
    (allowedCapabilities?: readonly PptCapability[]) => {
      if (!activeProjection) {
        throw new Error("Call BeginPptCapability before using Presentation tools.");
      }
      if (
        allowedCapabilities
        && !allowedCapabilities.includes(activeProjection.capability)
      ) {
        throw new Error(
          `PPT capability ${activeProjection.capability} cannot use this tool.`,
        );
      }
      return activeProjection;
    },
  );
  return {
    queryId: asQueryId("query-capability-test"),
    withTransaction: (operation) => operation(),
    observeArtifactChanges: async () => undefined,
    beginCapability: ({ capability }) => projection(capability),
    requireActiveCapability,
    commitArtifact: () => {
      throw new Error("not used");
    },
    storeBlob: async () => {
      throw new Error("not used");
    },
    assertBlob: async () => undefined,
    submitReview: () => {
      throw new Error("not used");
    },
  };
}

function context(
  lifecycle?: PptLifecycleToolBridge,
): ToolContext {
  const registry = createDefaultToolRegistry();
  return {
    presentation: createStarterPresentation(),
    selectedElementIds: [],
    discoverySession: {
      discoveredToolNames: new Set(["ApplyDesignSystem"]),
    },
    registry,
    messageHistory: [],
    workspaceRoot: "C:\\workspace",
    fileService: new WorkspaceFileService("C:\\workspace"),
    presentationLifecycle: lifecycle,
  };
}

async function prepare(
  input: {
    name: string;
    args: Record<string, unknown>;
    lifecycle?: PptLifecycleToolBridge;
  },
) {
  const toolContext = context(input.lifecycle);
  return new ToolPreflight(toolContext.registry).prepare({
    toolCall: {
      type: "tool_use",
      id: `call-${input.name}`,
      name: input.name,
      input: input.args,
    },
    context: toolContext,
    threadId: "thread-capability-test",
    requestToolApproval: async () => true,
    policyGuidance: async () => undefined,
  });
}

describe("Presentation tool capability preflight", () => {
  it("marks every product Presentation work tool with an explicit capability contract", () => {
    const registry = createDefaultToolRegistry();
    for (const name of PRESENTATION_TOOL_NAMES) {
      expect(
        registry.get(name)?.behavior?.presentation?.allowedCapabilities,
        name,
      ).toBeTruthy();
    }
  });

  it("rejects a core Presentation tool before BeginPptCapability", async () => {
    const lifecycle = lifecycleBridge();
    const result = await prepare({
      name: "InsertSlideImage",
      args: {
        slideId: createStarterPresentation().slides[0].id,
        url: "data:image/png;base64,iVBORw0KGgo=",
        slot: "hero",
      },
      lifecycle,
    });

    expect(result).toMatchObject({
      type: "immediate_result",
      kind: "unavailable",
      outcome: {
        error: expect.stringContaining("BeginPptCapability"),
      },
    });
    expect(lifecycle.requireActiveCapability).toHaveBeenCalledWith([
      "edit",
      "restyle",
    ]);
  });

  it("checks the resolved deferred tool and rejects a capability mismatch", async () => {
    const lifecycle = lifecycleBridge("create");
    const result = await prepare({
      name: "ExecuteExtraTool",
      args: {
        toolName: "ApplyDesignSystem",
        toolArgs: {
          designSystem: createStarterPresentation().designSystem,
        },
      },
      lifecycle,
    });

    expect(result).toMatchObject({
      type: "immediate_result",
      kind: "unavailable",
      tool: { name: "ApplyDesignSystem" },
      outcome: {
        error: expect.stringContaining("cannot use this tool"),
      },
    });
    expect(lifecycle.requireActiveCapability).toHaveBeenCalledWith([
      "edit",
      "restyle",
    ]);
  });

  it("allows a review capability to render and record an SVG preview", async () => {
    const lifecycle = lifecycleBridge("review");
    const result = await prepare({
      name: "PreviewSvgPage",
      args: { path: "slides/svg/P01.svg" },
      lifecycle,
    });

    expect(result).toMatchObject({ type: "ready" });
    expect(lifecycle.requireActiveCapability).toHaveBeenCalledWith([
      "create",
      "edit",
      "restyle",
      "review",
    ]);
  });

  it("guards Presentation-owned writes but leaves unrelated workspace writes alone", async () => {
    const lifecycle = lifecycleBridge();
    const guarded = await prepare({
      name: "WriteFile",
      args: {
        path: "draft/../slides/svg/P01.svg",
        content: "<svg />",
      },
      lifecycle,
    });
    expect(guarded).toMatchObject({
      type: "immediate_result",
      kind: "unavailable",
    });

    const unrelated = await prepare({
      name: "WriteFile",
      args: {
        path: "notes/research.md",
        content: "Research notes",
      },
      lifecycle,
    });
    expect(unrelated).toMatchObject({ type: "ready" });
  });

  it("keeps Presentation tools available to isolated runtimes without a lifecycle bridge", async () => {
    const result = await prepare({
      name: "ExecuteExtraTool",
      args: {
        toolName: "ApplyDesignSystem",
        toolArgs: {
          designSystem: createStarterPresentation().designSystem,
        },
      },
    });

    expect(result).toMatchObject({
      type: "ready",
      prepared: {
        tool: { name: "ApplyDesignSystem" },
      },
    });
  });
});
