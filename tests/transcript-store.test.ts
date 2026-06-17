import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { TranscriptStore } from "@main/transcript-store";
import {
  buildConversationChain,
  deserializeMessages,
  NO_RESPONSE_REQUESTED,
} from "@shared/transcript";

const temporaryDirectories: string[] = [];

async function createStore() {
  const projectDir = await mkdtemp(join(tmpdir(), "agent-ppt-transcript-"));
  temporaryDirectories.push(projectDir);
  return { store: new TranscriptStore(), projectDir };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("TranscriptStore", () => {
  it("appends message chains as JSONL and skips already written UUIDs", async () => {
    const { store, projectDir } = await createStore();
    const sessionId = "session-1";

    await store.insertMessageChain({
      sessionId,
      projectDir,
      messages: [
        { uuid: "u1", role: "user", content: "创建一份产品发布 PPT" },
        { uuid: "a1", role: "assistant", content: "请补充受众。" },
      ],
    });
    await store.insertMessageChain({
      sessionId,
      projectDir,
      messages: [
        { uuid: "u1", role: "user", content: "创建一份产品发布 PPT" },
        { uuid: "a1", role: "assistant", content: "请补充受众。" },
      ],
    });

    const filePath = store.getTranscriptPath(sessionId, projectDir);
    const lines = (await readFile(filePath, "utf8")).trim().split(/\r?\n/);
    const loaded = await store.loadTranscriptFile(sessionId, projectDir);

    expect(lines).toHaveLength(2);
    expect(loaded.map((message) => [message.uuid, message.parentUuid])).toEqual([
      ["u1", undefined],
      ["a1", "u1"],
    ]);
  });

  it("rebuilds the active conversation from a selected leaf across forks", async () => {
    const { store, projectDir } = await createStore();
    const sessionId = "session-1";

    await store.insertMessageChain({
      sessionId,
      projectDir,
      messages: [
        { uuid: "u1", role: "user", content: "创建 PPT" },
        { uuid: "a1", role: "assistant", content: "初版大纲" },
      ],
    });
    await store.insertMessageChain({
      sessionId,
      projectDir,
      parentUuid: "a1",
      messages: [
        { uuid: "u2", role: "user", content: "走企业风" },
        { uuid: "a2", role: "assistant", content: "企业风方案" },
      ],
    });
    await store.insertMessageChain({
      sessionId,
      projectDir,
      parentUuid: "a1",
      messages: [
        { uuid: "u3", role: "user", content: "改成发布会风格" },
        { uuid: "a3", role: "assistant", content: "发布会风格方案" },
      ],
    });

    const loaded = await store.loadTranscriptFile(sessionId, projectDir);
    const chain = buildConversationChain(loaded, "a3");

    expect(chain.map((message) => message.uuid)).toEqual(["u1", "a1", "u3", "a3"]);
    expect(deserializeMessages(chain)).toEqual([
      { role: "user", content: "创建 PPT" },
      { role: "assistant", content: "初版大纲" },
      { role: "user", content: "改成发布会风格" },
      { role: "assistant", content: "发布会风格方案" },
    ]);
  });

  it("keeps sidechain tool results out of model context", async () => {
    const { store, projectDir } = await createStore();
    const sessionId = "session-1";

    await store.insertMessageChain({
      sessionId,
      projectDir,
      messages: [
        { uuid: "u1", role: "user", content: "读取当前页" },
        { uuid: "a1", role: "assistant", kind: "tool_use", content: "ReadCurrentSlide" },
        {
          uuid: "t1",
          parentUuid: "a1",
          role: "tool",
          kind: "tool_result",
          content: "当前页内容",
          isSidechain: true,
        },
        { uuid: "a2", parentUuid: "a1", role: "assistant", content: "当前页是标题页。" },
      ],
    });

    const loaded = await store.loadTranscriptFile(sessionId, projectDir);
    const chain = buildConversationChain(loaded, "a2");

    expect(chain.map((message) => message.uuid)).toEqual(["u1", "a1", "a2"]);
    expect(deserializeMessages(chain)).toEqual([
      { role: "user", content: "读取当前页" },
      { role: "assistant", content: "当前页是标题页。" },
    ]);
  });

  it("adds a sentinel when the restored chain ends at a user message", async () => {
    const { store, projectDir } = await createStore();
    const sessionId = "session-1";

    await store.insertMessageChain({
      sessionId,
      projectDir,
      messages: [
        { uuid: "u1", role: "user", content: "继续刚才的方案" },
      ],
    });

    const loaded = await store.loadTranscriptFile(sessionId, projectDir);
    const chain = buildConversationChain(loaded, "u1");

    expect(deserializeMessages(chain)).toEqual([
      { role: "user", content: "继续刚才的方案" },
      { role: "assistant", content: NO_RESPONSE_REQUESTED },
    ]);
  });
});
