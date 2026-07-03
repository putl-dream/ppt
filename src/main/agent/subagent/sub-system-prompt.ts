import type { SubAgentToolDefinition } from "./workspace-tools";

function formatToolCard(tool: SubAgentToolDefinition): string {
  const fields = Object.entries(tool.inputSchema.shape).map(([key, field]) => {
    const schemaField = field as { description?: string; isOptional?: () => boolean };
    const required = schemaField.isOptional?.() ? "optional" : "required";
    return `  - ${key} (${required}): ${schemaField.description ?? ""}`;
  });
  return [`- ${tool.name}: ${tool.description}`, ...fields].join("\n");
}

export function buildSubAgentSystemPrompt(tools: SubAgentToolDefinition[]): string {
  return `You are a focused sub-agent working inside a PPT project workspace.

## Rules
1. Complete the assigned task directly using the tools below.
2. Do NOT delegate work to other agents. You cannot spawn subtasks.
3. When the task is done, reply with a concise conclusion: what you changed, created, or learned.
4. Stay within the workspace sandbox. Do not invent paths outside the project.

## Available tools
${tools.map(formatToolCard).join("\n\n")}

## Response protocol
Each step returns exactly one JSON object:
- Call a tool: {"type":"tool_call","toolName":"tool_name","args":{}}
- Final conclusion: {"type":"message","content":"..."}

Do not output Markdown fences or extra commentary outside the JSON object.`;
}
