import { readFile } from "node:fs/promises";

import type { AgentGatewayConfig } from "@shared/agent-gateway-config";
import type {
  AssetRequestV1,
  ResolvedAssetManifestV1,
  ResolvedAssetV1,
} from "@shared/commercial-visual";
import { localizeImageAsset } from "./image-asset";
import type {
  CommercialAssetResolveOptions,
  CommercialAssetResolver,
} from "../lean/lean-v2-pipeline";
import { imageSearchService } from "../search/image-search-service";

function probeJpeg(buffer: Buffer): { width: number; height: number } | undefined {
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1]!;
    const length = buffer.readUInt16BE(offset + 2);
    if (length < 2) return undefined;
    if (
      (marker >= 0xc0 && marker <= 0xc3)
      || (marker >= 0xc5 && marker <= 0xc7)
      || (marker >= 0xc9 && marker <= 0xcb)
      || (marker >= 0xcd && marker <= 0xcf)
    ) {
      return {
        height: buffer.readUInt16BE(offset + 5),
        width: buffer.readUInt16BE(offset + 7),
      };
    }
    offset += 2 + length;
  }
  return undefined;
}

async function probeImage(filePath: string): Promise<{ width: number; height: number } | undefined> {
  const buffer = await readFile(filePath);
  if (buffer.length >= 24 && buffer.subarray(1, 4).toString("ascii") === "PNG") {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (buffer.length >= 10 && buffer.subarray(0, 3).toString("ascii") === "GIF") {
    return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
  }
  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    return probeJpeg(buffer);
  }
  return undefined;
}

export interface NormalizedPoint { x: number; y: number }

export function inferFocalPointFromBrief(brief: string): NormalizedPoint {
  const normalized = brief.toLowerCase();
  const x = /(?:subject|person|product|focus).{0,20}(?:on the |to the )?left|主体.{0,8}(?:左|靠左)/u.test(normalized)
    ? 0.3
    : /(?:subject|person|product|focus).{0,20}(?:on the |to the )?right|主体.{0,8}(?:右|靠右)/u.test(normalized)
      ? 0.7
      : 0.5;
  const y = /(?:subject|person|product|focus).{0,20}(?:at the |on the )?top|主体.{0,8}(?:上|靠上)/u.test(normalized)
    ? 0.3
    : /(?:subject|person|product|focus).{0,20}(?:at the |on the )?bottom|主体.{0,8}(?:下|靠下)/u.test(normalized)
      ? 0.7
      : 0.5;
  return { x, y };
}

export function cropAroundFocalPoint(
  width: number,
  height: number,
  targetAspectRatio: number,
  focalPoint: NormalizedPoint,
): { x: number; y: number; width: number; height: number } {
  const sourceAspectRatio = width / height;
  if (sourceAspectRatio > targetAspectRatio) {
    const cropWidth = targetAspectRatio / sourceAspectRatio;
    return {
      x: Math.max(0, Math.min(1 - cropWidth, focalPoint.x - cropWidth / 2)),
      y: 0,
      width: cropWidth,
      height: 1,
    };
  }
  const cropHeight = sourceAspectRatio / targetAspectRatio;
  return {
    x: 0,
    y: Math.max(0, Math.min(1 - cropHeight, focalPoint.y - cropHeight / 2)),
    width: 1,
    height: cropHeight,
  };
}

function tokenize(value: string): Set<string> {
  return new Set(
    value.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((token) => token.length > 1),
  );
}

function relevance(brief: string, description: string): number {
  const expected = tokenize(brief);
  const actual = tokenize(description);
  let matches = 0;
  expected.forEach((token) => {
    if (actual.has(token)) matches += 1;
  });
  return expected.size === 0 ? 0 : matches / expected.size;
}

function descriptionSpecificity(description: string): number {
  if (/^image candidate \d+$/i.test(description.trim())) return 0;
  return Math.min(1, tokenize(description).size / 12);
}

function aspectFit(width: number, height: number, targetAspectRatio: number): number {
  const sourceAspectRatio = width / height;
  return Math.min(sourceAspectRatio, targetAspectRatio)
    / Math.max(sourceAspectRatio, targetAspectRatio);
}

export class SearchCommercialAssetResolver implements CommercialAssetResolver {
  constructor(
    private readonly getGatewayConfig: () => AgentGatewayConfig | undefined,
  ) {}

