import { z } from "zod";
import {
  pptJobProjectionSchema,
  type PptJobProjection,
} from "@shared/presentation-lifecycle";
import type { ToolDefinition } from "../tool-definition";
import { probeWorkspaceArtifacts } from "../../runtime/presentation/workspace-artifacts";
import { formatSvgDeckLockBootstrapGuidance } from "./svg-deck-locks";

export const beginPptCapabilitySchema = z.object({
  capability: z.enum(["create", "edit", "restyle", "review"]),
  instruction: z.string().trim().min(1).max(20_000).optional(),
}).strict();

/**
 * Explicitly binds a generic Query to the long-lived Presentation Job.
 * Queries that only answer questions never call this tool and remain Query-only.
 */
export const beginPptCapabilityTool: ToolDefinition<
  typeof beginPptCapabilitySchema,
  PptJobProjection
> = {
  name: "BeginPptCapability",
  description:
    "开始一项可持久化的 PPT 业务请求。进行新建、编辑、重做风格或结构化审查前必须先调用一次；"
    + "普通问答不要调用；导出由应用内部创建 capability。后续 Presentation 工具只接受同一 Query 已声明的 capability。"
    + "create 时会返回 SVG deck 锁文件作者指引（design-spec / page-plan）。",
  category: "core",
  loadPolicy: "core",
  inputSchema: beginPptCapabilitySchema,
  outputSchema: pptJobProjectionSchema,
  isEnabled: (context) => Boolean(context.presentationLifecycle),
  risk: "low",
  mapResultToModelContent: async (result, context) => {
    const base = JSON.stringify(result);
    if (result.capability !== "create") return base;
    const artifacts = context.workspaceRoot
      ? await probeWorkspaceArtifacts(context.workspaceRoot)
      : undefined;
    if (artifacts?.designSpec && artifacts.pagePlan) return base;
    return `${base}\n\n${formatSvgDeckLockBootstrapGuidance()}`;
  },
  execute: async (args, context) => {
    if (!context.presentationLifecycle) {
      throw new Error("Presentation lifecycle is unavailable in this runtime.");
    }
    context.presentationLifecycle.beginCapability({
      capability: args.capability,
      instruction: args.instruction ?? context.request ?? "",
    });
    const active = context.presentationLifecycle.requireActiveCapability([
      args.capability,
    ]);
    if (context.workspaceRoot) {
      await context.presentationLifecycle.observeArtifactChanges({
        workspaceRoot: context.workspaceRoot,
        source: "capability_probe",
      });
      return context.presentationLifecycle.requireActiveCapability([
        args.capability,
      ]);
    }
    return active;
  },
};
