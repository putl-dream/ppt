import { Annotation, Command, interrupt, MemorySaver, StateGraph } from "@langchain/langgraph";
import type { CommandBus } from "@shared/commands";
import { presentationCommandSchema, type PresentationCommand } from "@shared/commands";
import type { AgentRunResult } from "@shared/ipc";
import type { AgentModelSelection } from "@shared/agent";
import {
  createDeterministicPresentationPlanner,
  type AgentPlanner,
} from "./planner";

const AgentState = Annotation.Root({
  request: Annotation<string>(),
  model: Annotation<AgentModelSelection | undefined>(),
  summary: Annotation<string>(),
  commands: Annotation<PresentationCommand[]>({
    reducer: (_, update) => update,
    default: () => [],
  }),
  errors: Annotation<string[]>({
    reducer: (_, update) => update,
    default: () => [],
  }),
});

type AgentStateType = typeof AgentState.State;

function validateCommands(state: AgentStateType): Partial<AgentStateType> {
  const errors = state.commands.flatMap((command) => {
    const parsed = presentationCommandSchema.safeParse(command);
    return parsed.success ? [] : [parsed.error.message];
  });
  return { errors };
}

function routeAfterValidation(state: AgentStateType): "approval" | "__end__" {
  return state.errors.length > 0 ? "__end__" : "approval";
}

function approvalNode(state: AgentStateType): Command {
  const decision = interrupt({
    summary: state.summary,
    commands: state.commands,
  }) as { approved: boolean };
  return new Command({ goto: decision.approved ? "apply" : "reject" });
}

export function createAgentWorkflow(commandBus: CommandBus, planner: AgentPlanner) {
  const proposeCommands = async (state: AgentStateType): Promise<Partial<AgentStateType>> => {
    return planner.plan({
      request: state.request,
      presentation: commandBus.getSnapshot(),
      model: state.model,
    });
  };

  const applyCommands = (state: AgentStateType): Partial<AgentStateType> => {
    commandBus.executeMany(state.commands);
    return {};
  };

  return new StateGraph(AgentState)
    .addNode("propose", proposeCommands)
    .addNode("validate", validateCommands)
    .addNode("approval", approvalNode, { ends: ["apply", "reject"] })
    .addNode("apply", applyCommands)
    .addNode("reject", () => ({}))
    .addEdge("__start__", "propose")
    .addEdge("propose", "validate")
    .addConditionalEdges("validate", routeAfterValidation)
    .addEdge("apply", "__end__")
    .addEdge("reject", "__end__")
    .compile({ checkpointer: new MemorySaver() });
}

export class AgentService {
  private readonly graph;

  constructor(
    private readonly commandBus: CommandBus,
    planner: AgentPlanner = createDeterministicPresentationPlanner(),
  ) {
    this.graph = createAgentWorkflow(commandBus, planner);
  }

  async start(request: string, model?: AgentModelSelection): Promise<AgentRunResult> {
    const threadId = crypto.randomUUID();
    const result = await this.graph.invoke(
      { request, model },
      { configurable: { thread_id: threadId } },
    );

    return this.toResult(threadId, result);
  }

  async resume(threadId: string, approved: boolean): Promise<AgentRunResult> {
    const result = await this.graph.invoke(new Command({ resume: { approved } }), {
      configurable: { thread_id: threadId },
    });

    if (!approved) {
      return { status: "rejected", presentation: this.commandBus.getSnapshot() };
    }
    return this.toResult(threadId, result);
  }

  private toResult(threadId: string, result: Record<string, unknown>): AgentRunResult {
    const interrupts = result.__interrupt__ as
      | Array<{ value: { summary: string; commands: PresentationCommand[] } }>
      | undefined;

    if (interrupts?.[0]) {
      return {
        status: "approval-required",
        approval: {
          threadId,
          summary: interrupts[0].value.summary,
          commands: interrupts[0].value.commands,
        },
      };
    }

    return { status: "completed", presentation: this.commandBus.getSnapshot() };
  }
}