  async resolve(
    requests: readonly AssetRequestV1[],
    options: CommercialAssetResolveOptions,
  ): Promise<ResolvedAssetManifestV1> {
    const assets: ResolvedAssetV1[] = [];
    const usedHashes = new Set<string>();
    for (const request of requests) {
      if (!options.workspaceRoot) {
        assets.push({
          requestId: request.requestId,
          slotId: request.slotId,
          status: "unavailable",
          licenseStatus: "unknown",
          rejectionCodes: ["workspace-root-missing"],
        });
        continue;
      }
      try {
        const search = await imageSearchService.search({
          brief: request.brief,
          maxImages: 8,
          sourceMode: "free",
          visualKind: "photo",
        }, {
          gatewayConfig: this.getGatewayConfig(),
          signal: options.signal,
        });
        const candidates = search.candidates
          .map((candidate, index) => ({
            ...candidate,
            index,
            score:
              relevance(request.brief, candidate.description ?? "")
              + (candidate.sourcePageUrl ? 0.25 : 0),
          }))
          .sort((left, right) =>
            right.score - left.score
            || left.url.localeCompare(right.url)
            || left.index - right.index
          );

        let resolved: ResolvedAssetV1 | undefined;
        let resolvedScore = Number.NEGATIVE_INFINITY;
        const rejectionCodes: string[] = [];
        for (const candidate of candidates.slice(0, 4)) {
          try {
            const provider = candidate.provider;
            const localized = await localizeImageAsset({
              url: candidate.url,
              workspaceRoot: options.workspaceRoot,
              provider,
              sourcePageUrl: candidate.sourcePageUrl,
              description: candidate.description,
            });
            const sha256 = localized.metadata.sha256;
            const localPath = localized.metadata.localPath;
            const mimeType = localized.metadata.mimeType;
            if (!sha256 || !localPath || !mimeType) {
              rejectionCodes.push("localized-metadata-incomplete");
              continue;
            }
            if (usedHashes.has(sha256)) {
              rejectionCodes.push("duplicate-content");
              continue;
            }
            const dimensions = await probeImage(localized.filePath);
            if (!dimensions || dimensions.width < 640 || dimensions.height < 360) {
              rejectionCodes.push("resolution-too-low");
              continue;
            }
            const focalPoint = inferFocalPointFromBrief(request.brief);
            const candidateScore = candidate.score
              + descriptionSpecificity(candidate.description ?? "") * 0.15
              + aspectFit(dimensions.width, dimensions.height, request.targetAspectRatio) * 0.25
              + Math.min(1, Math.sqrt(dimensions.width * dimensions.height) / 1600) * 0.15;
            if (candidateScore <= resolvedScore) continue;
            resolvedScore = candidateScore;
            resolved = {
              requestId: request.requestId,
              slotId: request.slotId,
              status: "resolved",
              sha256,
              localPath,
              renderUrl: localized.fileUrl,
              mimeType,
              pixelWidth: dimensions.width,
              pixelHeight: dimensions.height,
              focalPoint,
              safeCrop: cropAroundFocalPoint(
                dimensions.width,
                dimensions.height,
                request.targetAspectRatio,
                focalPoint,
              ),
              sourceUrl: localized.metadata.sourceUrl,
              sourcePageUrl: localized.metadata.sourcePageUrl,
              provider: localized.metadata.provider,
              licenseStatus: "unknown",
              license: localized.metadata.license,
              attribution: localized.metadata.attribution,
              rejectionCodes,
            };
          } catch {
            rejectionCodes.push("candidate-localization-failed");
          }
        }
        if (resolved?.sha256) usedHashes.add(resolved.sha256);
        assets.push(resolved ?? {
          requestId: request.requestId,
          slotId: request.slotId,
          status: "unavailable",
          licenseStatus: "unknown",
          rejectionCodes: rejectionCodes.length > 0 ? rejectionCodes : ["no-image-candidates"],
        });
      } catch {
        assets.push({
          requestId: request.requestId,
          slotId: request.slotId,
          status: "unavailable",
          licenseStatus: "unknown",
          rejectionCodes: ["image-search-failed"],
        });
      }
    }
    return { version: 1, assets };
  }
}
