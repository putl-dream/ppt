# Agent Tools and Permissions Management

## Current Shape

Agent tools are split across three enforcement surfaces:

1. **Main runtime tools**
   - Defined by `ToolDefinition` in `src/main/agent/tools/tool-definition.ts`.
   - Registered through `createDefaultToolRegistry()`.
   - Exposed to the model as Core tools, Deferred tools, or Runtime-only tools by `ToolLoader`.
   - Deferred tools must be discovered through `SearchExtraTools` before `ExecuteExtraTool` can call them.

2. **Sub-agent workspace tools**
   - Defined in `src/main/agent/subagent/workspace-tools.ts`.
   - Include `read_file`, `write_file`, `edit_file`, `ensure_dir`, `glob`, and `bash`.
   - Protected by the shared `PreToolUse` hook before execution.

3. **Presentation command commit gate**
   - `SubmitCommands` only returns a proposal.
   - Real presentation writes happen after `CommitGate + RiskPolicy`.
   - This is intentionally separate from tool execution permission.

## Problems Found

- Tool exposure and permission enforcement were not managed from one place.
- `risk` was shown to the model through `ToolCard.approvalRequired`, but runtime approval did not consume that same metadata.
- Sub-agent workspace tools had no explicit permission profile in their definitions.
- Path and shell permission rules lived directly inside `permission-check.ts`, which made future policy changes hard to audit.

## Policy Model

`src/main/agent/runtime/tool-access-policy.ts` is now the central policy surface for:

- `ToolRisk`
- `ToolPermissionProfile`
- sub-agent workspace tool profiles
- hard-deny shell patterns
- contextual approval rules
- risk-based approval hints for model-visible tool cards

Policy decisions still produce the same three outcomes:

- `allow`
- `require_approval`
- `deny`

The current behavior is preserved:

- dangerous shell patterns are denied
- delete commands require approval
- file access outside the workspace requires approval
- in-workspace reads and writes are allowed

## Next Consolidation Steps

1. Add permission profiles to all main `ToolDefinition`s, not only sub-agent tools.
2. Decide whether medium/high `ToolRisk` should remain a model-visible hint or become an enforced approval rule for selected tool classes.
3. Route `ExecuteExtraTool` target-tool permission through the same policy, so the wrapper and the deferred target are both auditable.
4. Add user-facing settings for profile-level enable/disable, for example workspace shell, export, deferred beautify tools, and sub-agent delegation.
5. Add an audit view that lists enabled tools, profile, effects, sandbox, approval mode, and load policy.
