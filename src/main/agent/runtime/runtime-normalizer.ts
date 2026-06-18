import type { AgentRuntimeResult } from "./runtime-types";
import { presentationCommandSchema } from "@shared/commands";

/**
 * 模型最终响应的协议归一化与校验判定。
 *
 * 负责把供应商响应解析并校验为合法的 message、ask_user 或 command_proposal，
 * 拒绝缺少关键字段、包含非法风险等级或无法识别的结构。
 */
export class RuntimeNormalizer {
  /**
   * 校验并归一化模型返回的原始响应结构。
   * 如果不符合规范，则抛出校验异常，迫使 Runtime 重新生成或进行错误反馈。
   */
  static normalize(raw: any): AgentRuntimeResult {
    if (!raw || typeof raw !== "object") {
      throw new Error("Invalid model response: response must be a non-null object.");
    }

    const type = raw.type;
    if (type !== "message" && type !== "ask_user" && type !== "command_proposal" && type !== "artifact_patch") {
      throw new Error(`Invalid model response type: '${type}'. Expected 'message', 'ask_user', 'command_proposal' or 'artifact_patch'.`);
    }

    if (type === "artifact_patch") {
      if (typeof raw.targetPath !== "string" || raw.targetPath.trim() === "") {
        throw new Error("Validation error: 'artifact_patch' response must contain a non-empty string in 'targetPath'.");
      }
      if (typeof raw.patch !== "string" || raw.patch.trim() === "") {
        throw new Error("Validation error: 'artifact_patch' response must contain a non-empty string in 'patch'.");
      }
      if (typeof raw.summary !== "string" || raw.summary.trim() === "") {
        throw new Error("Validation error: 'artifact_patch' response must contain a non-empty string in 'summary'.");
      }
      const risk = raw.risk ?? "low";
      if (risk !== "low" && risk !== "medium" && risk !== "high") {
        throw new Error(`Validation error: 'artifact_patch' contains invalid risk level: '${risk}'. Expected 'low', 'medium' or 'high'.`);
      }
      return {
        type: "artifact_patch",
        targetPath: raw.targetPath,
        patch: raw.patch,
        summary: raw.summary,
        risk: risk,
      };
    }

    if (type === "message") {
      if (typeof raw.content !== "string" || raw.content.trim() === "") {
        throw new Error("Validation error: 'message' response must contain a non-empty string in 'content'.");
      }
      return {
        type: "message",
        content: raw.content,
      };
    }

    if (type === "ask_user") {
      if (typeof raw.message !== "string" || raw.message.trim() === "") {
        throw new Error("Validation error: 'ask_user' response must contain a non-empty string in 'message'.");
      }
      return {
        type: "ask_user",
        message: raw.message,
        missingFields: Array.isArray(raw.missingFields) ? raw.missingFields.map(String) : undefined,
      };
    }

    // type === "command_proposal"
    if (typeof raw.summary !== "string" || raw.summary.trim() === "") {
      throw new Error("Validation error: 'command_proposal' response must contain a non-empty string in 'summary'.");
    }

    if (!Array.isArray(raw.commands)) {
      throw new Error("Validation error: 'command_proposal' response must contain an array of 'commands'.");
    }
    if (raw.commands.length === 0) {
      throw new Error("Validation error: 'command_proposal' must contain at least one command.");
    }
    const commands = raw.commands.map((command: unknown, index: number) => {
      const parsed = presentationCommandSchema.safeParse(command);
      if (!parsed.success) {
        throw new Error(`Validation error: command ${index} is invalid: ${parsed.error.message}`);
      }
      return parsed.data;
    });

    const risk = raw.risk;
    if (risk !== "low" && risk !== "medium" && risk !== "high") {
      throw new Error(`Validation error: 'command_proposal' contains invalid risk level: '${risk}'. Expected 'low', 'medium' or 'high'.`);
    }

    return {
      type: "command_proposal",
      summary: raw.summary,
      commands,
      risk: risk,
      assumptions: Array.isArray(raw.assumptions) ? raw.assumptions.map(String) : undefined,
    };
  }
}
