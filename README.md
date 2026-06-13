# Agent PPT

A local-first desktop presentation editor powered by Electron, React, TypeScript, and LangGraph.

## Current vertical slice

- Presentation document model
- Reversible command bus
- LangGraph proposal, validation, approval, and apply flow
- Narrow Electron IPC bridge
- Minimal React UI for running and approving Agent changes
- Provider-neutral Agent gateway backed by the official OpenAI and Anthropic SDKs

## Model setup

Choose an OpenAI or Anthropic model in the settings dialog and enter its API key. The key is kept in main-process memory for the current app session and is not added to LangGraph state.

For development, credentials can also be supplied through the process environment:

```powershell
$env:AGENT_PROVIDER="openai"
$env:OPENAI_API_KEY="..."
npm.cmd run dev
```

See [.env.example](.env.example) for optional model, endpoint, timeout, and output-token overrides.

See [docs/AGENT_GATEWAY.md](docs/AGENT_GATEWAY.md) for the gateway architecture, configuration priority, usage, errors, tests, and provider-extension guide.

## Commands

```powershell
npm.cmd install
npm.cmd run dev
npm.cmd test
npm.cmd run build
```

See [docs/PLAN.md](docs/PLAN.md) for architecture decisions and milestones.
