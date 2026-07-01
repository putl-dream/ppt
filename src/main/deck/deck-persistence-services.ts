import type { SessionSnapshot } from "@shared/session";
import {
  createDefaultDesignConstraints,
  createDefaultExportHistoryFile,
  createDefaultGenerationJobsFile,
  deckExportHistoryFileSchema,
  deckExportRecordSchema,
  deckGenerationJobsFileSchema,
  designConstraintsSchema,
  projectArtifactFilePaths,
  type DeckExportRecord,
  type DeckGenerationJob,
  type DeckGenerationJobsFile,
  type DeckExportHistoryFile,
  type DesignConstraints,
} from "@shared/deck-persistence";
import type { ProjectFileService } from "../project/project-file-service";
import type { ProjectArtifactWriteResult } from "../project/project-file-service";

function serializeJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export class GenerationJobsService {
  constructor(private readonly projectFileService: ProjectFileService) {}

  async read(snapshot: SessionSnapshot): Promise<DeckGenerationJobsFile> {
    try {
      const artifact = await this.projectFileService.readArtifact(
        snapshot,
        projectArtifactFilePaths.deckGenerationJobs,
      );
      return deckGenerationJobsFileSchema.parse(JSON.parse(artifact.content ?? "{}"));
    } catch {
      return createDefaultGenerationJobsFile();
    }
  }

  async save(
    snapshot: SessionSnapshot,
    file: DeckGenerationJobsFile,
  ): Promise<ProjectArtifactWriteResult> {
    const parsed = deckGenerationJobsFileSchema.parse(file);
    return this.projectFileService.writeArtifact(
      snapshot,
      projectArtifactFilePaths.deckGenerationJobs,
      serializeJson(parsed),
      { markStale: false },
    );
  }

  async upsertJob(
    snapshot: SessionSnapshot,
    job: DeckGenerationJob,
  ): Promise<ProjectArtifactWriteResult> {
    const file = await this.read(snapshot);
    const index = file.jobs.findIndex((item) => item.id === job.id);
    if (index >= 0) {
      file.jobs[index] = job;
    } else {
      file.jobs.push(job);
    }
    return this.save(snapshot, file);
  }
}

export class ExportHistoryService {
  constructor(private readonly projectFileService: ProjectFileService) {}

  async read(snapshot: SessionSnapshot): Promise<DeckExportHistoryFile> {
    try {
      const artifact = await this.projectFileService.readArtifact(
        snapshot,
        projectArtifactFilePaths.exportHistory,
      );
      return deckExportHistoryFileSchema.parse(JSON.parse(artifact.content ?? "{}"));
    } catch {
      return createDefaultExportHistoryFile();
    }
  }

  async save(
    snapshot: SessionSnapshot,
    file: DeckExportHistoryFile,
  ): Promise<ProjectArtifactWriteResult> {
    const parsed = deckExportHistoryFileSchema.parse(file);
    return this.projectFileService.writeArtifact(
      snapshot,
      projectArtifactFilePaths.exportHistory,
      serializeJson(parsed),
      { markStale: false },
    );
  }

  async appendExport(
    snapshot: SessionSnapshot,
    record: DeckExportRecord,
  ): Promise<ProjectArtifactWriteResult> {
    const parsedRecord = deckExportRecordSchema.parse(record);
    const file = await this.read(snapshot);
    file.exports.push(parsedRecord);
    return this.save(snapshot, file);
  }
}

export class DesignConstraintsService {
  constructor(private readonly projectFileService: ProjectFileService) {}

  async read(snapshot: SessionSnapshot): Promise<DesignConstraints> {
    try {
      const artifact = await this.projectFileService.readArtifact(
        snapshot,
        projectArtifactFilePaths.designConstraints,
      );
      return designConstraintsSchema.parse(JSON.parse(artifact.content ?? "{}"));
    } catch {
      return createDefaultDesignConstraints();
    }
  }
}
