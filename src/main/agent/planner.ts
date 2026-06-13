import { z } from "zod";
import type { AgentModelSelection } from "@shared/agent";
import type { PresentationCommand } from "@shared/commands";
import type { Presentation } from "@shared/presentation";
import type { AgentModelGateway } from "./gateway";

const modelProposalSchema = z.object({
  summary: z.string().trim().min(1),
  presentationTitle: z.string().trim().min(1),
  slide: z.object({
    title: z.string().trim().min(1),
    body: z.string().trim().min(1),
  }),
});

export interface AgentPlanInput {
  request: string;
  presentation: Presentation;
  model?: AgentModelSelection;
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

function proposalToPlan(proposal: z.infer<typeof modelProposalSchema>): AgentPlan {
  const slideId = crypto.randomUUID();
  return {
    summary: proposal.summary,
    commands: [
      {
        id: crypto.randomUUID(),
        type: "set-presentation-title",
        title: proposal.presentationTitle,
      },
      {
        id: crypto.randomUUID(),
        type: "add-slide",
        index: Number.MAX_SAFE_INTEGER,
        slide: {
          id: slideId,
          title: proposal.slide.title,
          elements: [
            {
              id: crypto.randomUUID(),
              type: "text",
              x: 120,
              y: 100,
              width: 1040,
              height: 120,
              text: proposal.slide.title,
              fontSize: 48,
            },
            {
              id: crypto.randomUUID(),
              type: "text",
              x: 120,
              y: 260,
              width: 1040,
              height: 320,
              text: proposal.slide.body,
              fontSize: 28,
            },
          ],
        },
      },
    ],
  };
}

export function createModelPresentationPlanner(gateway: AgentModelGateway): AgentPlanner {
  return {
    async plan(input) {
      const response = await gateway.generateText(
        {
          systemPrompt: [
            "You are a presentation planning service.",
            "Return only one JSON object with this exact shape:",
            '{"summary":"...","presentationTitle":"...","slide":{"title":"...","body":"..."}}',
            "Do not include markdown fences or extra keys.",
          ].join("\n"),
          prompt: [
            `User request: ${input.request}`,
            `Current presentation title: ${input.presentation.title}`,
            `Current slide titles: ${input.presentation.slides.map((slide) => slide.title).join(" | ")}`,
            "Create one useful new slide. Keep body text concise and ready to display.",
          ].join("\n"),
        },
        input.model,
      );
      return proposalToPlan(modelProposalSchema.parse(parseJsonObject(response.text)));
    },
  };
}

export function createDeterministicPresentationPlanner(): AgentPlanner {
  return {
    async plan({ request }) {
      const title = request.trim() || "Agent-generated presentation";
      return proposalToPlan({
        summary: `Set the presentation title and add a slide for "${title}".`,
        presentationTitle: title,
        slide: { title, body: title },
      });
    },
  };
}
