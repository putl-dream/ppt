import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  mkdir,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  blobReferenceSchema,
  contentHashSchema,
  type BlobReference,
  type ContentHash,
} from "@shared/presentation-lifecycle";

export function hashBytes(value: Uint8Array): ContentHash {
  return contentHashSchema.parse(
    `sha256:${createHash("sha256").update(value).digest("hex")}`,
  );
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) {
      throw new Error("Lifecycle artifact values must be JSON serializable.");
    }
    return encoded;
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

export function hashArtifactValue(value: unknown): ContentHash {
  return hashBytes(Buffer.from(canonicalJson(value), "utf8"));
}

export class ContentAddressedBlobStore {
  constructor(readonly rootPath: string) {}

  async put(
    value: Uint8Array,
    mediaType: string,
  ): Promise<BlobReference> {
    const contentHash = hashBytes(value);
    const target = this.pathFor(contentHash);
    await mkdir(dirname(target), { recursive: true });
    const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, value, { flag: "wx" });
    try {
      await rename(temporary, target);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST" && code !== "EPERM") throw error;
      await unlink(temporary).catch(() => undefined);
      const existing = await readFile(target);
      if (hashBytes(existing) !== contentHash) {
        throw new Error(`Blob collision at ${target}.`);
      }
    }
    return blobReferenceSchema.parse({
      contentHash,
      mediaType,
      byteLength: value.byteLength,
    });
  }

  async get(reference: BlobReference): Promise<Buffer> {
    const parsed = blobReferenceSchema.parse(reference);
    const value = await readFile(this.pathFor(parsed.contentHash));
    if (
      value.byteLength !== parsed.byteLength
      || hashBytes(value) !== parsed.contentHash
    ) {
      throw new Error(`Blob ${parsed.contentHash} failed integrity validation.`);
    }
    return value;
  }

  getSync(reference: BlobReference): Buffer {
    const parsed = blobReferenceSchema.parse(reference);
    const value = readFileSync(this.pathFor(parsed.contentHash));
    if (
      value.byteLength !== parsed.byteLength
      || hashBytes(value) !== parsed.contentHash
    ) {
      throw new Error(`Blob ${parsed.contentHash} failed integrity validation.`);
    }
    return value;
  }

  async has(reference: BlobReference): Promise<boolean> {
    const parsed = blobReferenceSchema.parse(reference);
    const metadata = await stat(this.pathFor(parsed.contentHash)).catch(() => undefined);
    return metadata?.isFile() === true && metadata.size === parsed.byteLength;
  }

  pathFor(contentHash: ContentHash): string {
    const digest = contentHashSchema.parse(contentHash).slice("sha256:".length);
    return join(this.rootPath, "sha256", digest.slice(0, 2), digest.slice(2));
  }
}
