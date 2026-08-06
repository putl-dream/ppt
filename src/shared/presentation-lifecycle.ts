import { z } from "zod";

declare const presentationLifecycleIdentityBrand: unique symbol;

type LifecycleIdentity<Name extends string> = string & {
  readonly [presentationLifecycleIdentityBrand]: Name;
};

function identitySchema<Name extends string>(name: Name) {
  return z
    .string()
    .trim()
    .min(1)
    .transform((value) => value as LifecycleIdentity<Name>);
}

export const projectIdSchema = identitySchema("ProjectId");
export const presentationIdSchema = identitySchema("PresentationId");
export const presentationRevisionIdSchema = identitySchema("PresentationRevisionId");
export const pptJobIdSchema = identitySchema("PptJobId");
export const queryIdSchema = identitySchema("QueryId");
export const pptCapabilityRequestIdSchema = identitySchema("PptCapabilityRequestId");
export const pptStageRunIdSchema = identitySchema("PptStageRunId");
export const artifactIdSchema = identitySchema("ArtifactId");
export const artifactRevisionIdSchema = identitySchema("ArtifactRevisionId");
export const proposalIdSchema = identitySchema("ProposalId");

export type ProjectId = z.infer<typeof projectIdSchema>;
export type PresentationId = z.infer<typeof presentationIdSchema>;
export type PresentationRevisionId = z.infer<typeof presentationRevisionIdSchema>;
export type PptJobId = z.infer<typeof pptJobIdSchema>;
export type QueryId = z.infer<typeof queryIdSchema>;
export type PptCapabilityRequestId = z.infer<typeof pptCapabilityRequestIdSchema>;
export type PptStageRunId = z.infer<typeof pptStageRunIdSchema>;
export type ArtifactId = z.infer<typeof artifactIdSchema>;
export type ArtifactRevisionId = z.infer<typeof artifactRevisionIdSchema>;
export type ProposalId = z.infer<typeof proposalIdSchema>;

export const presentationRevisionNumberSchema = z.number().int().nonnegative();
export type PresentationRevisionNumber = z.infer<typeof presentationRevisionNumberSchema>;

export const contentHashSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
export type ContentHash = z.infer<typeof contentHashSchema>;

export const blobReferenceSchema = z
  .object({
    contentHash: contentHashSchema,
    mediaType: z.string().trim().min(1),
    byteLength: z.number().int().nonnegative(),
  })
  .strict();
export type BlobReference = z.infer<typeof blobReferenceSchema>;

export const PPT_CAPABILITIES = ["create", "edit", "restyle", "review", "export"] as const;
export const pptCapabilitySchema = z.enum(PPT_CAPABILITIES);
export type PptCapability = z.infer<typeof pptCapabilitySchema>;

export const PPT_STAGES = [
  "intent",
  "design_spec",
  "page_plan",
  "page_svg",
  "preview",
  "candidate",
  "quality",
  "proposal",
  "presentation",
  "export",
] as const;
export const pptStageSchema = z.enum(PPT_STAGES);
export type PptStage = z.infer<typeof pptStageSchema>;

export const ARTIFACT_KINDS = [
  "intent",
  "edit_intent",
  "restyle_intent",
  "design_spec",
  "page_plan",
  "source_asset",
  "page_svg",
  "preview_receipt",
  "candidate_commands",
  "candidate_deck",
  "quality_report",
  "command_proposal",
  "presentation_revision",
  "export_artifact",
] as const;
export const artifactKindSchema = z.enum(ARTIFACT_KINDS);
export type ArtifactKind = z.infer<typeof artifactKindSchema>;

export const ARTIFACT_STAGE_BY_KIND = {
  intent: "intent",
  edit_intent: "intent",
  restyle_intent: "intent",
  design_spec: "design_spec",
  page_plan: "page_plan",
  source_asset: "page_svg",
  page_svg: "page_svg",
  preview_receipt: "preview",
  candidate_commands: "candidate",
  candidate_deck: "candidate",
  quality_report: "quality",
  command_proposal: "proposal",
  presentation_revision: "presentation",
  export_artifact: "export",
} as const satisfies Record<ArtifactKind, PptStage>;

