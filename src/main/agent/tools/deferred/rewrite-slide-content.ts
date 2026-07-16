import { z } from "zod";
import type { ToolDefinition } from "../tool-definition";
import type { PresentationCommand } from "@shared/commands";
import { callLLMJson } from "../../gateway/model-calls";
import { assertProtectedFactsPreserved } from "./text-rewrite-utils";

export const rewriteSlideContentSchema = z.object({
  slideId: z.string().describe("目标幻灯片 ID"),
  elementId: z.string().describe("目标文本框元素 ID"),
  style: z.enum(["professional", "concise", "creative", "persuasive"]).describe("修改文风风格"),
});

/**
 * Deferred Tool: 文本改写。
 * 与“只美化、保持事实”的布局工具不同，该工具明确允许模型根据风格改写文字内容。
 */
export const rewriteSlideContentTool: ToolDefinition<
  typeof rewriteSlideContentSchema,
  { commands: PresentationCommand[] }
> = {
  name: "RewriteSlideContent",
  description: "根据所选风格（专业、简洁、创意、说服性）改写特定文本框的内容。",
  category: "deferred",
  loadPolicy: "deferred",
  inputSchema: rewriteSlideContentSchema,
  risk: "medium",
  execute: async (args, context) => {
    const slide = context.presentation.slides.find((s) => s.id === args.slideId);
    const element = slide?.elements.find((el) => el.id === args.elementId);
    
    if (!element || element.type !== "text") {
      throw new Error(`Text element '${args.elementId}' not found on slide '${args.slideId}'.`);
    }
    if (!context.gateway) {
      throw new Error(
        "RewriteSlideContent requires a configured model gateway; mock rewriting is disabled.",
      );
    }

    const styleInstructions: Record<typeof args.style, string> = {
      professional: "Use precise, professional wording and a restrained tone.",
      concise: "Remove repetition and filler while keeping every material fact.",
      creative: "Use vivid but credible phrasing without inventing claims.",
      persuasive: "Strengthen the value proposition without exaggerating evidence.",
    };
    const resultSchema = z.object({
      rewrittenText: z.string().trim().min(1).max(Math.max(1_000, element.text.length * 3)),
    });
    const { rewrittenText } = await callLLMJson(
      context.gateway,
      {
        schema: resultSchema,
        schemaName: "rewritten_slide_text",
        description: "Fact-preserving rewritten slide text.",
        request: {
          systemPrompt: [
            "Rewrite one presentation text element.",
            "Preserve every number, date, percentage, currency amount, URL, email, proper noun, and factual relationship.",
            "Do not add prefixes such as 'professional version' or meta commentary.",
            "Return only the rewritten text in the structured field.",
          ].join("\n"),
          prompt: JSON.stringify({
            style: args.style,
            instruction: styleInstructions[args.style],
            text: element.text,
          }),
          signal: context.signal,
          maxOutputTokens: Math.min(4_096, Math.max(512, element.text.length * 3)),
        },
      },
      context.model,
    );
    assertProtectedFactsPreserved(element.text, rewrittenText);

    const commands: PresentationCommand[] = [
      {
        id: crypto.randomUUID(),
        type: "update-element",
        slideId: args.slideId,
        elementId: args.elementId,
        element: {
          ...element,
          text: rewrittenText,
        },
      },
    ];

    return { commands };
  },
};
