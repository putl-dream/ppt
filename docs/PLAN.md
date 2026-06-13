# Agent PPT Execution Plan

## Product principle

Local-first, file-as-project, Agent-operated, and always user-editable.

## Architecture boundaries

- Electron main process owns filesystem access, project persistence, Agent runtime, and command execution.
- React renderer owns presentation and approval UI only.
- Shared presentation core is model-independent and Electron-independent.
- LangGraph stores workflow state, not the canonical presentation document.
- Every user or Agent mutation is a validated, reversible presentation command.

## Phase 1: Vertical foundation

- Build Electron, React, and TypeScript shell.
- Define presentation document and command schemas.
- Implement execute, undo, and redo.
- Implement LangGraph flow: understand, propose, validate, interrupt, apply.
- Expose workflow through narrow IPC.
- Verify with tests, typecheck, and production build.

Exit condition: a user request can produce command proposals, pause for approval, apply them, and update the visible presentation.

## Phase 2: Real project persistence

- Define a portable project directory format.
- Save canonical presentation JSON and assets atomically.
- Replace in-memory repositories and checkpointer with SQLite-backed implementations.
- Add crash recovery and recent-project support.

Exit condition: projects and paused Agent tasks survive application restarts.

## Phase 3: Editable slide canvas

- Add slide thumbnails, selection, and a 16:9 canvas.
- Render text, shapes, and images from the canonical model.
- Add direct manipulation and property editing through the same command bus.
- Add autosave and revision conflict checks.

Exit condition: Agent and manual edits use one mutation model and remain undoable.

## Phase 4: Model and design Agent

- Add provider-neutral model configuration.
- Replace deterministic proposal node with structured model output.
- Add slide inspection, layout, rewrite, and style tools.
- Add render-based validation and revision loops.

Exit condition: the Agent can create and revise a small coherent deck without bypassing validation.

## Phase 5: PPTX boundary

- Export canonical slides to PPTX.
- Import a deliberately limited PPTX subset.
- Add compatibility fixtures and visual regression checks.

Exit condition: a three-to-five-slide editable project exports reliably to PowerPoint.

## Explicitly deferred

- Accounts, cloud sync, collaboration, online template marketplace
- Multi-agent orchestration
- Full-fidelity arbitrary PPTX import
- Plugin ecosystem