function validateArtifactStage(
  artifact: { kind: ArtifactKind; stage: PptStage },
  context: z.RefinementCtx,
): void {
  const expectedStage = ARTIFACT_STAGE_BY_KIND[artifact.kind];
  if (artifact.stage !== expectedStage) {
    context.addIssue({
      code: "custom",
      message: `Artifact kind ${artifact.kind} must be committed at stage ${expectedStage}.`,
      path: ["stage"],
    });
  }
}

export const validationIssueSchema = z
  .object({
    severity: z.enum(["error", "warning", "info"]),
    code: z.string().trim().min(1),
    message: z.string().trim().min(1),
    path: z.array(z.union([z.string(), z.number().int()])).optional(),
  })
  .strict();
export type ValidationIssue = z.infer<typeof validationIssueSchema>;

export const validationReportSchema = z
  .object({
    status: z.enum(["passed", "failed"]),
    validator: z.string().trim().min(1),
    issues: z.array(validationIssueSchema),
    validatedAt: z.iso.datetime(),
  })
  .strict()
  .superRefine((report, context) => {
    if (report.status === "passed" && report.issues.some((issue) => issue.severity === "error")) {
      context.addIssue({
        code: "custom",
        message: "A passed validation report cannot contain error issues.",
        path: ["issues"],
      });
    }
  });
export type ValidationReport = z.infer<typeof validationReportSchema>;

export const artifactDependencySchema = z
  .object({
    artifactId: artifactIdSchema,
    revisionId: artifactRevisionIdSchema,
    contentHash: contentHashSchema,
  })
  .strict();
export type ArtifactDependency = z.infer<typeof artifactDependencySchema>;

export const artifactRevisionSchema = z
  .object({
    artifactId: artifactIdSchema,
    revisionId: artifactRevisionIdSchema,
    jobId: pptJobIdSchema,
    kind: artifactKindSchema,
    stage: pptStageSchema,
    schemaVersion: z.number().int().positive(),
    value: z.json(),
    contentHash: contentHashSchema,
    dependencies: z.array(artifactDependencySchema),
    validation: validationReportSchema,
    committedAt: z.iso.datetime(),
  })
  .strict()
  .superRefine(validateArtifactStage);
export type ArtifactRevision<T = unknown> = Omit<
  z.infer<typeof artifactRevisionSchema>,
  "value"
> & { value: T };

export const artifactPointerSchema = z
  .object({
    artifactId: artifactIdSchema,
    revisionId: artifactRevisionIdSchema,
    contentHash: contentHashSchema,
    kind: artifactKindSchema,
    stage: pptStageSchema,
  })
  .strict()
  .superRefine(validateArtifactStage);
export type ArtifactPointer = z.infer<typeof artifactPointerSchema>;

export const staleArtifactSchema = z
  .object({
    artifactId: artifactIdSchema,
    revisionId: artifactRevisionIdSchema,
    staleBecause: artifactDependencySchema,
    observedContentHash: contentHashSchema.optional(),
    reason: z.string().trim().min(1),
    detectedAt: z.iso.datetime(),
  })
  .strict();
export type StaleArtifact = z.infer<typeof staleArtifactSchema>;

export const pptCapabilityRequestSchema = z
  .object({
    requestId: pptCapabilityRequestIdSchema,
    jobId: pptJobIdSchema,
    queryId: queryIdSchema.optional(),
    capability: pptCapabilitySchema,
    instruction: z.string(),
    basePresentationRevisionId: presentationRevisionIdSchema.optional(),
    requestedAt: z.iso.datetime(),
  })
  .strict();
export type PptCapabilityRequest = z.infer<typeof pptCapabilityRequestSchema>;

export const pptJobStatusSchema = z.enum([
  "running",
  "waiting_user",
  "waiting_approval",
  "completed",
  "cancelled",
  "failed",
]);
export type PptJobStatus = z.infer<typeof pptJobStatusSchema>;

export const pptJobParamsSchema = z
  .object({
    projectId: projectIdSchema,
    presentationId: presentationIdSchema,
    createdAt: z.iso.datetime(),
  })
  .strict();
export type PptJobParams = z.infer<typeof pptJobParamsSchema>;

