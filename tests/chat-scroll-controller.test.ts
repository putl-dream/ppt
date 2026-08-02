// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createChatScrollController } from "../src/renderer/src/components/chat-scroll-controller";

function mountFixture(options?: {
  scrollTop?: number;
  scrollHeight?: number;
  clientHeight?: number;
}) {
  const viewport = document.createElement("div");
  viewport.className = "chat-scroll-viewport";
  Object.defineProperty(viewport, "clientHeight", {
    configurable: true,
    value: options?.clientHeight ?? 400,
  });
  Object.defineProperty(viewport, "scrollHeight", {
    configurable: true,
    value: options?.scrollHeight ?? 1200,
  });
  viewport.scrollTop = options?.scrollTop ?? 0;

  const stream = document.createElement("div");
  stream.className = "chat-stream";
  viewport.appendChild(stream);

  const header = document.createElement("button");
  let headerTop = 200;
  header.getBoundingClientRect = () =>
    ({
      top: headerTop,
      bottom: headerTop + 20,
      left: 0,
      right: 100,
      width: 100,
      height: 20,
      x: 0,
      y: headerTop,
      toJSON: () => ({}),
    }) as DOMRect;
  stream.appendChild(header);
  document.body.appendChild(viewport);

  return {
    viewport,
    stream,
    header,
    setHeaderTop(next: number) {
      headerTop = next;
    },
  };
}

describe("chat-scroll-controller", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("sticks to bottom when following after a fold", () => {
    const frames: Array<() => void> = [];
    const controller = createChatScrollController({
      scheduleFrame: (cb) => {
        frames.push(cb);
        return frames.length;
      },
      cancelFrame: () => {},
    });
    const { viewport, stream, header, setHeaderTop } = mountFixture({
      scrollTop: 800,
      scrollHeight: 1200,
    });
    controller.setViewport(viewport);
    controller.setStream(stream);
    controller.setFollowing(true);

    const token = controller.beginFold(header);
    expect(token?.wasFollowing).toBe(true);
    expect(controller.isLayoutLocked()).toBe(true);

    setHeaderTop(80);
    Object.defineProperty(viewport, "scrollHeight", { configurable: true, value: 500 });
    controller.commitFold(token);

    expect(viewport.scrollTop).toBe(500);
    expect(controller.isFollowing()).toBe(true);

    // Stick while locked is ignored.
    const scrollBefore = viewport.scrollTop;
    Object.defineProperty(viewport, "scrollHeight", { configurable: true, value: 600 });
    controller.stickToBottomIfFollowing();
    expect(controller.isLayoutLocked()).toBe(true);
    expect(viewport.scrollTop).toBe(scrollBefore);
  });

  it("anchors the header when not following", () => {
    const controller = createChatScrollController({
      scheduleFrame: (cb) => {
        cb();
        return 1;
      },
      cancelFrame: () => {},
    });
    const { viewport, stream, header, setHeaderTop } = mountFixture({
      scrollTop: 300,
      scrollHeight: 1200,
    });
    controller.setViewport(viewport);
    controller.setStream(stream);
    controller.setFollowing(false);

    const token = controller.beginFold(header);
    expect(token?.wasFollowing).toBe(false);
    setHeaderTop(120);
    controller.commitFold(token);

    expect(viewport.scrollTop).toBe(220);
    expect(controller.isFollowing()).toBe(false);
  });

  it("updates following from user scroll after layout unlock", () => {
    const frames: Array<() => void> = [];
    const controller = createChatScrollController({
      scheduleFrame: (cb) => {
        frames.push(cb);
        return frames.length;
      },
      cancelFrame: () => {},
    });
    const { viewport, stream } = mountFixture({
      scrollTop: 800,
      scrollHeight: 1200,
    });
    controller.setViewport(viewport);
    controller.setStream(stream);
    const detach = controller.attach();

    viewport.scrollTop = 100;
    viewport.dispatchEvent(new Event("scroll"));
    expect(controller.isFollowing()).toBe(false);

    viewport.scrollTop = 800;
    viewport.dispatchEvent(new Event("scroll"));
    expect(controller.isFollowing()).toBe(true);

    detach();
  });

  it("coalesces stick-to-bottom onto one scheduled frame", () => {
    const frames: Array<() => void> = [];
    const controller = createChatScrollController({
      scheduleFrame: (cb) => {
        frames.push(cb);
        return frames.length;
      },
      cancelFrame: vi.fn(),
    });
    const { viewport, stream } = mountFixture({
      scrollTop: 0,
      scrollHeight: 800,
    });
    controller.setViewport(viewport);
    controller.setStream(stream);
    controller.setFollowing(true);

    controller.stickToBottomIfFollowing();
    controller.stickToBottomIfFollowing();
    expect(frames).toHaveLength(1);

    Object.defineProperty(viewport, "scrollHeight", { configurable: true, value: 900 });
    frames[0]!();
    expect(viewport.scrollTop).toBe(900);
  });
});
