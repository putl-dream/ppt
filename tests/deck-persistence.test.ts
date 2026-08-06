import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileSessionStore } from "@main/session-store";
import type { DeckGenerationJob } from "@shared/deck-persistence";
import { createSvgTestSlide } from "@shared/presentation-fixtures";
import { projectArtifactFilePaths } from "@shared/project";
import { afterEach, describe, expect, it } from "vitest";
import { TEST_DESIGN_SYSTEM } from "./design-engine-test-utils";

const temporaryDirectories: string[] = [];
const stores: FileSessionStore[] = [];

async function createStore() {
  const directory = await mkdtemp(join(tmpdir(), "agent-ppt-deck-persist-"));
  temporaryDirectories.push(directory);
  const filePath = join(directory, "conversations.sqlite");
  const store = new FileSessionStore(filePath);
  stores.push(store);
  await store.initialize();
  return { store, filePath };
}

afterEach(async () => {
  for (const store of stores.splice(0)) store.close();
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("deck persistence (problem 2)", () => {
  it("materializes the SVG-native project scaffold without legacy authoring facts", async () => {
    const { store } = await createStore();
    const created = await store.createSession();
    const sessionId = created.activeSession!.session.id;
    const rootPath = store.getSession(sessionId).project!.rootPath;

    const exportsFile = JSON.parse(
      await readFile(join(rootPath, projectArtifactFilePaths.exportHistory), "utf8"),
    );
    expect(exportsFile.exports).toEqual([]);
    await expect(
      readFile(join(rootPath, projectArtifactFilePaths.designConstraints), "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      readFile(join(rootPath, projectArtifactFilePaths.deckGenerationJobs), "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(join(rootPath, "slides/storyboard.json"), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(readFile(join(rootPath, "slides/layout-plan.json"), "utf8")).rejects.toMatchObject(
      { code: "ENOENT" },
    );
  });

  it("syncs deck/snapshot.json on savePresentation without marking history stale", async () => {
    const { store } = await createStore();
    const created = await store.createSession();
    const sessionId = created.activeSession!.session.id;
    const rootPath = store.getSession(sessionId).project!.rootPath;

    const presentation = {
      id: "pres-id",
      title: "Persist Mirror Test",
      revision: 7,
      designSystem: TEST_DESIGN_SYSTEM,
      slides: [createSvgTestSlide({ id: "slide-1", title: "Slide One" })],
    };

    await store.savePresentation(sessionId, presentation);

    const deckSnapshot = JSON.parse(
      await readFile(join(rootPath, "deck", "snapshot.json"), "utf8"),
    );
    expect(deckSnapshot).toEqual(presentation);

    const exportHistoryArtifact = store
      .listProjectArtifacts(sessionId)
      .find((artifact) => artifact.id === "export-history");
    expect(exportHistoryArtifact).toMatchObject({
      path: "history/exports.json",
      kind: "export-history",
    });
    expect(exportHistoryArtifact).not.toHaveProperty("status");
  });

  it("persists generation jobs through GenerationJobsService", async () => {
    const { store } = await createStore();
    const created = await store.createSession();
    const sessionId = created.activeSession!.session.id;
    const rootPath = store.getSession(sessionId).project!.rootPath;

    const job: DeckGenerationJob = {
      id: "job-1",
      sessionId,
      storyboardPath: "slides/storyboard.json",
      batchSize: 2,
      completedBatches: 1,
      totalBatches: 5,
      status: "running",
      lastRevision: 3,
    };

    await store.writeGenerationJobs(sessionId, { jobs: [job] });

    const saved = JSON.parse(
      await readFile(join(rootPath, projectArtifactFilePaths.deckGenerationJobs), "utf8"),
    );
    expect(saved.jobs).toEqual([job]);
    expect(await store.readGenerationJobs(sessionId)).toEqual({ jobs: [job] });
  });

  it("appends export records to history/exports.json", async () => {
    const { store } = await createStore();
    const created = await store.createSession();
    const sessionId = created.activeSession!.session.id;
    const rootPath = store.getSession(sessionId).project!.rootPath;
    const presentation = store.getSession(sessionId).presentation;

    await store.recordDeckExport(sessionId, {
      revision: presentation.revision,
      filePath: "C:/exports/demo.pptx",
      designSystem: TEST_DESIGN_SYSTEM,
      exportedAt: "2026-07-01T12:00:00.000Z",
    });

    const history = JSON.parse(
      await readFile(join(rootPath, projectArtifactFilePaths.exportHistory), "utf8"),
    );
    expect(history.exports).toEqual([
      {
        revision: presentation.revision,
        filePath: "C:/exports/demo.pptx",
        designSystem: TEST_DESIGN_SYSTEM,
        exportedAt: "2026-07-01T12:00:00.000Z",
      },
    ]);
    expect(await store.readExportHistory(sessionId)).toEqual(history);
  });
});
