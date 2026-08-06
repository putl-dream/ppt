import {
  defaultProjectArtifacts,
  getPrimaryProjectArtifactPath,
  primaryProjectArtifactPaths,
  projectArtifactFilePaths,
  projectArtifactIds,
} from "@shared/project";
import { describe, expect, it } from "vitest";

describe("project artifact mapping", () => {
  it("registers SVG-native author files before optional references", () => {
    expect(projectArtifactIds).toEqual([
      "design-spec",
      "template-policy",
      "page-plan",
      "page-svg",
      "assets",
      "deck",
      "export-history",
      "brief",
      "outline",
      "research",
    ]);
    expect(defaultProjectArtifacts.map((artifact) => artifact.id)).toEqual([
      "design-spec",
      "template-policy",
      "page-plan",
      "page-svg",
      "assets",
      "deck",
      "export-history",
      "brief",
      "outline",
      "research",
    ]);
    expect(defaultProjectArtifacts.every((artifact) => !("status" in artifact))).toBe(true);
    expect(defaultProjectArtifacts.every((artifact) => !("dependsOn" in artifact))).toBe(true);
  });

  it("maps lifecycle author files and optional references to stable paths", () => {
    const artifactById = new Map(
      defaultProjectArtifacts.map((artifact) => [artifact.id, artifact]),
    );

    expect(artifactById.get("page-svg")).toMatchObject({
      path: "slides/svg/",
      kind: "page-svg",
    });
    expect(primaryProjectArtifactPaths["design-spec"]).toBe("design/design-spec.json");
    expect(primaryProjectArtifactPaths["template-policy"]).toBe("design/template-policy.json");
    expect(primaryProjectArtifactPaths["page-plan"]).toBe("slides/page-plan.json");
    expect(primaryProjectArtifactPaths["page-svg"]).toBe("slides/svg/");
    expect(primaryProjectArtifactPaths.assets).toBe("assets/");
    expect(primaryProjectArtifactPaths["export-history"]).toBe("history/exports.json");
    expect(getPrimaryProjectArtifactPath(artifactById.get("research")!)).toBe("research/notes.md");
    expect(getPrimaryProjectArtifactPath(artifactById.get("deck")!)).toBe("deck/snapshot.json");
    expect(projectArtifactFilePaths.designConstraints).toBe("design/constraints.json");
    expect(projectArtifactFilePaths.brandProfile).toBe("design/brand-profile.json");
    expect(projectArtifactFilePaths.deckGenerationJobs).toBe("deck/generation-jobs.json");
    expect(projectArtifactFilePaths.exportHistory).toBe("history/exports.json");
  });
});
