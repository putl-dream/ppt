import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import type { Presentation } from "@shared/presentation";
import {
  createSessionPresentation,
  createWelcomeMessage,
  type ProjectArtifact,
  type ProjectSandbox,
  sessionChatMessageSchema,
  sessionSnapshotSchema,
  type SessionBootstrap,
  type SessionChatMessage,
  type SessionSnapshot,
  type SessionSummary,
} from "@shared/session";

const storedSessionSchema = sessionSnapshotSchema;
const sessionFileSchema = z.object({
  version: z.literal(1),
  activeSessionId: z.string(),
  sessions: z.array(storedSessionSchema).min(1),
});

type SessionFile = z.infer<typeof sessionFileSchema>;

export class FileSessionStore {
  private data?: SessionFile;
  private writeQueue = Promise.resolve();
  private readonly projectRootPath: string;

  constructor(private readonly filePath: string, projectRootPath?: string) {
    this.projectRootPath = projectRootPath ?? join(dirname(filePath), "projects");
  }

  async initialize(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    try {
      const parsed = sessionFileSchema.parse(JSON.parse(await readFile(this.filePath, "utf8")));
      const activeExists = parsed.sessions.some(
        (item) => item.session.id === parsed.activeSessionId,
      );
      this.data = activeExists
        ? parsed
        : { ...parsed, activeSessionId: parsed.sessions[0].session.id };
      const expiredApprovals = this.expirePendingApprovals();
      const projectChanged = await this.materializeProjectSandboxes();
      if (expiredApprovals || projectChanged || !activeExists) await this.persist();
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && !(error instanceof SyntaxError) && !(error instanceof z.ZodError)) {
        throw error;
      }
      this.data = this.createInitialData();
      await this.materializeProjectSandboxes();
      await this.persist();
    }
  }

  getBootstrap(): SessionBootstrap {
    const data = this.requireData();
    return {
      sessions: this.listSummaries(data),
      activeSession: structuredClone(this.findSession(data.activeSessionId)),
    };
  }

  getSession(sessionId: string): SessionSnapshot {
    return structuredClone(this.findSession(sessionId));
  }

  async createSession(): Promise<SessionBootstrap> {
    const data = this.requireData();
    const title = `新 PPT 项目 ${data.sessions.length + 1}`;
    const now = new Date().toISOString();
    const presentation = createSessionPresentation(title);
    const snapshot: SessionSnapshot = {
      session: this.toSummary(crypto.randomUUID(), now, now, presentation),
      presentation,
      messages: [createWelcomeMessage(title)],
    };
    await this.materializeProjectSandbox(snapshot);
    data.sessions.unshift(snapshot);
    data.activeSessionId = snapshot.session.id;
    await this.persist();
    return this.getBootstrap();
  }

  async selectSession(sessionId: string): Promise<SessionBootstrap> {
    const data = this.requireData();
    this.findSession(sessionId);
    data.activeSessionId = sessionId;
    await this.persist();
    return this.getBootstrap();
  }

  async deleteSession(sessionId: string): Promise<SessionBootstrap> {
    const data = this.requireData();
    const index = data.sessions.findIndex((item) => item.session.id === sessionId);
    if (index === -1) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    data.sessions.splice(index, 1);
    if (data.sessions.length === 0) {
      const initial = this.createInitialData();
      data.sessions = initial.sessions;
      data.activeSessionId = initial.activeSessionId;
      await this.materializeProjectSandboxes();
    } else if (data.activeSessionId === sessionId) {
      data.activeSessionId = data.sessions[0].session.id;
    }
    await this.persist();
    return this.getBootstrap();
  }

  async savePresentation(sessionId: string, presentation: Presentation): Promise<void> {
    const snapshot = this.findSession(sessionId);
    snapshot.presentation = structuredClone(presentation);
    snapshot.session = this.toSummary(
      snapshot.session.id,
      snapshot.session.createdAt,
      new Date().toISOString(),
      presentation,
    );
    await this.writeProjectFile(
      snapshot,
      "deck/snapshot.json",
      `${JSON.stringify(presentation, null, 2)}\n`,
      true,
    );
    await this.persist();
  }

  async saveMessages(sessionId: string, messages: SessionChatMessage[]): Promise<void> {
    const snapshot = this.findSession(sessionId);
    snapshot.messages = sessionChatMessageSchema.array().parse(structuredClone(messages));
    snapshot.session.updatedAt = new Date().toISOString();
    await this.persist();
  }

  private createInitialData(): SessionFile {
    const now = new Date().toISOString();
    const title = "未命名演示文稿";
    const presentation = createSessionPresentation(title);
    const snapshot: SessionSnapshot = {
      session: this.toSummary(crypto.randomUUID(), now, now, presentation),
      presentation,
      messages: [createWelcomeMessage()],
    };
    return { version: 1, activeSessionId: snapshot.session.id, sessions: [snapshot] };
  }

  private async materializeProjectSandboxes(): Promise<boolean> {
    let changed = false;
    for (const snapshot of this.requireData().sessions) {
      changed = (await this.materializeProjectSandbox(snapshot)) || changed;
    }
    return changed;
  }

  private async materializeProjectSandbox(snapshot: SessionSnapshot): Promise<boolean> {
    const project = this.createProjectSandbox(snapshot);
    const changed = JSON.stringify(snapshot.project) !== JSON.stringify(project);
    snapshot.project = project;

    await mkdir(project.rootPath, { recursive: true });
    await this.writeProjectFile(
      snapshot,
      "brief.md",
      createBriefTemplate(snapshot.session.title),
      false,
    );
    await this.writeProjectFile(
      snapshot,
      "outline.md",
      createOutlineTemplate(snapshot.session.title),
      false,
    );
    await this.writeProjectFile(snapshot, "research/sources.md", createResearchSourcesTemplate(), false);
    await this.writeProjectFile(snapshot, "research/notes.md", createResearchNotesTemplate(), false);
    await this.writeProjectFile(snapshot, "research/assets/.gitkeep", "", false);
    await this.writeProjectFile(snapshot, "slides/README.md", createSlidesReadmeTemplate(), false);
    await this.writeProjectFile(
      snapshot,
      "slides/001-title.md",
      createTitleSlideTemplate(snapshot.session.title),
      false,
    );
    await this.writeProjectFile(
      snapshot,
      "design/theme.json",
      `${JSON.stringify(createThemeTemplate(), null, 2)}\n`,
      false,
    );
    await this.writeProjectFile(snapshot, "design/layout-notes.md", createLayoutNotesTemplate(), false);
    await this.writeProjectFile(
      snapshot,
      "deck/snapshot.json",
      `${JSON.stringify(snapshot.presentation, null, 2)}\n`,
      false,
    );
    await this.writeProjectFile(snapshot, "history/README.md", createHistoryReadmeTemplate(), false);

    return changed;
  }

  private createProjectSandbox(snapshot: SessionSnapshot): ProjectSandbox {
    const rootPath =
      snapshot.project?.rootPath ?? join(this.projectRootPath, `session-${snapshot.session.id}`);
    const artifacts: ProjectArtifact[] = [
      {
        id: "brief",
        title: "目的、方向与受众",
        path: "brief.md",
        kind: "brief",
        status: "draft",
        dependsOn: [],
      },
      {
        id: "outline",
        title: "内容大纲",
        path: "outline.md",
        kind: "outline",
        status: "draft",
        dependsOn: ["brief"],
      },
      {
        id: "research",
        title: "资料与素材",
        path: "research/",
        kind: "research",
        status: "draft",
        dependsOn: ["outline"],
      },
      {
        id: "slides",
        title: "逐页内容与设计方案",
        path: "slides/",
        kind: "slide-plan",
        status: "draft",
        dependsOn: ["outline", "research", "design"],
      },
      {
        id: "design",
        title: "设计系统与版式偏好",
        path: "design/",
        kind: "design",
        status: "draft",
        dependsOn: ["brief"],
      },
      {
        id: "deck",
        title: "PPT 结构化快照与导出物",
        path: "deck/",
        kind: "deck",
        status: "draft",
        dependsOn: ["slides", "design"],
      },
      {
        id: "history",
        title: "关键版本记录",
        path: "history/",
        kind: "history",
        status: "draft",
        dependsOn: ["brief", "outline", "slides", "deck"],
      },
    ];
    return { rootPath, artifacts };
  }

  private async writeProjectFile(
    snapshot: SessionSnapshot,
    relativePath: string,
    content: string,
    overwrite: boolean,
  ): Promise<void> {
    if (!snapshot.project) throw new Error("Project sandbox has not been initialized.");
    const filePath = join(snapshot.project.rootPath, relativePath);
    await mkdir(dirname(filePath), { recursive: true });
    if (!overwrite && (await pathExists(filePath))) return;
    await writeFile(filePath, content, "utf8");
  }

  private expirePendingApprovals(): boolean {
    let changed = false;
    for (const snapshot of this.requireData().sessions) {
      snapshot.messages = snapshot.messages.map((message) => {
        if (!message.approval) return message;
        changed = true;
        const { approval: _, ...rest } = message;
        return {
          ...rest,
          content: `${message.content}\n\n该审批请求已随应用重启失效，请重新提交指令。`,
        };
      });
    }
    return changed;
  }

  private toSummary(
    id: string,
    createdAt: string,
    updatedAt: string,
    presentation: Presentation,
  ): SessionSummary {
    return {
      id,
      title: presentation.title,
      createdAt,
      updatedAt,
      slideCount: presentation.slides.length,
      revision: presentation.revision,
    };
  }

  private listSummaries(data: SessionFile): SessionSummary[] {
    return [...data.sessions]
      .sort((a, b) => b.session.updatedAt.localeCompare(a.session.updatedAt))
      .map((item) => structuredClone(item.session));
  }

  private findSession(sessionId: string): SessionSnapshot {
    const snapshot = this.requireData().sessions.find((item) => item.session.id === sessionId);
    if (!snapshot) throw new Error(`Session not found: ${sessionId}`);
    return snapshot;
  }

  private requireData(): SessionFile {
    if (!this.data) throw new Error("Session store has not been initialized.");
    return this.data;
  }

  private async persist(): Promise<void> {
    const payload = `${JSON.stringify(this.requireData(), null, 2)}\n`;
    this.writeQueue = this.writeQueue.then(async () => {
      const temporaryPath = `${this.filePath}.tmp`;
      await writeFile(temporaryPath, payload, "utf8");
      await rename(temporaryPath, this.filePath);
    });
    await this.writeQueue;
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function createBriefTemplate(title: string): string {
  return `# Brief: ${title}

## 目的
- 这份 PPT 要促成什么决定、理解或行动？

## 受众
- 面向谁？他们已知什么、关心什么、抗拒什么？

## 场景
- 汇报、路演、培训、销售、复盘或其他？

## 方向
- 期望语气、视觉风格、内容深度和时长。
`;
}

function createOutlineTemplate(title: string): string {
  return `# Outline: ${title}

## 核心观点
- 

## 章节结构
1. 开场与背景
2. 问题或机会
3. 方案或论证
4. 结论与行动

## 待确认问题
- 
`;
}

function createResearchSourcesTemplate(): string {
  return `# Sources

记录外部资料、链接、访谈、数据来源和使用约束。
`;
}

function createResearchNotesTemplate(): string {
  return `# Research Notes

## 事实
- 

## 观点
- 

## 可用素材
- 
`;
}

function createSlidesReadmeTemplate(): string {
  return `# Slide Plans

每页一个 Markdown 文件，例如 \`001-title.md\`。记录页面目标、内容要点、素材引用和设计意图。
`;
}

function createTitleSlideTemplate(title: string): string {
  return `# 001 - 标题页

## 页面目标
- 建立主题和语境。

## 内容
- 标题：${title}
- 副标题：

## 设计意图
- 清晰表达主题，避免在封面堆叠过多信息。

## 依赖素材
- 
`;
}

function createThemeTemplate() {
  return {
    tone: "professional",
    typography: {
      heading: "system-ui",
      body: "system-ui",
    },
    palette: {
      primary: "#2563eb",
      accent: "#10b981",
      background: "#f8fafc",
      text: "#111827",
    },
    layout: {
      ratio: "16:9",
      density: "balanced",
    },
  };
}

function createLayoutNotesTemplate(): string {
  return `# Layout Notes

- 每页先明确一个信息任务，再选择版式。
- 内容页优先保证扫描效率和层级清晰。
- 图表、图片和表格必须能追溯到 \`research/\` 中的来源。
`;
}

function createHistoryReadmeTemplate(): string {
  return `# History

记录关键版本、决策变化和重要导出结果。不要在这里存放密钥或临时凭证。
`;
}
