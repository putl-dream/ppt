import { describe, expect, it } from "vitest";
import {
  defaultProjectArtifacts,
  getPrimaryProjectArtifactPath,
  primaryProjectArtifactPaths,
  projectArtifactFilePaths,
  projectStageIds,
} from "@shared/project";

describe("project artifact mapping", () => {
  it("keeps renderer stages aligned with persisted project artifacts", () => {
    expect(projectStageIds).toEqual(["brief", "outline", "research", "slides", "design", "deck"]);
    expect(defaultProjectArtifacts.map((artifact) => artifact.id)).toEqual([
      "brief",
      "outline",
      "research",
      "slides",
      "design",
      "deck",
      "history",
    ]);
  });

  it("maps directory artifacts to their primary editable files", () => {
    const artifactById = new Map(defaultProjectArtifacts.map((artifact) => [artifact.id, artifact]));

    expect(artifactById.get("slides")).toMatchObject({
      path: "slides/",
      kind: "slide-plan",
    });
    expect(primaryProjectArtifactPaths.slides).toBe("slides/storyboard.json");
    expect(getPrimaryProjectArtifactPath(artifactById.get("research")!)).toBe("research/notes.md");
    expect(getPrimaryProjectArtifactPath(artifactById.get("design")!)).toBe("design/theme.json");
    expect(getPrimaryProjectArtifactPath(artifactById.get("deck")!)).toBe("deck/snapshot.json");
    expect(projectArtifactFilePaths.designConstraints).toBe("design/constraints.json");
    expect(projectArtifactFilePaths.deckGenerationJobs).toBe("deck/generation-jobs.json");
    expect(projectArtifactFilePaths.exportHistory).toBe("history/exports.json");
  });
});
