import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { localizeImageAsset } from "../src/main/agent/assets/image-asset";
import { insertSlideImageTool } from "../src/main/agent/tools/deferred/insert-slide-image";
import { createDefaultToolRegistry } from "../src/main/agent/tools/tool-registry";
import type { Presentation } from "../src/shared/presentation";

const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2n1cAAAAASUVORK5CYII=",
  "base64",
);

const tempRoots: string[] = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(tempRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function makeTempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "agent-ppt-image-asset-"));
  tempRoots.push(root);
  return root;
}

describe("image asset localization", () => {
  it("downloads a public raster image into a content-addressed workspace path", async () => {
    const workspaceRoot = await makeTempRoot();
    const localized = await localizeImageAsset({
      url: "https://cdn.example.com/hero.png",
      workspaceRoot,
      provider: "tavily",
      sourcePageUrl: "https://example.com/article",
      description: "Wide hero image",
      license: "license-pending-verification",
    }, {
      fetchImpl: vi.fn(async () => new Response(TINY_PNG, {
        status: 200,
        headers: {
          "content-type": "image/png",
          "content-length": String(TINY_PNG.length),
        },
      })) as unknown as typeof fetch,
      resolveHost: async () => ["93.184.216.34"],
    });

    expect(localized.fileUrl).toMatch(/^file:\/\/\//);
    expect(localized.metadata).toMatchObject({
      provider: "tavily",
      sourceUrl: "https://cdn.example.com/hero.png",
      sourcePageUrl: "https://example.com/article",
      localPath: expect.stringMatching(/^assets\/images\/[a-f0-9]{24}\.png$/),
      mimeType: "image/png",
      byteSize: TINY_PNG.length,
    });
    expect(await readFile(localized.filePath)).toEqual(TINY_PNG);
  });

  it("rejects private network image URLs before download", async () => {
    const workspaceRoot = await makeTempRoot();
    const fetchImpl = vi.fn();
    await expect(localizeImageAsset({
      url: "http://127.0.0.1/private.png",
      workspaceRoot,
    }, { fetchImpl: fetchImpl as unknown as typeof fetch })).rejects.toThrow("private");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects redirects to private network targets before following them", async () => {
    const workspaceRoot = await makeTempRoot();
    const fetchImpl = vi.fn(async () => new Response(null, {
      status: 302,
      headers: { location: "http://127.0.0.1/private.png" },
    }));
    await expect(localizeImageAsset({
      url: "https://cdn.example.com/redirect.png",
      workspaceRoot,
    }, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      resolveHost: async () => ["93.184.216.34"],
    })).rejects.toThrow("private");
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("localizes remote InsertSlideImage assets when a workspace is available", async () => {
    const workspaceRoot = await makeTempRoot();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(TINY_PNG, {
      status: 200,
      headers: { "content-type": "image/png" },
    })));
    const slideId = crypto.randomUUID();
    const presentation: Presentation = {
      id: crypto.randomUUID(),
      title: "Deck",
      revision: 1,
      slides: [{
        id: slideId,
        title: "Evidence",
        layout: "case",
        elements: [{
          id: crypto.randomUUID(),
          type: "text",
          x: 120,
          y: 220,
          width: 500,
          height: 180,
          text: "Evidence",
          fontSize: 24,
        }],
      }],
    };

    const result = await insertSlideImageTool.execute({
      slideId,
      url: "https://93.184.216.34/evidence.png",
      slot: "side",
      provider: "tavily",
      source_page_url: "https://example.com/source",
      description: "Evidence image",
      license: "license-pending-verification",
    }, {
      presentation,
      selectedElementIds: [],
      discoverySession: { discoveredToolNames: new Set() },
      registry: createDefaultToolRegistry(),
      messageHistory: [],
      workspaceRoot,
    });

    expect(result.commands).toHaveLength(1);
    const command = result.commands[0];
    expect(command?.type).toBe("add-element");
    if (command?.type === "add-element" && command.element.type === "image") {
      expect(command.element.url).toMatch(/^file:\/\/\//);
      expect(command.element.provenance).toBe("asset");
      expect(command.element.asset?.sourcePageUrl).toBe("https://example.com/source");
      expect(command.element.asset?.localPath).toMatch(/^assets\/images\//);
    }
  });
});
