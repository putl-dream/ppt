import { z } from "zod";
import type { ToolDefinition } from "../tool-definition";
import { callLLMJson } from "../../gateway/model-calls";
import { assertProtectedFactsPreserved } from "./text-rewrite-utils";

export const compressTextSchema = z.object({
  text: z.string().describe("需要压缩的长文本内容"),
  maxLength: z.number().int().min(8).max(4_000).describe("期望的压缩后最大字数"),
});

/**
 * Deferred Tool: 文本压缩与精简。
 * 用于将冗长的段落提炼为适合幻灯片展示的短语，保持核心事实与语义。
 */
export const compressTextTool: ToolDefinition<
  typeof compressTextSchema,
  { compressedText: string }
> = {
  name: "CompressText",
  description: "精简和压缩长文本，使其更符合幻灯片的简洁展示原则，同时保持其语义。",
  category: "deferred",
  loadPolicy: "deferred",
  inputSchema: compressTextSchema,
  risk: "low",
  execute: async (args, context) => {
    if (args.text.length <= args.maxLength) {
      return { compressedText: args.text };
    }
    if (!context.gateway) {
      throw new Error(
        "CompressText requires a configured model gateway; destructive substring fallback is disabled.",
      );
    }

    const resultSchema = z.object({
      compressedText: z.string().trim().min(1).max(args.maxLength),
    });
    const { compressedText } = await callLLMJson(
      context.gateway,
      {
        schema: resultSchema,
        schemaName: "compressed_slide_text",
        description: "Fact-preserving compressed slide text.",
        request: {
          systemPrompt: [
            "Compress presentation text without changing its factual meaning.",
            "Preserve every number, date, percentage, currency amount, URL, email, proper noun, and causal relationship.",
            "Do not cut a sentence mid-way. Do not add labels, commentary, or facts.",
          ].join("\n"),
          prompt: JSON.stringify({
            instruction: `Rewrite the text to at most ${args.maxLength} characters.`,
            text: args.text,
          }),
          signal: context.signal,
          maxOutputTokens: Math.min(4_096, Math.max(256, args.maxLength * 2)),
        },
      },
      context.model,
    );

    assertProtectedFactsPreserved(args.text, compressedText);
    return { compressedText };
  },
};
