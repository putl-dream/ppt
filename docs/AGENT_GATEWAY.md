# Agent Gateway

## 1. Purpose

The Agent Gateway is the model-provider boundary of Agent PPT. It gives the Agent workflow one stable interface while keeping OpenAI and Anthropic SDK details inside the Electron main process.

The current gateway supports:

- OpenAI through the official `openai` TypeScript SDK and the Responses API.
- Anthropic through the official `@anthropic-ai/sdk` package and the Messages API.
- Runtime model selection and API-key configuration from the renderer settings dialog.
- Environment-based configuration for local development and deployment.
- Common response and error types across providers.
- Provider timeouts, retries, custom base URLs, and output-token limits.

The gateway currently exposes text generation only. Streaming, tool calls, embeddings, image generation, and provider fallback are not implemented yet.

## 2. Architecture

```text
Renderer settings
      |
      | AgentModelSettings over IPC
      v
Electron main process
      |
      +-- AgentGateway.configure()      stores the API key in memory
      |
      +-- AgentService.start()          receives provider + model only
              |
              v
         LangGraph propose node
              |
              v
    ModelPresentationPlanner
              |
              v
         AgentGateway
          /       \
     OpenAI      Anthropic
     adapter      adapter
```

There are three important boundaries:

1. `AgentGateway` selects a provider and returns one normalized response shape.
2. Provider adapters translate the common request into each SDK's native request.
3. `ModelPresentationPlanner` converts model text into validated presentation commands.

The gateway does not mutate a presentation. All mutations still pass through `PresentationCommand`, approval, validation, and `CommandBus`.

## 3. Main Types

The public interface is defined in `src/main/agent/gateway/types.ts`:

```ts
interface AgentModelGateway {
  generateText(
    request: AgentModelRequest,
    selection?: AgentModelSelection,
  ): Promise<AgentModelResponse>;
}
```

Common request:

```ts
interface AgentModelRequest {
  prompt: string;
  systemPrompt?: string;
}
```

Common response:

```ts
interface AgentModelResponse {
  provider: "openai" | "anthropic";
  model: string;
  text: string;
  requestId?: string;
  stopReason?: string;
}
```

## 4. Configuration

### Settings dialog

Select a model and enter its API key in the application settings. When an Agent run starts:

1. The renderer sends `provider`, `model`, and `apiKey` over the narrow IPC method.
2. `AgentGateway.configure()` stores the complete settings in main-process memory.
3. It returns a new selection containing only `provider` and `model`.
4. Only that key-free selection is passed into LangGraph state.

The API key is lost when the application exits. This is intentional until a secure credential-store integration is added.

### Environment variables

PowerShell example:

```powershell
$env:AGENT_PROVIDER="openai"
$env:OPENAI_API_KEY="sk-..."
$env:AGENT_MODEL="gpt-5.5"
npm.cmd run dev
```

Anthropic example:

```powershell
$env:AGENT_PROVIDER="anthropic"
$env:ANTHROPIC_API_KEY="sk-ant-..."
$env:AGENT_MODEL="claude-sonnet-4-6"
npm.cmd run dev
```

Supported variables:

| Variable | Purpose |
| --- | --- |
| `AGENT_PROVIDER` | `openai` or `anthropic` |
| `AGENT_MODEL` | Shared model override |
| `OPENAI_API_KEY` | OpenAI credential |
| `OPENAI_MODEL` | OpenAI-specific model fallback |
| `OPENAI_BASE_URL` | OpenAI-compatible endpoint override |
| `ANTHROPIC_API_KEY` | Anthropic credential |
| `ANTHROPIC_MODEL` | Anthropic-specific model fallback |
| `ANTHROPIC_BASE_URL` | Anthropic endpoint override |
| `AGENT_TIMEOUT_MS` | Request timeout; default `60000` |
| `AGENT_MAX_OUTPUT_TOKENS` | Output limit; default `2048` |

The application does not currently load `.env` files itself. `.env.example` documents available variables; set them in the launching process or add an explicit environment loader later.

### Resolution priority

Provider selection uses this order:

1. Explicit selection passed by the current Agent run.
2. `AGENT_PROVIDER`.
3. Infer Anthropic when only `ANTHROPIC_API_KEY` exists.
4. Default to OpenAI.

Credential resolution uses runtime settings before environment variables.

Model resolution uses this order:

1. Current run selection.
2. Runtime settings.
3. `AGENT_MODEL`.
4. Provider-specific model variable.
5. Provider default in `DEFAULT_AGENT_MODELS`.

## 5. Direct Usage

Most application code should call the planner instead of calling a provider adapter directly:

```ts
const gateway = new AgentGateway();
const selection = gateway.configure({
  provider: "openai",
  model: "gpt-5.5",
  apiKey: "...",
});

const result = await gateway.generateText(
  {
    systemPrompt: "Return a concise presentation outline.",
    prompt: "Create a product launch presentation.",
  },
  selection,
);

console.log(result.text);
```

For the normal application flow, `src/main/index.ts` creates one gateway and injects it into `createModelPresentationPlanner()`. The planner is then injected into `AgentService`.

## 6. Error Model

Provider failures are normalized as `AgentGatewayError`:

| Code | Meaning |
| --- | --- |
| `configuration` | Missing key, unsupported provider, or invalid numeric setting |
| `authentication` | Provider returned HTTP 401 or 403 |
| `rate-limit` | Provider returned HTTP 429 |
| `timeout` | HTTP 408 or a timeout-style SDK error |
| `empty-response` | Provider completed without usable text |
| `provider-error` | Other provider or network failure |

The error preserves the provider and original cause so the IPC/service layer can later map it to user-facing recovery actions without depending on SDK-specific error classes.

## 7. Tests

The gateway tests never call external APIs.

- `agent-gateway.test.ts`: configuration precedence, defaults, validation, and missing credentials.
- `agent-gateway-routing.test.ts`: provider routing and API-key removal from Graph selection.
- `agent-gateway-errors.test.ts`: common error normalization.
- `openai-gateway-adapter.test.ts`: OpenAI SDK request and response translation.
- `anthropic-gateway-adapter.test.ts`: Anthropic SDK request and response translation.
- `agent-planner.test.ts`: conversion from gateway output to presentation commands.

Run them with:

```powershell
npm.cmd test
```

Run one file while developing:

```powershell
npx.cmd vitest run tests/openai-gateway-adapter.test.ts
```

## 8. Adding Another Provider

To add another provider:

1. Add its name to `agentProviderSchema` in `src/shared/agent.ts`.
2. Add provider configuration and defaults in `gateway/config.ts`.
3. Implement an adapter that accepts `ResolvedAgentModelConfig` and `AgentModelRequest`.
4. Return `AgentModelResponse` and normalize errors with `AgentGatewayError`.
5. Add routing in `AgentGateway.generateText()`.
6. Add adapter, routing, configuration, and error tests.
7. Add model choices to the renderer only after the backend path is tested.

Keep provider SDK types inside the adapter. Planner, workflow, IPC result, and presentation command code should continue using the gateway's common types.

## 9. Next Capabilities

The natural next gateway additions are:

1. Streaming events with a provider-neutral async iterator.
2. Structured-output helpers so planners do not parse JSON manually.
3. Abort signals for user cancellation.
4. Usage and latency metadata for observability.
5. Retry policy based on normalized error codes.
6. Secure API-key storage using the operating system credential store.
