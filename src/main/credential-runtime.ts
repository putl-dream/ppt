import {
  type AgentModelSelection,
  type AgentModelSettings,
  agentModelSelectionSchema,
} from "@shared/agent";
import {
  type AgentGatewayConfig,
  type AgentRunServicesWire,
  type AgentSearchConfig,
  agentRunServicesWireSchema,
  DEFAULT_WEB_SEARCH_ENDPOINT,
  splitAgentRunServicesConfig,
} from "@shared/agent-gateway-config";
import {
  type CredentialStatusRequest,
  type CredentialStatusSnapshot,
  credentialStatusRequestSchema,
  modelCredentialBindingFromSelection,
} from "@shared/credentials";
import { type CredentialStore, CredentialStoreError } from "./credential-store";
import {
  resolveEnvironmentModelApiKey,
  resolveEnvironmentWebSearchApiKey,
} from "./environment-credential-policy";

export interface HydratedAgentRunServices {
  gateway: AgentGatewayConfig;
  search: AgentSearchConfig;
}

async function resolveStoredModelKey(
  credentialStore: CredentialStore,
  selection: AgentModelSelection,
): Promise<string | undefined> {
  if (!selection.vendorId) return undefined;
  try {
    return await credentialStore.resolveModelCredential(
      modelCredentialBindingFromSelection(selection),
    );
  } catch (error) {
    if (error instanceof CredentialStoreError && error.code === "STORAGE_UNAVAILABLE") {
      return undefined;
    }
    throw error;
  }
}

export async function hydrateAgentModelSettings(
  credentialStore: CredentialStore,
  input: unknown,
): Promise<AgentModelSettings> {
  const selection = agentModelSelectionSchema.parse(input);
  const apiKey = await resolveStoredModelKey(credentialStore, selection);
  return {
    ...selection,
    ...(apiKey ? { apiKey } : {}),
  };
}

export async function hydrateAgentRunServices(
  credentialStore: CredentialStore,
  input: AgentRunServicesWire | unknown,
): Promise<HydratedAgentRunServices> {
  const wire = agentRunServicesWireSchema.parse(input);
  const { gateway, search } = splitAgentRunServicesConfig(wire);
  const fallbackModel = gateway.fallbackModel
    ? await hydrateAgentModelSettings(credentialStore, gateway.fallbackModel)
    : undefined;
  const endpoint = search.webSearchEndpoint?.trim() || DEFAULT_WEB_SEARCH_ENDPOINT;
  let webSearchApiKey: string | undefined;
  try {
    webSearchApiKey = await credentialStore.resolveWebSearchCredential({ endpoint });
  } catch (error) {
    if (!(error instanceof CredentialStoreError && error.code === "STORAGE_UNAVAILABLE")) {
      throw error;
    }
  }

  return {
    gateway: {
      timeoutMs: gateway.timeoutMs,
      maxOutputTokens: gateway.maxOutputTokens,
      ...(fallbackModel ? { fallbackModel } : {}),
    },
    search: {
      ...(search.webSearchEndpoint ? { webSearchEndpoint: search.webSearchEndpoint } : {}),
      ...(search.webSearchTimeoutMs ? { webSearchTimeoutMs: search.webSearchTimeoutMs } : {}),
      ...(webSearchApiKey
        ? {
            webSearchApiKey,
            webSearchEndpoint: endpoint,
          }
        : {}),
    },
  };
}

export async function getCredentialStatusWithEnvironment(
  credentialStore: CredentialStore,
  input: CredentialStatusRequest | unknown,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<CredentialStatusSnapshot> {
  const request = credentialStatusRequestSchema.parse(input);
  const status = await credentialStore.getStatus(request);
  return {
    ...status,
    models: status.models.map((modelStatus, index) => {
      const binding = request.models[index];
      return {
        ...modelStatus,
        configured:
          modelStatus.configured ||
          Boolean(
            binding &&
              resolveEnvironmentModelApiKey(binding.provider, binding.baseURL, environment),
          ),
      };
    }),
    webSearchConfigured:
      status.webSearchConfigured ||
      Boolean(resolveEnvironmentWebSearchApiKey(request.webSearch?.endpoint, environment)),
  };
}
