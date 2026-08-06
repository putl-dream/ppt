import { z } from "zod";
import { type AgentModelSelection, agentProviderSchema } from "./agent";

export const CREDENTIAL_STORE_FILE_NAME = "credentials.v1.json";

const credentialIdentifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(256)
  .refine(
    (value) => !/[\u0000-\u001f\u007f]/.test(value),
    "Credential identifiers must not contain control characters.",
  );
const credentialModelNameSchema = z.string().trim().min(1).max(512);
const credentialUrlSchema = z.string().trim().min(1).max(2_048).url();

export const credentialApiKeySchema = z.string().trim().min(1).max(16_384);

export const modelCredentialBindingSchema = z
  .object({
    configurationId: credentialIdentifierSchema,
    provider: agentProviderSchema,
    model: credentialModelNameSchema,
    baseURL: credentialUrlSchema.optional(),
    apiMode: z.enum(["responses", "chat-completions"]).optional(),
  })
  .strict();

export const webSearchCredentialBindingSchema = z
  .object({
    endpoint: credentialUrlSchema,
  })
  .strict();

export const setModelCredentialsRequestSchema = z
  .object({
    bindings: z.array(modelCredentialBindingSchema).min(1).max(100),
    apiKey: credentialApiKeySchema,
  })
  .strict();

export const setWebSearchCredentialRequestSchema = z
  .object({
    binding: webSearchCredentialBindingSchema,
    apiKey: credentialApiKeySchema,
  })
  .strict();

export const deleteModelCredentialRequestSchema = z
  .object({
    configurationId: credentialIdentifierSchema,
  })
  .strict();

export const credentialStatusRequestSchema = z
  .object({
    models: z.array(modelCredentialBindingSchema).max(500).default([]),
    webSearch: webSearchCredentialBindingSchema.optional(),
  })
  .strict();

export type ModelCredentialBinding = z.infer<typeof modelCredentialBindingSchema>;
export type WebSearchCredentialBinding = z.infer<typeof webSearchCredentialBindingSchema>;
export type SetModelCredentialsRequest = z.infer<typeof setModelCredentialsRequestSchema>;
export type SetWebSearchCredentialRequest = z.infer<typeof setWebSearchCredentialRequestSchema>;
export type DeleteModelCredentialRequest = z.infer<typeof deleteModelCredentialRequestSchema>;
export type CredentialStatusRequest = z.input<typeof credentialStatusRequestSchema>;

export type CredentialStorageBackend =
  | "basic_text"
  | "gnome_libsecret"
  | "kwallet"
  | "kwallet5"
  | "kwallet6"
  | "unknown";

export interface CredentialStorageStatus {
  state: "secure" | "degraded" | "unavailable";
  backend: CredentialStorageBackend;
  warning?: "linux-basic-text" | "safe-storage-unavailable";
}

export interface CredentialStatusSnapshot {
  storage: CredentialStorageStatus;
  models: Array<{
    configurationId: string;
    configured: boolean;
  }>;
  webSearchConfigured: boolean;
}

export function normalizeCredentialUrl(value: string): string {
  const validated = credentialUrlSchema.parse(value);
  const parsed = new URL(validated);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("Credential-bound URLs must use http or https.");
  }
  if (parsed.protocol === "http:" && !isLoopbackHostname(parsed.hostname)) {
    throw new Error("Credential-bound remote URLs must use HTTPS.");
  }
  if (parsed.username || parsed.password) {
    throw new Error("Credential-bound URLs must not contain embedded credentials.");
  }

  parsed.pathname = parsed.pathname.replace(/\/+$/, "") || "/";
  const normalized = parsed.toString();
  return parsed.pathname === "/" && !parsed.search && !parsed.hash ? parsed.origin : normalized;
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (normalized === "localhost" || normalized === "::1") return true;
  const octets = normalized.split(".");
  return (
    octets.length === 4 &&
    octets[0] === "127" &&
    octets.every((octet) => /^\d{1,3}$/.test(octet) && Number(octet) <= 255)
  );
}

export function normalizeModelCredentialBinding(
  input: ModelCredentialBinding,
): ModelCredentialBinding {
  const binding = modelCredentialBindingSchema.parse(input);
  return {
    configurationId: binding.configurationId,
    provider: binding.provider,
    model: binding.model,
    ...(binding.baseURL ? { baseURL: normalizeCredentialUrl(binding.baseURL) } : {}),
    ...(binding.apiMode ? { apiMode: binding.apiMode } : {}),
  };
}

export function normalizeWebSearchCredentialBinding(
  input: WebSearchCredentialBinding,
): WebSearchCredentialBinding {
  const binding = webSearchCredentialBindingSchema.parse(input);
  return { endpoint: normalizeCredentialUrl(binding.endpoint) };
}

export function modelCredentialBindingFromSelection(
  selection: AgentModelSelection,
): ModelCredentialBinding {
  return normalizeModelCredentialBinding({
    configurationId: selection.configurationId ?? "",
    provider: selection.provider,
    model: selection.model,
    ...(selection.baseURL ? { baseURL: selection.baseURL } : {}),
    ...(selection.openaiApiMode ? { apiMode: selection.openaiApiMode } : {}),
  });
}
