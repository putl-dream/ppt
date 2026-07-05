# Agent PPT

A local-first desktop presentation editor powered by Electron, React, and TypeScript.

## Current vertical slice

- Presentation document model with reversible command bus
- Model-driven Agent runtime (custom loop with Core / Deferred tools, hooks, and native tool-use when supported)
- Six-stage prompt routing (`discover` → `author` → `design` → `style` → `edit` → `export`)
- Commit Gate for proposal validation, risk scoring, and user approval before apply
- Narrow Electron IPC bridge and minimal React UI for running and approving Agent changes
- Provider-neutral Agent gateway backed by the official OpenAI and Anthropic SDKs
- Workspace artifacts (brief, outline, storyboard, layout-plan) and sub-agent task execution

## Model setup

Choose an OpenAI or Anthropic model in the settings dialog and enter its API key. The key is kept in main-process memory for the current app session and is not written to disk.

For development, credentials can also be supplied through the process environment (see [.env.example](.env.example) for optional CI overrides).

```powershell
$env:OPENAI_API_KEY="..."
npm.cmd run dev
```

Open **Settings → 模型** to configure API keys, endpoints, timeout, output limits, and fallback models. These values are stored locally and sent to the main process per request—not committed to `.env`.

## Commands

```powershell
npm.cmd install
npm.cmd run dev
npm.cmd test
npm.cmd run build
```

See [docs/PLAN.md](docs/PLAN.md) for architecture decisions and milestones.
