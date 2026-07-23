import type { AgentModelMessage } from "../../gateway/types";
import type { ToolContext } from "../../tools/tool-definition";
import type { AgentRuntimeOptions } from "../runtime-types";
import type {
  AgentQueryParams,
  AgentQuerySource,
  QueryStartMode,
} from "./query-types";

export interface AgentQueryAssemblyInput<TDeps> {
  options: AgentRuntimeOptions;
  messages: readonly AgentModelMessage[];
  systemPrompt: string;
  toolUseContext: ToolContext;
  maxTurns: number;
  deps: TDeps;
  canUseTool?: AgentQueryParams["canUseTool"];
}

/**
 * The sole adapter from application-level Runtime options to stable query input.
 * Compatibility fields are interpreted here and do not leak into turn runners.
 */
export class AgentQueryAssembler {
  assemble<TDeps>(input: AgentQueryAssemblyInput<TDeps>): AgentQueryParams<TDeps> {
    const startMode = resolveQueryStartMode(input.options);
    return Object.freeze({
      messages: structuredClone(input.messages),
      systemPrompt: input.systemPrompt,
      userContext: Object.freeze({
        request: input.options.request,
      }),
      systemContext: Object.freeze({
        threadId: input.options.threadId,
        runId: input.options.runId ?? "",
      }),
      canUseTool: input.canUseTool ?? (() => true),
      toolUseContext: input.toolUseContext,
      model: input.options.model,
      querySource: querySourceFor(startMode),
      maxTurns: input.maxTurns,
      deps: input.deps,
    });
  }
}

export function resolveQueryStartMode(options: AgentRuntimeOptions): QueryStartMode {
  if (options.startMode) return options.startMode;
  if (options.resumeThread) {
    return { type: "resume_query", reason: "interrupted" };
  }
  return { type: "new_query" };
}

function querySourceFor(startMode: QueryStartMode): AgentQuerySource {
  if (startMode.type === "new_query") return "user";
  return startMode.reason === "waiting_user" ? "continuation" : "recovery";
}
