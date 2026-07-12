import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { UserMessageEditor } from "../src/renderer/src/components/ChatWorkspace";

describe("UserMessageEditor", () => {
  it("renders a stable inline editor with branch rerun guidance", () => {
    const html = renderToStaticMarkup(
      <UserMessageEditor
        value="把第二页改成时间线"
        busy={false}
        onChange={vi.fn()}
        onCancel={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    expect(html).toContain('aria-label="编辑已发送的消息"');
    expect(html).toContain('aria-label="修改消息内容"');
    expect(html).toContain("提交后将从这里重新运行");
    expect(html).toContain("把第二页改成时间线");
    expect(html).toContain("提交修改");
  });

  it("disables submission for empty content and while the agent is running", () => {
    const render = (value: string, busy: boolean) => renderToStaticMarkup(
      <UserMessageEditor
        value={value}
        busy={busy}
        onChange={vi.fn()}
        onCancel={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    expect(render("   ", false)).toMatch(/<button[^>]*disabled=""[^>]*>提交修改<\/button>/);
    expect(render("有效消息", true)).toMatch(/<button[^>]*disabled=""[^>]*>提交修改<\/button>/);
    expect(render("有效消息", false)).not.toMatch(/<button[^>]*disabled=""[^>]*>提交修改<\/button>/);
  });

  it("uses a full-width editing bubble instead of fit-content sizing", () => {
    const css = readFileSync(
      join(process.cwd(), "src/renderer/src/styles/modules/chat.css"),
      "utf8",
    );

    expect(css).toMatch(/\.user-message-bubble\.is-editing\s*\{[^}]*width:\s*100%[^}]*max-width:\s*720px/s);
    expect(css).toMatch(/\.user-message-editor\s*\{[^}]*width:\s*100%[^}]*min-width:\s*0/s);
  });
});
