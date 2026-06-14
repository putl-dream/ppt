import { z } from "zod";
import type { AgentModelSelection } from "@shared/agent";
import type { Presentation } from "@shared/presentation";
import type { AgentModelGateway } from "./gateway";

const outlineSlideSchema = z.object({
  title: z.string().trim().min(1),
  keyPoints: z.array(z.string().trim().min(1)).min(1).max(6),
});

const outlineSchema = z.object({
  title: z.string().trim().min(1),
  audience: z.string().trim().optional(),
  objective: z.string().trim().optional(),
  slides: z.array(outlineSlideSchema).min(1).max(19),
});

const outlineDecisionSchema = z.object({
  mode: z.enum(["chat", "ready", "outline-proposal", "needs-clarification"]),
  intent: z.enum(["chat", "create-presentation", "edit-presentation"]),
  assistantMessage: z.string().trim().min(1),
  outline: outlineSchema.optional(),
  missingInformation: z.array(z.string().trim().min(1)).max(5).default([]),
});

const modelOutlineDecisionSchema = z.object({
  mode: z.enum(["chat", "ready", "outline-proposal", "needs-clarification"]).optional(),
  intent: z.enum(["chat", "create-presentation", "edit-presentation"]).optional(),
  assistantMessage: z.string().optional(),
  outline: z.object({
    title: z.string().optional(),
    audience: z.string().optional(),
    objective: z.string().optional(),
    slides: z.array(z.object({
      title: z.string().optional(),
      keyPoints: z.array(z.string()).optional(),
    })).optional(),
  }).optional(),
  missingInformation: z.array(z.string()).optional(),
});

export type PresentationOutline = z.infer<typeof outlineSchema>;
export type OutlineDecision = z.infer<typeof outlineDecisionSchema>;

export interface OutlineConversationMessage {
  role: "user" | "assistant";
  content: string;
}

export interface OutlineReviewInput {
  messages: OutlineConversationMessage[];
  presentation: Presentation;
  model?: AgentModelSelection;
  draftOutline?: PresentationOutline;
}

export interface AgentOutlinePlanner {
  review(input: OutlineReviewInput): Promise<OutlineDecision>;
}

function parseJsonObject(text: string): unknown {
  const withoutFence = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = withoutFence.indexOf("{");
  const end = withoutFence.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("The model did not return an outline JSON object.");
  return JSON.parse(withoutFence.slice(start, end + 1));
}

function normalizeModelDecision(value: unknown): OutlineDecision {
  const parsed = modelOutlineDecisionSchema.safeParse(value);
  if (!parsed.success) {
    return {
      mode: "needs-clarification",
      intent: "create-presentation",
      assistantMessage: "请告诉我你想制作或修改什么主题的 PPT，我会先和你确认大纲。",
      missingInformation: ["PPT 主题或修改目标"],
    };
  }

  const raw = parsed.data;
  const slides = (raw.outline?.slides ?? []).flatMap((slide) => {
    const title = slide.title?.trim();
    const keyPoints = (slide.keyPoints ?? []).map((point) => point.trim()).filter(Boolean);
    return title && keyPoints.length > 0 ? [{ title, keyPoints: keyPoints.slice(0, 6) }] : [];
  });
  const outlineTitle = raw.outline?.title?.trim();
  const outline = outlineTitle && slides.length > 0
    ? {
      title: outlineTitle,
      audience: raw.outline?.audience?.trim() || undefined,
      objective: raw.outline?.objective?.trim() || undefined,
      slides: slides.slice(0, 19),
    }
    : undefined;
  let intent = raw.intent ?? "create-presentation";
  let mode = raw.mode ?? "needs-clarification";
  if (intent === "chat" || mode === "chat") {
    intent = "chat";
    mode = "chat";
  }
  if (intent === "create-presentation" && mode !== "needs-clarification" && !outline) {
    mode = "needs-clarification";
  }

  return outlineDecisionSchema.parse({
    mode,
    intent,
    assistantMessage: raw.assistantMessage?.trim() ||
      "请再补充一下 PPT 的主题、目标受众或希望包含的内容。",
    outline: mode === "chat" ? undefined : outline,
    missingInformation: mode === "chat" ? [] : (raw.missingInformation ?? [])
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 5),
  });
}

function compactPresentation(presentation: Presentation) {
  return {
    title: presentation.title,
    revision: presentation.revision,
    slides: presentation.slides.map((slide, index) => ({
      index,
      id: slide.id,
      title: slide.title,
    })),
  };
}

function isSmallTalk(request: string): boolean {
  return /^(?:hi|hello|hey|你好|您好|嗨|哈喽|谢谢|感谢|再见)[!！,.，。\s]*$/i.test(request.trim());
}

function isCompleteCreationOutline(decision: OutlineDecision): boolean {
  if (decision.intent === "edit-presentation") return true;
  return Boolean(
    decision.outline &&
    decision.outline.slides.length >= 3 &&
    decision.outline.slides.every((slide) => slide.keyPoints.length > 0),
  );
}