export const pptJobStateSchema = z
  .object({
    jobId: pptJobIdSchema,
    params: pptJobParamsSchema,
    currentRequest: pptCapabilityRequestSchema,
    status: pptJobStatusSchema,
    stateRevision: z.number().int().nonnegative(),
    currentStage: pptStageSchema,
    committedArtifacts: z.array(artifactPointerSchema),
    staleArtifacts: z.array(staleArtifactSchema),
    currentStageRunId: pptStageRunIdSchema.optional(),
    candidateArtifactRevisionId: artifactRevisionIdSchema.optional(),
    proposalId: proposalIdSchema.optional(),
    presentationRevisionId: presentationRevisionIdSchema.optional(),
    presentationRevisionNumber: presentationRevisionNumberSchema.optional(),
    exportArtifactRevisionId: artifactRevisionIdSchema.optional(),
    waitingReason: z.string().trim().min(1).optional(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict()
  .superRefine((state, context) => {
    const waiting = state.status === "waiting_user" || state.status === "waiting_approval";
    if (waiting !== Boolean(state.waitingReason)) {
      context.addIssue({
        code: "custom",
        message: "waitingReason must be present exactly when the job is waiting.",
        path: ["waitingReason"],
      });
    }
    if (state.currentRequest.jobId !== state.jobId) {
      context.addIssue({
        code: "custom",
        message: "currentRequest.jobId must match jobId.",
        path: ["currentRequest", "jobId"],
      });
    }
  });
export type PptJobState = z.infer<typeof pptJobStateSchema>;

export const pptStageAttemptStatusSchema = z.enum(["running", "succeeded", "failed", "cancelled"]);
export type PptStageAttemptStatus = z.infer<typeof pptStageAttemptStatusSchema>;

export const pptStageAttemptSchema = z
  .object({
    stageRunId: pptStageRunIdSchema,
    jobId: pptJobIdSchema,
    requestId: pptCapabilityRequestIdSchema,
    queryId: queryIdSchema.optional(),
    stage: pptStageSchema,
    attempt: z.number().int().positive(),
    status: pptStageAttemptStatusSchema,
    idempotencyKey: z.string().trim().min(1),
    candidate: z.json().optional(),
    artifactRevisionId: artifactRevisionIdSchema.optional(),
    validation: validationReportSchema.optional(),
    error: z.string().trim().min(1).optional(),
    startedAt: z.iso.datetime(),
    completedAt: z.iso.datetime().optional(),
  })
  .strict()
  .superRefine((attempt, context) => {
    const terminal = attempt.status !== "running";
    if (terminal !== Boolean(attempt.completedAt)) {
      context.addIssue({
        code: "custom",
        message: "completedAt must be present exactly for terminal attempts.",
        path: ["completedAt"],
      });
    }
    if (attempt.status === "failed" && !attempt.error) {
      context.addIssue({
        code: "custom",
        message: "Failed attempts require an error.",
        path: ["error"],
      });
    }
    if (attempt.status === "succeeded" && !attempt.artifactRevisionId) {
      context.addIssue({
        code: "custom",
        message: "Succeeded attempts require a committed artifact revision.",
        path: ["artifactRevisionId"],
      });
    }
    if (attempt.status === "succeeded" && attempt.validation?.status !== "passed") {
      context.addIssue({
        code: "custom",
        message: "Succeeded attempts require passed validation.",
        path: ["validation"],
      });
    }
    if (attempt.status !== "succeeded" && attempt.artifactRevisionId !== undefined) {
      context.addIssue({
        code: "custom",
        message: "Only succeeded attempts may reference an artifact revision.",
        path: ["artifactRevisionId"],
      });
    }
  });
export type PptStageAttempt = z.infer<typeof pptStageAttemptSchema>;

export const pptProposalStatusSchema = z.enum([
  "waiting_approval",
  "applied",
  "rejected",
  "superseded",
]);
export type PptProposalStatus = z.infer<typeof pptProposalStatusSchema>;

export const pptProposalSchema = z
  .object({
    proposalId: proposalIdSchema,
    jobId: pptJobIdSchema,
    requestId: pptCapabilityRequestIdSchema,
    queryId: queryIdSchema.optional(),
    artifactRevisionId: artifactRevisionIdSchema,
    basePresentationRevisionId: presentationRevisionIdSchema.optional(),
    basePresentationRevisionNumber: presentationRevisionNumberSchema,
    status: pptProposalStatusSchema,
    createdAt: z.iso.datetime(),
    resolvedAt: z.iso.datetime().optional(),
  })
  .strict()
  .superRefine((proposal, context) => {
    const resolved = proposal.status !== "waiting_approval";
    if (resolved !== Boolean(proposal.resolvedAt)) {
      context.addIssue({
        code: "custom",
        message: "resolvedAt must be present exactly for resolved Proposals.",
        path: ["resolvedAt"],
      });
    }
  });
export type PptProposal = z.infer<typeof pptProposalSchema>;

export const pptJobProjectionSchema = z
  .object({
    jobId: pptJobIdSchema,
    presentationId: presentationIdSchema,
    capability: pptCapabilitySchema,
    requestId: pptCapabilityRequestIdSchema,
    queryId: queryIdSchema.optional(),
    status: pptJobStatusSchema,
    stage: pptStageSchema,
    stateRevision: z.number().int().nonnegative(),
    committedArtifacts: z.array(artifactPointerSchema),
    staleArtifacts: z.array(staleArtifactSchema),
    waitingReason: z.string().optional(),
    proposalId: proposalIdSchema.optional(),
    proposalStatus: pptProposalStatusSchema.optional(),
    proposalArtifactRevisionId: artifactRevisionIdSchema.optional(),
    presentationRevisionId: presentationRevisionIdSchema.optional(),
    presentationRevisionNumber: presentationRevisionNumberSchema.optional(),
    exportArtifactRevisionId: artifactRevisionIdSchema.optional(),
    updatedAt: z.iso.datetime(),
  })
  .strict()
  .superRefine((projection, context) => {
    if (Boolean(projection.proposalId) !== Boolean(projection.proposalStatus)) {
      context.addIssue({
        code: "custom",
        message: "proposalId and proposalStatus must be present together.",
        path: ["proposalStatus"],
      });
    }
    if (
      projection.proposalArtifactRevisionId !== undefined &&
      projection.proposalId === undefined
    ) {
      context.addIssue({
        code: "custom",
        message: "A Proposal artifact pointer requires proposalId.",
        path: ["proposalArtifactRevisionId"],
      });
    }
  });
export type PptJobProjection = z.infer<typeof pptJobProjectionSchema>;

export function toPptJobProjection(
  state: PptJobState,
  proposal?: Pick<PptProposal, "status" | "artifactRevisionId">,
): PptJobProjection {
  return pptJobProjectionSchema.parse({
    jobId: state.jobId,
    presentationId: state.params.presentationId,
    capability: state.currentRequest.capability,
    requestId: state.currentRequest.requestId,
    queryId: state.currentRequest.queryId,
    status: state.status,
    stage: state.currentStage,
    stateRevision: state.stateRevision,
    committedArtifacts: state.committedArtifacts,
    staleArtifacts: state.staleArtifacts,
    waitingReason: state.waitingReason,
    proposalId: state.proposalId,
    proposalStatus: proposal?.status,
    proposalArtifactRevisionId: proposal?.artifactRevisionId,
    presentationRevisionId: state.presentationRevisionId,
    presentationRevisionNumber: state.presentationRevisionNumber,
    exportArtifactRevisionId: state.exportArtifactRevisionId,
    updatedAt: state.updatedAt,
  });
}

export function asProjectId(value: string): ProjectId {
  return projectIdSchema.parse(value);
}

export function asPresentationId(value: string): PresentationId {
  return presentationIdSchema.parse(value);
}

export function asPresentationRevisionId(value: string): PresentationRevisionId {
  return presentationRevisionIdSchema.parse(value);
}

export function asPptJobId(value: string): PptJobId {
  return pptJobIdSchema.parse(value);
}

export function asQueryId(value: string): QueryId {
  return queryIdSchema.parse(value);
}

export function asPptCapabilityRequestId(value: string): PptCapabilityRequestId {
  return pptCapabilityRequestIdSchema.parse(value);
}

export function asPptStageRunId(value: string): PptStageRunId {
  return pptStageRunIdSchema.parse(value);
}

export function asArtifactId(value: string): ArtifactId {
  return artifactIdSchema.parse(value);
}

export function asArtifactRevisionId(value: string): ArtifactRevisionId {
  return artifactRevisionIdSchema.parse(value);
}

export function asProposalId(value: string): ProposalId {
  return proposalIdSchema.parse(value);
}
