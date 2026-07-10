# PPT Workflow Reliability Fix Plan

## Background

The captured workflow shows a repeated failure pattern across `brief.md`, `outline.md`, and
`slides/storyboard.json`: the agent cannot reliably distinguish a verified artifact from a
partial write, a previous failed attempt, or a stale transcript summary. After context compaction,
the agent often re-infers state from logs and repeats reads/writes.

## Problems

1. File writes are not atomic. A failed or interrupted `write_file` can leave a partial artifact
   that later looks successful enough to continue.
2. Artifact probing only checks for non-default content. It does not record `pending`, `writing`,
   `verified`, or `failed` state for each workflow artifact.
3. Task completion can happen after a successful tool call rather than after artifact validation.
4. Subtasks receive too much conversational history and can confuse old failures with current
   state.
5. Context compaction recovery depends on transcript summaries instead of reading durable state.
6. `SubmitCommands` approval has no durable separation between submitted, waiting for approval,
   approved, and applied.

## Phase 1: Durable State And Atomic Writes

1. Introduce a workflow artifact state module that validates `brief`, `outline`, and `storyboard`
   artifacts and reports a stable status.
2. Make workspace text writes atomic by writing to a temp file, verifying the content was written,
   and renaming it into place.
3. Add structured validation for:
   - `brief.md`: meaningful markdown with purpose/audience/page planning signals.
   - `outline.md`: meaningful markdown with slide/page structure and section-divider guidance.
   - `slides/storyboard.json`: valid JSON with ten or more slide objects containing title,
     narrative role, layout, and key points.

## Phase 2: Idempotent Workflow Progression

1. Update artifact probing to expose validated artifact details instead of only booleans.
2. Skip already verified artifacts instead of rewriting them.
3. Ensure task completion is gated by artifact validation.

## Phase 3: Recovery And Approval Semantics

1. Add compact-recovery guidance that reads durable artifact state before continuing a workflow.
2. Model command submission approval separately from command execution.
3. Prevent a submitted-but-waiting command batch from being treated as completed slide generation.

## Initial Code Changes

This repair pass will start with Phase 1 because it directly addresses the observed unstable
document writes and repeated execution. The intended edits are:

1. Replace direct workspace file writes with atomic writes in the subagent file operations layer.
2. Add reusable artifact validators for `brief`, `outline`, and `storyboard`.
3. Extend workspace artifact probing so callers can inspect validation status and reasons.
4. Add tests covering atomic writes and validated artifact probing.

## Additional Findings From Follow-Up Trace

The second captured workflow adds three more reliability gaps:

1. The initial `TaskGraphCreatePlan` can be scoped too narrowly to `discover`, causing the agent to
   create a second plan when the user says "continue" and the workflow enters `author`.
2. Planning agents naturally emit narrative-arc words such as `context`, `shift`, and `takeaway`,
   but the storyboard schema only accepted the narrower execution roles.
3. Outline and storyboard page counts can drift. In the trace, a target of roughly 12 pages became
   a 13-page storyboard while still being treated as completed.

Follow-up repairs:

1. Treat a user objective as one TaskGraph. Phase transitions and "continue" should reuse the
   existing graph and verified artifacts rather than creating a fresh plan.
2. Normalize common storyboard narrative-role aliases into supported execution roles.
3. Cross-check verified `outline.md` page count against `slides/storyboard.json` slide count before
   allowing storyboard to become a verified artifact.
