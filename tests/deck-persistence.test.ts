import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { FileSessionStore } from "@main/session-store";
import { projectArtifactFilePaths } from "@shared/project";
import type { DeckGenerationJob } from "@shared/deck-persistence";

const temporaryDirectories: string[] = [];

async function createStore() {
  const directory = await mkdtemp(join(tmpdir(), "agent-ppt-deck-persist-"));
  temporaryDirectories.push(directory);
  const filePath = join(directory, "sessions.json");
  const store = new FileSessionStore(filePath);
  await store.initialize();
  return { store, filePath };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("deck persistence (problem 2)", () => {
  it("materializes design constraints, generation jobs, and export history templates", async () => {
    const { store } = await createStore();
    const created = await store.createSession();
    const sessionId = created.activeSession!.session.id;
    const rootPath = store.getSession(sessionId).project!.rootPath;

    const constraints = JSON.parse(
      await readFile(join(rootPath, projectArtifactFilePaths.designConstraints), "utf8"),
    );
    expect(constraints.typography.titleMinFontSize).toBe(36);
    expect(constraints.forbidden.length).toBeGreaterThan(0);

    const jobs = JSON.parse(
      await readFile(join(rootPath, projectArtifactFilePaths.deckGenerationJobs), "utf8"),
    );
    expect(jobs.jobs).toEqual([]);

    const exportsFile = JSON.parse(
      await readFile(join(rootPath, projectArtifactFilePaths.exportHistory), "utf8"),
    );
    expect(exportsFile.exports).toEqual([]);
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
      slides: [{ id: "slide-1", title: "Slide One", elements: [] }],
    };

    await store.savePresentation(sessionId, presentation);

    const deckSnapshot = JSON.parse(
      await readFile(join(rootPath, "deck", "snapshot.json"), "utf8"),
    );
    expect(deckSnapshot).toEqual(presentation);

    const historyArtifact = store
      .listProjectArtifacts(sessionId)
      .find((artifact) => artifact.id === "history");
    expect(historyArtifact?.status).not.toBe("stale");
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
      theme: "ocean",
      palette: "purple",
      exportedAt: "2026-07-01T12:00:00.000Z",
    });

    const history = JSON.parse(
      await readFile(join(rootPath, projectArtifactFilePaths.exportHistory), "utf8"),
    );
    expect(history.exports).toEqual([
      {
        revision: presentation.revision,
        filePath: "C:/exports/demo.pptx",
        theme: "ocean",
        palette: "purple",
        exportedAt: "2026-07-01T12:00:00.000Z",
      },
    ]);
    expect(await store.readExportHistory(sessionId)).toEqual(history);
  });
});
