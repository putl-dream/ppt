import {
  createDisplayEventId,
  type DisplayEvent,
} from "@shared/card-display-protocol";
import type { AgentRunResult } from "@shared/ipc";
import {
  countSlidesNeedingLayout,
  presentationNeedsLayoutChoice,
} from "@shared/presentation-draft";
import type { AgentServiceEvent } from "../service";

function now(): string {
  return new Date().toISOString();
}

export function toStreamDisplayEvent(
  event: AgentServiceEvent,
  sessionId: string,
  runId: string,
): DisplayEvent | undefined {
  if (event.type === "tool-approval-waiting") {
    return {
      protocolVersion: 1,
      eventId: `tool-approval:${event.approvalId}`,
      emittedAt: now(),
      kind: "permission.tool-requested",
      category: "permission",
      source: { kind: "tool", toolName: event.toolName },
      scope: { sessionId, runId },
      semantics: {
        blocking: true,
        requiresResponse: true,
        priority: "critical",
      },
      payload: {
        approvalId: event.approvalId,
        toolName: event.toolName,
        reason: event.reason,
        detail: event.detail,
      },
    };
  }

  if (event.type === "task-graph-updated") {
    return {
      protocolVersion: 1,
      // One semantic card per run; later updates replace the prior snapshot.
      eventId: `task-graph:${sessionId}:${runId}`,
      emittedAt: now(),
      kind: "progress.task-graph-updated",
      category: "progress",
      source: { kind: "agent" },
      scope: { sessionId, runId },
      semantics: {
        blocking: false,
        requiresResponse: false,
        priority: "normal",
      },
      payload: {
        tasks: event.tasks,
        goal: event.goal,
      },
    };
  }

  return undefined;
}

export function toResultDisplayEvents(
  result: AgentRunResult,
  sessionId: string,
  runId?: string,
): DisplayEvent[] {
  const scope = {
    sessionId,
    ...(runId ? { runId } : {}),
  };

  if (result.status === "chat" && result.question) {
    return [{
      protocolVersion: 1,
      eventId: createDisplayEventId("question"),
      emittedAt: now(),
      kind: "interaction.question-requested",
      category: "interaction",
      source: { kind: "tool", toolName: "AskUser" },
      scope: {
        ...scope,
        ...(result.threadId ? { threadId: result.threadId } : {}),
      },
      semantics: {
        blocking: true,
        requiresResponse: true,
        priority: "high",
      },
      payload: {
        message: result.message,
        question: result.question,
      },
    }];
  }

  if (result.status === "approval-required") {
    return [{
      protocolVersion: 1,
      eventId: `command-proposal:${result.approval.threadId}`,
      emittedAt: now(),
      kind: "review.command-proposal",
      category: "review",
      source: { kind: "tool", toolName: "SubmitCommands" },
      scope: {
        ...scope,
        threadId: result.approval.threadId,
      },
      semantics: {
        blocking: true,
        requiresResponse: true,
        priority: result.approval.risk === "high" ? "critical" : "high",
      },
      payload: {
        approvalThreadId: result.approval.threadId,
        summary: result.approval.summary,
        risk: result.approval.risk,
        assumptions: result.approval.assumptions,
        affectedSlideCount: result.approval.diff?.affectedSlideIds.length,
      },
    }];
  }

  if (result.status === "completed") {
    const presentation = result.presentation;
    if (presentationNeedsLayoutChoice(presentation)) {
      return [{
        protocolVersion: 1,
        eventId: `layout-required:${sessionId}:${presentation.revision}`,
        emittedAt: now(),
        kind: "interaction.layout-required",
        category: "interaction",
        source: {
          kind: "domain",
          entityType: "presentation",
          entityId: sessionId,
          revision: presentation.revision,
        },
        scope,
        semantics: {
          blocking: true,
          requiresResponse: true,
          priority: "high",
        },
        payload: {
          presentationRevision: presentation.revision,
          slideCount: Math.max(1, countSlidesNeedingLayout(presentation)),
        },
      }];
    }

    return [{
      protocolVersion: 1,
      eventId: `artifact:deck:${sessionId}:${presentation.revision}`,
      emittedAt: now(),
      kind: "artifact.ready",
      category: "artifact",
      source: {
        kind: "domain",
        entityType: "presentation",
        entityId: sessionId,
        revision: presentation.revision,
      },
      scope,
      semantics: {
        blocking: false,
        requiresResponse: false,
        priority: "normal",
      },
      payload: {
        artifactId: "deck",
        artifactType: "deck",
        title: presentation.title,
        revision: presentation.revision,
      },
    }];
  }

  return [];
}
