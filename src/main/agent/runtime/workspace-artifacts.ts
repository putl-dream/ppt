import { access, constants } from "node:fs/promises";
import { join } from "node:path";

import { LAYOUT_PLAN_PATH } from "@shared/layout-plan";

export interface WorkspaceArtifacts {
  brief: boolean;
  outline: boolean;
  storyboard: boolean;
  layoutPlan: boolean;
}

const EMPTY_ARTIFACTS: WorkspaceArtifacts = {
  brief: false,
  outline: false,
  storyboard: false,
  layoutPlan: false,
};

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/** Probe workspace files — drives stage resolution, not message keywords. */
export async function probeWorkspaceArtifacts(workspaceRoot?: string): Promise<WorkspaceArtifacts> {
  if (!workspaceRoot) return { ...EMPTY_ARTIFACTS };

  const [brief, outline, storyboard, layoutPlan] = await Promise.all([
    fileExists(join(workspaceRoot, "brief.md")),
    fileExists(join(workspaceRoot, "outline.md")),
    fileExists(join(workspaceRoot, "slides/storyboard.json")),
    fileExists(join(workspaceRoot, LAYOUT_PLAN_PATH)),
  ]);

  return { brief, outline, storyboard, layoutPlan };
}
