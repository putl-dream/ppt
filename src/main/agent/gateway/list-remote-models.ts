import Anthropic from "@anthropic-ai/sdk";
import {
  type ListRemoteModelsResult,
  listRemoteModelsRequestSchema,
  type ParsedListRemoteModelsRequest,
  type RemoteModelInfo,
} from "@shared/remote-models";
import OpenAI from "openai";
import type { CredentialStore } from "../../credential-store";
import { CredentialStoreError } from "../../credential-store";

const LIST_TIMEOUT_MS = 20_000;
const MAX_MODELS = 2_000;

export class ListRemoteModelsError extends Error {
  readonly code: "invalid-request" | "provider-error" | "missing-credential";

  constructor(message: string, code: ListRemoteModelsError["code"] = "provider-error") {
    super(message);
    this.name = "ListRemoteModelsError";
    this.code = code;
  }
}

function uniqueSortedModels(models: RemoteModelInfo[]): RemoteModelInfo[] {
  const byId = new Map<string, RemoteModelInfo>();
  for (const model of models) {
    const id = model.id.trim();
    if (!id) continue;
    const existing = byId.get(id);
    if (!existing) {
      byId.set(id, {
        id,
        ...(model.displayName?.trim() ? { displayName: model.displayName.trim() } : {}),
      });
      continue;
    }
    if (!existing.displayName && model.displayName?.trim()) {
      byId.set(id, { id, displayName: model.displayName.trim() });
    }
  }
  return [...byId.values()]
    .sort((left, right) => left.id.localeCompare(right.id))
    .slice(0, MAX_MODELS);
}

async function listOpenAICompatibleModels(
  apiKey: string,
  baseURL: string,
): Promise<RemoteModelInfo[]> {
  const client = new OpenAI({
    apiKey,
    baseURL,
    timeout: LIST_TIMEOUT_MS,
    maxRetries: 0,
  });

  const models: RemoteModelInfo[] = [];
  try {
    for await (const model of client.models.list()) {
      if (typeof model.id !== "string" || !model.id.trim()) continue;
      models.push({ id: model.id.trim() });
      if (models.length >= MAX_MODELS) break;
    }
  } catch (error) {
    throw new ListRemoteModelsError(
      error instanceof Error ? error.message : "Failed to list OpenAI-compatible models.",
      "provider-error",
    );
  }
  return uniqueSortedModels(models);
}

async function listAnthropicCompatibleModels(
  apiKey: string,
  baseURL: string,
): Promise<RemoteModelInfo[]> {
  const client = new Anthropic({
    apiKey,
    baseURL,
    timeout: LIST_TIMEOUT_MS,
    maxRetries: 0,
  });

  const models: RemoteModelInfo[] = [];
  try {
    for await (const model of client.models.list({ limit: 1000 })) {
      if (typeof model.id !== "string" || !model.id.trim()) continue;
      const displayName =
        typeof model.display_name === "string" && model.display_name.trim()
          ? model.display_name.trim()
          : undefined;
      models.push({
        id: model.id.trim(),
        ...(displayName ? { displayName } : {}),
      });
      if (models.length >= MAX_MODELS) break;
    }
  } catch (error) {
    throw new ListRemoteModelsError(
      error instanceof Error ? error.message : "Failed to list Anthropic-compatible models.",
      "provider-error",
    );
  }
  return uniqueSortedModels(models);
}

async function resolveListApiKey(
  credentialStore: CredentialStore,
  request: ParsedListRemoteModelsRequest,
): Promise<string> {
  if (request.apiKey) return request.apiKey;
  if (!request.credentialBinding) {
    throw new ListRemoteModelsError(
      "Provide an API key or a configured model credential.",
      "invalid-request",
    );
  }

  try {
    const apiKey = await credentialStore.resolveModelCredential(request.credentialBinding);
    if (!apiKey) {
      throw new ListRemoteModelsError(
        "No stored credential matches this model configuration.",
        "missing-credential",
      );
    }
    return apiKey;
  } catch (error) {
    if (error instanceof ListRemoteModelsError) throw error;
    if (error instanceof CredentialStoreError && error.code === "STORAGE_UNAVAILABLE") {
      throw new ListRemoteModelsError("Credential storage is unavailable.", "missing-credential");
    }
    throw error;
  }
}

export async function listRemoteModels(
  credentialStore: CredentialStore,
  rawRequest: unknown,
): Promise<ListRemoteModelsResult> {
  let request: ParsedListRemoteModelsRequest;
  try {
    request = listRemoteModelsRequestSchema.parse(rawRequest);
  } catch (error) {
    throw new ListRemoteModelsError(
      error instanceof Error ? error.message : "The list-models request is invalid.",
      "invalid-request",
    );
  }

  const apiKey = await resolveListApiKey(credentialStore, request);
  const models =
    request.provider === "openai"
      ? await listOpenAICompatibleModels(apiKey, request.baseURL)
      : await listAnthropicCompatibleModels(apiKey, request.baseURL);

  return { models };
}
