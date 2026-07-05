import { access, constants, readFile } from "node:fs/promises";
import { join } from "node:path";

import { LAYOUT_PLAN_PATH } from "@shared/layout-plan";
import {
  isDefaultBriefMarkdown,
  isDefaultOutlineMarkdown,
} from "@shared/project-artifacts";
import { isDefaultStoryboardContent } from "@shared/storyboard";

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

async function meaningfulMarkdownExists(
  path: string,
  isDefaultContent: (content: string) => boolean,
): Promise<boolean> {
  try {
    const content = await readFile(path, "utf8");
    return content.trim().length > 0 && !isDefaultContent(content);
  } catch {
    return false;
  }
}

async function meaningfulStoryboardExists(path: string): Promise<boolean> {
  try {
    const content = await readFile(path, "utf8");
    return content.trim().length > 0 && !isDefaultStoryboardContent(content);
  } catch {
    return false;
  }
}

/** Probe workspace files — drives stage resolution, not message keywords. */
export async function probeWorkspaceArtifacts(workspaceRoot?: string): Promise<WorkspaceArtifacts> {
  if (!workspaceRoot) return { ...EMPTY_ARTIFACTS };

  const [brief, outline, storyboard, layoutPlan] = await Promise.all([
    meaningfulMarkdownExists(join(workspaceRoot, "brief.md"), isDefaultBriefMarkdown),
    meaningfulMarkdownExists(join(workspaceRoot, "outline.md"), isDefaultOutlineMarkdown),
    meaningfulStoryboardExists(join(workspaceRoot, "slides/storyboard.json")),
    fileExists(join(workspaceRoot, LAYOUT_PLAN_PATH)),
  ]);

  return { brief, outline, storyboard, layoutPlan };
}