export function createModelOutlinePlanner(gateway: AgentModelGateway): AgentOutlinePlanner {
  return {
    async review(input) {
      const response = await gateway.generateText(
        {
          systemPrompt: [
            "You are the conversational planning stage of a presentation agent.",
            "Do not create presentation commands. Decide whether the user's request is ready for execution.",
            "Classify direct edits to an existing presentation as edit-presentation and ready.",
            "For greetings, small talk, or input unrelated to presentations, use mode=chat and intent=chat. Reply naturally in assistantMessage and omit outline.",
            "For a new presentation, mode=ready only when the USER has already supplied a concrete outline with at least 3 slides and content points for every slide.",
            "If the user only supplied a topic or goal, create a useful draft outline and use mode=outline-proposal so the user can confirm or revise it.",
            "Use mode=needs-clarification when essential intent is still ambiguous. You may still include a partial outline.",
            "Never treat an outline invented by the assistant as user-confirmed.",
            "Return only one JSON object. Do not use markdown.",
            'Shape: {"mode":"chat|ready|outline-proposal|needs-clarification","intent":"chat|create-presentation|edit-presentation","assistantMessage":"...","outline":{"title":"...","audience":"...","objective":"...","slides":[{"title":"...","keyPoints":["..."]}]},"missingInformation":["..."]}',
            "Write assistantMessage and outline content in the user's language.",
          ].join("\n"),
          prompt: [
            `Current presentation: ${JSON.stringify(compactPresentation(input.presentation))}`,
            `Current draft outline: ${input.draftOutline ? JSON.stringify(input.draftOutline) : "none"}`,
            "Conversation:",
            ...input.messages.map((message) => `${message.role.toUpperCase()}: ${message.content}`),
          ].join("\n"),
        },
        input.model,
      );

      const decision = normalizeModelDecision(parseJsonObject(response.text));
      const latestUserMessage = input.messages.filter((message) => message.role === "user").at(-1)?.content ?? "";
      if (isSmallTalk(latestUserMessage) && !decision.outline) {
        return {
          ...decision,
          mode: "chat",
          intent: "chat",
          missingInformation: [],
        };
      }
      if (decision.mode === "ready" && !isCompleteCreationOutline(decision)) {
        return {
          ...decision,
          mode: decision.outline ? "outline-proposal" : "needs-clarification",
          assistantMessage: decision.outline
            ? "我先整理了一版大纲，请确认或继续修改后再生成 PPT。"
            : decision.assistantMessage,
        };
      }
      return decision;
    },
  };
}

function outlineFromLines(request: string): PresentationOutline | undefined {
  const lines = request.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const slideLines = lines.filter((line) => /^(?:\d+[.、)]|[-*#])\s*/.test(line));
  if (slideLines.length < 3) return undefined;
  return {
    title: lines[0].replace(/^(?:主题|标题)[:：]\s*/, ""),
    slides: slideLines.map((line) => ({
      title: line.replace(/^(?:\d+[.、)]|[-*#])\s*/, ""),
      keyPoints: [line.replace(/^(?:\d+[.、)]|[-*#])\s*/, "")],
    })),
  };
}

export function createDeterministicOutlinePlanner(): AgentOutlinePlanner {
  return {
    async review({ messages }) {
      const request = messages.filter((message) => message.role === "user").at(-1)?.content.trim() ?? "";
      if (isSmallTalk(request)) {
        return {
          mode: "chat",
          intent: "chat",
          assistantMessage: /谢谢|感谢/.test(request)
            ? "不客气。需要制作或修改 PPT 时，直接告诉我主题或具体调整即可。"
            : "你好！我可以陪你聊聊，也可以帮你制作或修改 PPT。",
          missingInformation: [],
        };
      }
      const directEdit = /(?:修改|更改|替换|删除|新增一页|优化第|change|update|remove|delete|add (?:a )?slide)/i.test(request);
      if (directEdit) {
        return {
          mode: "ready",
          intent: "edit-presentation",
          assistantMessage: "这是明确的现有演示文稿编辑请求，可以直接执行。",
          missingInformation: [],
        };
      }

      const outline = outlineFromLines(request);
      if (outline) {
        return {
          mode: "ready",
          intent: "create-presentation",
          assistantMessage: "用户已经提供了可执行的大纲。",
          outline,
          missingInformation: [],
        };
      }

      const title = request || "未命名演示文稿";
      return {
        mode: "outline-proposal",
        intent: "create-presentation",
        assistantMessage: "我先根据主题整理了一版大纲。请确认内容方向，或继续告诉我需要调整的部分。",
        outline: {
          title,
          slides: [
            { title: "背景与目标", keyPoints: ["说明主题背景和演示目标"] },
            { title: "核心内容", keyPoints: ["展开关键观点与主要方案"] },
            { title: "行动与总结", keyPoints: ["归纳结论并给出下一步行动"] },
          ],
        },
        missingInformation: ["目标受众", "期望页数或详略程度"],
      };
    },
  };
}

export function outlineToRequest(outline: PresentationOutline): string {
  return [
    `请严格根据以下已确认大纲生成演示文稿。标题：${outline.title}`,
    outline.audience ? `目标受众：${outline.audience}` : undefined,
    outline.objective ? `演示目标：${outline.objective}` : undefined,
    ...outline.slides.map((slide, index) =>
      `${index + 1}. ${slide.title}\n${slide.keyPoints.map((point) => `- ${point}`).join("\n")}`,
    ),
  ].filter(Boolean).join("\n");
}
