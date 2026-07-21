import type { DesignSystemV1 } from "@design-system";
import {
  applyCommercialAssetFallbacks,
  compileCommercialDeck,
  directCommercialDeck,
  evaluateCommercialQuality,
  resolvedAssetManifestV1Schema,
  type AssetRequestV1,
  type CommercialQualityReport,
  type DirectedDeckPlanV1,
  type ResolvedAssetManifestV1,
  canonicalJson,
} from "@shared/commercial-visual";
import type { LeanDeckSpecV2 } from "@shared/lean/deck-spec-v2";
import type { Presentation } from "@shared/presentation";
import { executeCommand } from "@shared/commands";

export const COMMERCIAL_COMPILER_VERSION = "2.1.0";

export interface CommercialAssetResolver {
  resolve(
    requests: readonly AssetRequestV1[],
    options: CommercialAssetResolveOptions,
  ): Promise<ResolvedAssetManifestV1>;
}

export interface CommercialAssetResolveOptions {
  workspaceRoot?: string;
  signal?: AbortSignal;
}

export interface LeanV2PipelineResult {
  plan: DirectedDeckPlanV1;
  manifest: ResolvedAssetManifestV1;
  presentation: Presentation;
  commands: ReturnType<typeof compileCommercialDeck>["commands"];
  quality: CommercialQualityReport;
  canonicalHash: string;
  timings: {
    directorDurationMs: number;
    assetResolutionDurationMs: number;
    compileDurationMs: number;
    qualityDurationMs: number;
  };
}

export class LeanV2Pipeline {
  constructor(
    private readonly assetResolver: CommercialAssetResolver,
  ) {}

  /**
   * 执行 Lean v2 的确定性编译链：视觉导演、素材解析、命令编译、可重放校验和质量门。
   * 只有质量门通过时才返回 Presentation 预览及等价的命令序列。
   */
  async create(input: {
    spec: LeanDeckSpecV2;
    basePresentation: Presentation;
    designSystem?: DesignSystemV1;
    workspaceRoot?: string;
    signal?: AbortSignal;
  }): Promise<LeanV2PipelineResult> {
    const directorStartedAt = Date.now();
    const initialPlan = directCommercialDeck({
      spec: input.spec,
      compilerVersion: COMMERCIAL_COMPILER_VERSION,
    });
    const directorDurationMs = Date.now() - directorStartedAt;

    const assetResolutionStartedAt = Date.now();
    const manifest = resolvedAssetManifestV1Schema.parse(
      await this.assetResolver.resolve(
        initialPlan.slides.flatMap((slide) => slide.assetRequests),
        { workspaceRoot: input.workspaceRoot, signal: input.signal },
      ),
    );
    const assetResolutionDurationMs = Date.now() - assetResolutionStartedAt;
    const plan = applyCommercialAssetFallbacks({
      spec: input.spec,
      plan: initialPlan,
      manifest,
    });

    const compileStartedAt = Date.now();
    const compiled = compileCommercialDeck({
      spec: input.spec,
      plan,
      assets: manifest,
      basePresentation: input.basePresentation,
      compilerVersion: COMMERCIAL_COMPILER_VERSION,
      designSystem: input.designSystem,
    });
    const repeated = compileCommercialDeck({
      spec: input.spec,
      plan,
      assets: manifest,
      basePresentation: input.basePresentation,
      compilerVersion: COMMERCIAL_COMPILER_VERSION,
      designSystem: input.designSystem,
    });
    const determinismVerified =
      compiled.canonicalHash === repeated.canonicalHash
      && canonicalJson(compiled.presentation) === canonicalJson(repeated.presentation)
      && canonicalJson(compiled.commands) === canonicalJson(repeated.commands);
    let replayed = structuredClone(input.basePresentation);
    for (const command of compiled.commands) {
      replayed = executeCommand(replayed, command).presentation;
    }
    const commandReplayVerified = canonicalJson({
      title: replayed.title,
      designSystem: replayed.designSystem,
      slides: replayed.slides,
    }) === canonicalJson({
      title: compiled.presentation.title,
      designSystem: compiled.presentation.designSystem,
      slides: compiled.presentation.slides,
    });
    const compileDurationMs = Date.now() - compileStartedAt;

    const qualityStartedAt = Date.now();
    const quality = evaluateCommercialQuality({
      spec: input.spec,
      plan,
      assets: manifest,
      presentation: compiled.presentation,
      canonicalHash: compiled.canonicalHash,
      determinismVerified,
      commandReplayVerified,
    });
    const qualityDurationMs = Date.now() - qualityStartedAt;
    if (!quality.passed) {
      const summary = quality.hardFailures
        .slice(0, 5)
        .map((failure) => `${failure.code}: ${failure.message}`)
        .join("; ");
      throw new Error(`Commercial Quality Gate rejected the deck: ${summary}`);
    }

    return {
      plan,
      manifest,
      presentation: compiled.presentation,
      commands: compiled.commands,
      quality,
      canonicalHash: compiled.canonicalHash,
      timings: {
        directorDurationMs,
        assetResolutionDurationMs,
        compileDurationMs,
        qualityDurationMs,
      },
    };
  }
}
