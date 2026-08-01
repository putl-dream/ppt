import type { AgentGateway } from "./agent/gateway";
import type { ToolApprovalBroker } from "./agent/runtime/tools/tool-approval-broker";
import type { SkillRegistry } from "./agent/skills/loadSkillsDir";
import type { FileSessionStore } from "./session-store";
import type { TokenUsageStore } from "./token-usage-store";
import type { ContentAddressedBlobStore } from "./presentation-lifecycle/content-addressed-blob-store";
import type { PresentationLifecycleOrchestrator } from "./presentation-lifecycle/presentation-lifecycle-orchestrator";
import type { PresentationLifecycleRepository } from "./presentation-lifecycle/presentation-lifecycle-repository";
import type { PresentationArtifactChangeObserver } from "./presentation-lifecycle/artifact-change-observer";

/**
 * Process-scoped dependencies wired once during app bootstrap.
 * IPC registrars and session runtime assembly take this explicitly.
 */
export interface AppContext {
  applicationDataRoot: string;
  sessionStore: FileSessionStore;
  tokenUsageStore: TokenUsageStore;
  presentationLifecycleRepository: PresentationLifecycleRepository;
  presentationLifecycleOrchestrator: PresentationLifecycleOrchestrator;
  lifecycleBlobStore: ContentAddressedBlobStore;
  lifecycleArtifactChangeObserver: PresentationArtifactChangeObserver;
  agentGateway: AgentGateway;
  toolApprovalBroker: ToolApprovalBroker;
  skillRegistry: SkillRegistry;
}
