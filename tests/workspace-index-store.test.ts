import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WorkspaceIndexStore } from "@main/workspace-index-store";
import { getWorkspaceSessionSnapshotPath } from "@shared/workspace-meta";
import { DEFAULT_DESIGN_SYSTEM } from "@design-system";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("WorkspaceIndexStore", () => {
  it("repairs non-positive geometry when reading a workspace snapshot", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "agent-ppt-workspace-index-"));
    temporaryDirectories.push(rootPath);
    const sessionId = "session-corrupt";
    const snapshotPath = getWorkspaceSessionSnapshotPath(rootPath, sessionId);
    await mkdir(dirname(snapshotPath), { recursive: true });
    await writeFile(
      snapshotPath,
      `${JSON.stringify({
        version: 1,
        session: {
          id: sessionId,
          title: "恢复测试",
          createdAt: "2026-07-10T00:00:00.000Z",
          updatedAt: "2026-07-10T00:00:00.000Z",
          slideCount: 1,
          revision: 1,
        },
        presentation: {
          id: "presentation-1",
          title: "恢复测试",
          revision: 1,
          designSystem: DEFAULT_DESIGN_SYSTEM,
          slides: [
            {
              id: "slide-1",
              title: "高密度列表",
              elements: [
                {
                  id: "text-1",
                  type: "text",
                  x: 120,
                  y: 200,
                  width: 1000,
                  height: -4.57,
                  text: "保留内容",
                  fontSize: 20,
                },
              ],
            },
          ],
        },
        messages: [],
        project: { rootPath, artifacts: [] },
      })}\n`,
      "utf8",
    );

    const store = new WorkspaceIndexStore();
    const restored = await store.readSessionSnapshot(rootPath, sessionId);

    expect(restored?.presentation.slides[0]?.elements[0]?.height).toBe(16);
    const persisted = JSON.parse(await readFile(snapshotPath, "utf8"));
    expect(persisted.presentation.slides[0].elements[0].height).toBe(16);
  });
});
