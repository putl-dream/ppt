import type { ToolDefinition } from "./tool-definition";
import { ToolLoader } from "./tool-loader";
import { askUserTool } from "./core/ask-user";
import { executeExtraToolTool } from "./core/execute-extra-tool";
import { getSelectionTool } from "./core/get-selection";
import { listSlidesTool } from "./core/list-slides";
import { previewCommandsTool } from "./core/preview-commands";
import { readCurrentSlideTool } from "./core/read-current-slide";
import { readPresentationSnapshotTool } from "./core/read-presentation-snapshot";
import { searchExtraToolsTool } from "./core/search-extra-tools";
import { submitCommandsTool } from "./core/submit-commands";
import { taskTool } from "./core/task";
import { todoWriteTool } from "./core/todo-write";
import { taskGraphTools } from "./core/task-graph-tools";
import { loadSkillTool } from "./core/load-skill";
import { analyzeDeckConsistencyTool } from "./deferred/analyze-deck-consistency";
import { applyThemeStyleTool } from "./deferred/apply-theme-style";
import { autoLayoutSlideTool } from "./deferred/auto-layout-slide";
import { beautifyChartTool } from "./deferred/beautify-chart";
import { beautifyTableTool } from "./deferred/beautify-table";
import { compressTextTool } from "./deferred/compress-text";
import { detectOverflowTextTool } from "./deferred/detect-overflow-text";
import { detectRepeatedTitlesTool } from "./deferred/detect-repeated-titles";
import { exportPptxTool } from "./deferred/export-pptx";
import { rewriteSlideContentTool } from "./deferred/rewrite-slide-content";
import { selectStyleStrategyTool } from "./deferred/select-style-strategy";
import { insertSlideImageTool } from "./deferred/insert-slide-image";
import { addLayoutDecorationsTool } from "./deferred/add-layout-decorations";
import { applyTypographyTool } from "./deferred/apply-typography";
import { previewSlideTool } from "./deferred/preview-slide";
import { validateDeckLayoutTool } from "./deferred/validate-deck-layout";
import { updateSlideVariantTool } from "./deferred/update-slide-variant";

/**
 * 工具注册表与唯一查询入口。
 *
 * 负责注册、按名称获取、列出 Core/Deferred 工具，以及只在 Deferred Tools 中进行模糊或精确搜索。
 * Runtime Tools 可以登记供系统使用，但绝对不能通过模型搜索结果或执行器暴露给外部。
 */
export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition<any, any>>();

  /**
   * 注册单个工具，注册时进行基本安全约束检查
   */
  register(tool: ToolDefinition<any, any>): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool already registered: ${tool.name}`);
    }
    
    // 安全校验：核心工具和延迟工具不允许混淆 category 和 loadPolicy
    if (tool.category === "core" && tool.loadPolicy === "runtime") {
      throw new Error("Core tools cannot have runtime load policy");
    }
    if (tool.category === "runtime" && (tool.loadPolicy === "core" || tool.loadPolicy === "deferred")) {
      throw new Error("Runtime-only tools cannot be exposed as core or deferred to the model");
    }

    this.tools.set(tool.name, tool);
  }

  /**
   * 获取任意已注册的工具（供系统或 ExecuteExtraTool 使用，ExecuteExtraTool 需做额外权限判定）
   */
  get(name: string): ToolDefinition<any, any> | undefined {
    return this.tools.get(name);
  }

  /**
   * 列出所有核心工具
   */
  getCoreTools(): ToolDefinition<any, any>[] {
    return ToolLoader.loadCoreTools(Array.from(this.tools.values()));
  }

  /**
   * 获取所有注册的延迟工具
   */
  getDeferredTools(): ToolDefinition<any, any>[] {
    return ToolLoader.loadDeferredTools(Array.from(this.tools.values()));
  }

  /**
   * 搜索可发现的延迟工具（Deferred Tools），排除 core、runtime 和 disabled。
   * 支持模糊匹配名称或描述。
   */
  searchDeferredTools(query: string): ToolDefinition<any, any>[] {
    const deferred = this.getDeferredTools();
    const trimmed = query.trim();
    if (!trimmed) {
      return deferred;
    }
    if (trimmed.toLowerCase().startsWith("select:")) {
      const names = new Set(
        trimmed.slice("select:".length).split(/\s+/).filter(Boolean).map((name) => name.toLowerCase()),
      );
      return deferred.filter((tool) => names.has(tool.name.toLowerCase()));
    }
    const words = trimmed.toLowerCase().split(/\s+/).filter(Boolean);
    return deferred.filter((tool) => {
      const searchable = `${tool.name} ${tool.description}`.toLowerCase();
      return words.some((word) => searchable.includes(word));
    });
  }
}

export function createDefaultToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  [
    askUserTool,
    executeExtraToolTool,
    getSelectionTool,
    listSlidesTool,
    previewCommandsTool,
    readCurrentSlideTool,
    readPresentationSnapshotTool,
    searchExtraToolsTool,
    submitCommandsTool,
    taskTool,
    todoWriteTool,
    ...taskGraphTools,
    loadSkillTool,
    analyzeDeckConsistencyTool,
    applyThemeStyleTool,
    autoLayoutSlideTool,
    beautifyChartTool,
    beautifyTableTool,
    compressTextTool,
    detectOverflowTextTool,
    detectRepeatedTitlesTool,
    exportPptxTool,
    rewriteSlideContentTool,
    selectStyleStrategyTool,
    insertSlideImageTool,
    addLayoutDecorationsTool,
    applyTypographyTool,
    previewSlideTool,
    validateDeckLayoutTool,
    updateSlideVariantTool,
  ].forEach((tool) => registry.register(tool));
  return registry;
}
