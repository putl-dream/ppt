import type { ConversationDatabase } from "../../conversation-database";

export interface AgentRendererEvent {
  type: string;
  message: string;
  [key: string]: unknown;
}

export interface AgentEventEnvelope<TPayload = Record<string, unknown>> {
  runId?: string;
  threadId: string;
  timestamp: string;
  namespace:
    | "runtime"
    | "model"
    | "tool"
    | "background"
    | "presentation"
    | "teammate"
    | "stream"
    | "audit";
  type: string;
  payload: TPayload;
}

/** Isolates renderer and audit projections from authoritative Runtime state. */
export class AgentEventPorts {
  constructor(private readonly input: {
    threadId: string;
    runId?: string;
    onProgress?: (event: AgentRendererEvent) => void;
    conversationDatabase?: ConversationDatabase;
    transcript: Array<Record<string, unknown>>;
  }) {}

  renderer(event: AgentRendererEvent): void {
    try {
      this.input.onProgress?.(event);
    } catch {
      // Renderer delivery is observational and cannot alter Runtime facts.
    }
  }

  audit(
    kind: Parameters<ConversationDatabase["appendRuntimeEvent"]>[1],
    payload: Record<string, unknown>,
    visibility: Parameters<ConversationDatabase["appendRuntimeEvent"]>[3] = "user_visible",
  ): void {
    if (!this.input.runId || !this.input.conversationDatabase) return;
    try {
      this.input.conversationDatabase.appendRuntimeEvent(
        this.input.runId,
        kind,
        payload,
        visibility,
      );
    } catch (error) {
      this.input.transcript.push({
        role: "system",
        kind: "runtime_event_error",
        eventKind: kind,
        content: error instanceof Error ? error.message : String(error),
      });
    }
  }

  envelope<TPayload extends Record<string, unknown>>(
    namespace: AgentEventEnvelope<TPayload>["namespace"],
    type: string,
    payload: TPayload,
  ): AgentEventEnvelope<TPayload> {
    return {
      runId: this.input.runId,
      threadId: this.input.threadId,
      timestamp: new Date().toISOString(),
      namespace,
      type,
      payload,
    };
  }
}
