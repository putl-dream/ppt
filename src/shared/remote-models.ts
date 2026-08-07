import { z } from "zod";
import { agentProviderSchema } from "./agent";
import {
  credentialApiKeySchema,
  modelCredentialBindingSchema,
  normalizeCredentialUrl,
  normalizeModelCredentialBinding,
} from "./credentials";

const remoteModelBaseUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(2_048)
  .transform((value, ctx) => {
    try {
      return normalizeCredentialUrl(value);
    } catch (error) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: error instanceof Error ? error.message : "Invalid Base URL.",
      });
      return z.NEVER;
    }
  });

export const listRemoteModelsRequestSchema = z
  .object({
    provider: agentProviderSchema,
    baseURL: remoteModelBaseUrlSchema,
    apiKey: credentialApiKeySchema.optional(),
    credentialBinding: modelCredentialBindingSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!value.apiKey && !value.credentialBinding) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide an API key or a configured model credential.",
        path: ["apiKey"],
      });
    }
  })
  .transform((value) => ({
    provider: value.provider,
    baseURL: value.baseURL,
    ...(value.apiKey ? { apiKey: value.apiKey } : {}),
    ...(value.credentialBinding
      ? { credentialBinding: normalizeModelCredentialBinding(value.credentialBinding) }
      : {}),
  }));

export const remoteModelInfoSchema = z
  .object({
    id: z.string().trim().min(1).max(512),
    displayName: z.string().trim().min(1).max(512).optional(),
  })
  .strict();

export const listRemoteModelsResultSchema = z
  .object({
    models: z.array(remoteModelInfoSchema).max(2_000),
  })
  .strict();

export type ListRemoteModelsRequest = z.input<typeof listRemoteModelsRequestSchema>;
export type ParsedListRemoteModelsRequest = z.output<typeof listRemoteModelsRequestSchema>;
export type RemoteModelInfo = z.infer<typeof remoteModelInfoSchema>;
export type ListRemoteModelsResult = z.infer<typeof listRemoteModelsResultSchema>;
