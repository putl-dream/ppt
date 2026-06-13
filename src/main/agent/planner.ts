import { z } from "zod";
import type { AgentModelSelection } from "@shared/agent";
import type { PresentationCommand } from "@shared/commands";
import type { Presentation, TextElement } from "@shared/presentation";
import type { AgentModelGateway } from "./gateway";

const agentActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("set-presentation-title"),
    title: z.string().trim().min(1),
  }),
  z.object({
    type: z.literal("add-slide"),
    title: z.string().trim().min(1),
    body: z.string().trim().min(1),
    index: z.number().int().nonnegative().optional(),
  }),
  z.object({
    type: z.literal("remove-slide"),
    slideId: z.string().trim().min(1),
  }),
  z.object({
    type: z.literal("set-slide-title"),
    slideId: z.string().trim().min(1),
    title: z.string().trim().min(1),
  }),
  z.object({
    type: z.literal("add-text"),
    slideId: z.string().trim().min(1),
    text: z.string().trim().min(1),
    x: z.number().optional(),
    y: z.number().optional(),
    width: z.number().positive().optional(),
    height: z.number().positive().optional(),
    fontSize: z.number().positive().optional(),
  }),
  z.object({
    type: z.literal("update-text"),
    slideId: z.string().trim().min(1),
    elementId: z.string().trim().min(1),
    text: z.string(),
    fontSize: z.number().positive().optional(),
  }),
  z.object({
    type: z.literal("remove-element"),
    slideId: z.string().trim().min(1),
    elementId: z.string().trim().min(1),
  }),
]);

const modelProposalSchema = z.object({
  summary: z.string().trim().min(1),
  actions: z.array(agentActionSchema).min(1).max(20),
});

type AgentAction = z.infer<typeof agentActionSchema>;

export interface AgentPlanInput {
  request: string;
  presentation: Presentation;
  model?: AgentModelSelection;
  feedback?: string[];
  attempt?: number;
}

export interface AgentPlan {
  summary: string;
  commands: PresentationCommand[];
}

export interface AgentPlanner {
  plan(input: AgentPlanInput): Promise<AgentPlan>;
}

function parseJsonObject(text: string): unknown {
  const withoutFence = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = withoutFence.indexOf("{");
  const end = withoutFence.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("The model did not return a JSON object.");
  return JSON.parse(withoutFence.slice(start, end + 1));
}

function createTextElement(text: string, title = false): TextElement {
  return {
    id: crypto.randomUUID(),
    type: "text",
    x: 120,
    y: title ? 100 : 260,
    width: 1040,
    height: title ? 120 : 320,
    text,
    fontSize: title ? 48 : 28,
  };
}

function actionToCommand(action: AgentAction, presentation: Presentation): PresentationCommand {
  if (action.type === "set-presentation-title") {
    return { id: crypto.randomUUID(), type: action.type, title: action.title };
  }
  if (action.type === "add-slide") {
    return {
      id: crypto.randomUUID(),
      type: "add-slide",
      index: action.index ?? Number.MAX_SAFE_INTEGER,
      slide: {
        id: crypto.randomUUID(),
        title: action.title,
        elements: [createTextElement(action.title, true), createTextElement(action.body)],
      },
    };
  }
  if (action.type === "remove-slide") {
    return { id: crypto.randomUUID(), type: action.type, slideId: action.slideId };
  }
  if (action.type === "set-slide-title") {
    return {
      id: crypto.randomUUID(),
      type: action.type,
      slideId: action.slideId,
      title: action.title,
    };
  }
  if (action.type === "add-text") {
    return {
      id: crypto.randomUUID(),
      type: "add-element",
      slideId: action.slideId,
      element: {
        id: crypto.randomUUID(),
        type: "text",
        x: action.x ?? 120,
        y: action.y ?? 260,
        width: action.width ?? 1040,
        height: action.height ?? 240,
        text: action.text,
        fontSize: action.fontSize ?? 28,
      },
    };
  }
  if (action.type === "update-text") {
    const slide = presentation.slides.find((item) => item.id === action.slideId);
    const element = slide?.elements.find((item) => item.id === action.elementId);
    if (!element) throw new Error(`Element not found: ${action.elementId}`);
    if (element.type !== "text") throw new Error(`Element is not text: ${action.elementId}`);
    return {
      id: crypto.randomUUID(),
      type: "update-element",
      slideId: action.slideId,
      elementId: action.elementId,
      element: {
        ...element,
        text: action.text,
        fontSize: action.fontSize ?? element.fontSize,
      },
    };
  }
  return {
    id: crypto.randomUUID(),
    type: "remove-element",
    slideId: action.slideId,
    elementId: action.elementId,
  };
}

function proposalToPlan(
  proposal: z.infer<typeof modelProposalSchema>,
  presentation: Presentation,
): AgentPlan {
  return {
    summary: proposal.summary,
    commands: proposal.actions.map((action) => actionToCommand(action, presentation)),
  };
}

function compactPresentation(presentation: Presentation) {
  return {
    title: presentation.title,
    revision: presentation.revision,
    slides: presentation.slides.map((slide, index) => ({
      index,
      id: slide.id,
      title: slide.title,
      elements: slide.elements.map((element) => ({
        id: element.id,
        type: element.type,
        text: element.type === "text" ? element.text : undefined,
      })),
    })),
  };
}

export function createModelPresentationPlanner(gateway: AgentModelGateway): AgentPlanner {
  return {
    async plan(input) {
      const response = await gateway.generateText(
        {
          systemPrompt: [
            "You are an autonomous presentation editing agent.",
            "Choose the smallest useful sequence of actions that satisfies the user request.",
            "Return only one JSON object with summary and actions. Do not use markdown.",
            "Allowed action types:",
            '- {"type":"set-presentation-title","title":"..."}',
            '- {"type":"add-slide","title":"...","body":"...","index":0}',
            '- {"type":"remove-slide","slideId":"existing-slide-id"}',
            '- {"type":"set-slide-title","slideId":"existing-slide-id","title":"..."}',
            '- {"type":"add-text","slideId":"existing-slide-id","text":"...","x":120,"y":260,"width":1040,"height":240,"fontSize":28}',
            '- {"type":"update-text","slideId":"existing-slide-id","elementId":"existing-element-id","text":"...","fontSize":28}',
            '- {"type":"remove-element","slideId":"existing-slide-id","elementId":"existing-element-id"}',
            "Use only IDs present in the current presentation. Omit optional numeric fields when unnecessary.",
          ].join("\n"),
          prompt: [
            `User request: ${input.request}`,
            `Planning attempt: ${input.attempt ?? 1}`,
            `Current presentation: ${JSON.stringify(compactPresentation(input.presentation))}`,
            input.feedback?.length
              ? `Previous plan errors to repair: ${input.feedback.join(" | ")}`
              : "No previous plan errors.",
          ].join("\n"),
        },
        input.model,
      );
      const proposal = modelProposalSchema.parse(parseJsonObject(response.text));
      return proposalToPlan(proposal, input.presentation);
    },
  };
}

export function createDeterministicPresentationPlanner(): AgentPlanner {
  return {
    async plan({ request, presentation }) {
      const title = request.trim() || "Agent-generated presentation";
      return proposalToPlan(
        {
          summary: `Set the presentation title and add a slide for "${title}".`,
          actions: [
            { type: "set-presentation-title", title },
            { type: "add-slide", title, body: title },
          ],
        },
        presentation,
      );
    },
  };
}
