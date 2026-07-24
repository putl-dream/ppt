# Task protocol test migration map

The legacy `tests/task-graph.test.ts` contract was removed after its product assertions were
replaced by the v1 protocol suites below.

| Legacy coverage | Replacement |
|---|---|
| per-task JSON, `_meta.json`, `_plan.json` | `task-store.test.ts`: canonical list, migration marker, partial migration |
| create-plan and active-plan restriction | `task-protocol.test.ts`: explicit `TaskCreate`; `task-store.test.ts`: dependency CAS |
| claim changes status and process claim recovery | `task-protocol.test.ts`: claim changes owner only; watcher recovery ordering |
| `submitted` and complete | `task-store.test.ts`: requested/rejected/approved review lifecycle |
| one-way `blockedBy` | `task-store.test.ts`: bidirectional edges, cycles and exact revisions |
| old model tool registration | `task-protocol.test.ts`: exact responsibility-separated `Task*` registry |
| autonomous worker spawned by CRUD | `layout-choice-orchestrator.test.ts`: CRUD does not spawn; watcher consumes independently |
| shutdown resets task to pending | `teammate-message-bus.test.ts`: owner release preserves status |
| task graph UI trace | `agent-activity-trace.test.ts`, `session-store.test.ts`: task-list snapshot trace |
| single-process publish callback | `task-store.test.ts`: signal/watch/poll subscription revision dedupe |

Additional v1-only coverage lives in:

- `tests/task-store.test.ts`
- `tests/task-protocol.test.ts`
- `tests/teammate-message-bus.test.ts`
- `tests/layout-choice-orchestrator.test.ts`
