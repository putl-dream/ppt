import { designSystemV2Schema } from "@design-system";
import { z } from "zod";
import type { Presentation, Slide } from "./presentation";
import { slideSchema } from "./presentation";

export const presentationCommandSchema = z.discriminatedUnion("type", [
  z.object({
    id: z.string(),
    type: z.literal("add-slide"),
    slide: slideSchema,
    index: z.number().int().nonnegative(),
  }),
  z.object({
    id: z.string(),
    type: z.literal("remove-slide"),
    slideId: z.string(),
  }),
  z.object({
    id: z.string(),
    type: z.literal("set-presentation-title"),
    title: z.string().min(1),
  }),
  z.object({
    id: z.string(),
    type: z.literal("set-slide-title"),
    slideId: z.string(),
    title: z.string().min(1),
  }),
  z.object({
    id: z.string(),
    type: z.literal("set-design-system"),
    designSystem: designSystemV2Schema,
  }),
  z.object({
    id: z.string(),
    type: z.literal("restore-slide"),
    slide: slideSchema,
  }),
]);

export type PresentationCommand = z.infer<typeof presentationCommandSchema>;

export interface ExecutedCommand {
  command: PresentationCommand;
  inverse: PresentationCommand;
}

export type PreparedCommandMutationKind = "execute" | "execute-many" | "undo" | "redo";

/**
 * A CommandBus mutation calculated against a specific in-memory revision.
 *
 * The presentation is a detached preview for validation/persistence. The bus
 * keeps the authoritative prepared state private so callers cannot mutate the
 * eventual commit by changing this object.
 */
export interface PreparedCommandMutation {
  readonly id: string;
  readonly kind: PreparedCommandMutationKind;
  readonly baseMutationRevision: number;
  readonly presentation: Presentation;
  readonly noOp: boolean;
}

interface PreparedCommandMutationState {
  readonly kind: PreparedCommandMutationKind;
  readonly baseMutationRevision: number;
  readonly presentation: Presentation;
  readonly undoStack: ExecutedCommand[];
  readonly redoStack: ExecutedCommand[];
  readonly noOp: boolean;
}

function nextRevision(presentation: Presentation): Presentation {
  return { ...presentation, revision: presentation.revision + 1 };
}

export function executeCommand(
  presentation: Presentation,
  input: PresentationCommand,
): { presentation: Presentation; executed: ExecutedCommand } {
  const command = presentationCommandSchema.parse(input);

  if (command.type === "add-slide") {
    if (presentation.slides.some((slide) => slide.id === command.slide.id)) {
      throw new Error(`Duplicate slide id: ${command.slide.id}`);
    }
    const index = Math.min(command.index, presentation.slides.length);
    const slides = [...presentation.slides];
    slides.splice(index, 0, command.slide);
    return {
      presentation: nextRevision({ ...presentation, slides }),
      executed: {
        command,
        inverse: { id: crypto.randomUUID(), type: "remove-slide", slideId: command.slide.id },
      },
    };
  }

  if (command.type === "remove-slide") {
    const index = presentation.slides.findIndex((slide) => slide.id === command.slideId);
    if (index < 0) throw new Error(`Slide not found: ${command.slideId}`);
    const slide = presentation.slides[index];
    return {
      presentation: nextRevision({
        ...presentation,
        slides: presentation.slides.filter((item) => item.id !== command.slideId),
      }),
      executed: {
        command,
        inverse: { id: crypto.randomUUID(), type: "add-slide", slide, index },
      },
    };
  }

  if (command.type === "set-presentation-title") {
    return {
      presentation: nextRevision({ ...presentation, title: command.title }),
      executed: {
        command,
        inverse: {
          id: crypto.randomUUID(),
          type: "set-presentation-title",
          title: presentation.title,
        },
      },
    };
  }

  if (command.type === "set-slide-title") {
    const slideIndex = presentation.slides.findIndex((slide) => slide.id === command.slideId);
    if (slideIndex < 0) throw new Error(`Slide not found: ${command.slideId}`);
    const previousSlide: Slide = presentation.slides[slideIndex];
    const slides = presentation.slides.map((slide) =>
      slide.id === command.slideId ? { ...slide, title: command.title } : slide,
    );
    return {
      presentation: nextRevision({ ...presentation, slides }),
      executed: {
        command,
        inverse: {
          id: crypto.randomUUID(),
          type: "set-slide-title",
          slideId: command.slideId,
          title: previousSlide.title,
        },
      },
    };
  }

  if (command.type === "set-design-system") {
    // Store-only update. SVG pages author their own typography/chrome; do not
    // restyle elements or re-run Layout Grammar.
    return {
      presentation: nextRevision({
        ...presentation,
        designSystem: command.designSystem,
      }),
      executed: {
        command,
        inverse: {
          id: crypto.randomUUID(),
          type: "set-design-system",
          designSystem: presentation.designSystem,
        },
      },
    };
  }

  if (command.type === "restore-slide") {
    const slideIndex = presentation.slides.findIndex((s) => s.id === command.slide.id);
    if (slideIndex < 0) throw new Error(`Slide not found: ${command.slide.id}`);
    const targetSlide = presentation.slides[slideIndex];

    const slides = presentation.slides.map((s) => (s.id === command.slide.id ? command.slide : s));

    return {
      presentation: nextRevision({ ...presentation, slides }),
      executed: {
        command,
        inverse: {
          id: crypto.randomUUID(),
          type: "restore-slide",
          slide: targetSlide,
        },
      },
    };
  }

  throw new Error(`Unhandled command type`);
}

/**
 * Presentation 的会话内写入边界。
 * 所有命令都通过纯函数 executeCommand 产生新快照，并在此维护 undo/redo 历史。
 */
export class CommandBus {
  private undoStack: ExecutedCommand[] = [];
  private redoStack: ExecutedCommand[] = [];
  private mutationRevision = 0;
  private readonly preparedMutations = new Map<string, PreparedCommandMutationState>();
  private presentation: Presentation;

  constructor(presentation: Presentation) {
    this.presentation = structuredClone(presentation);
  }

  /** 返回深拷贝快照，避免调用方绕过命令系统直接修改内部状态。 */
  getSnapshot(): Presentation {
    return structuredClone(this.presentation);
  }

  /** 在临时快照中计算单条命令，不改变当前 Presentation 或历史栈。 */
  prepareExecute(command: PresentationCommand): PreparedCommandMutation {
    const result = executeCommand(this.presentation, command);
    return this.createPreparedMutation(
      "execute",
      result.presentation,
      [...this.undoStack, result.executed],
      [],
      false,
    );
  }

  /**
   * 以事务方式准备一组命令：全部在临时快照成功后才产生 prepared mutation，
   * 任一命令抛错时不会产生部分写入。
   */
  prepareExecuteMany(commands: PresentationCommand[]): PreparedCommandMutation {
    let stagedPresentation = this.presentation;
    const stagedExecutions: ExecutedCommand[] = [];

    for (const command of commands) {
      const result = executeCommand(stagedPresentation, command);
      stagedPresentation = result.presentation;
      stagedExecutions.push(result.executed);
    }

    return this.createPreparedMutation(
      "execute-many",
      stagedPresentation,
      [...this.undoStack, ...stagedExecutions],
      [],
      false,
    );
  }

  /** 准备撤销；没有可撤销命令时返回明确的 no-op。 */
  prepareUndo(): PreparedCommandMutation {
    const executed = this.undoStack.at(-1);
    if (!executed) {
      return this.createPreparedMutation(
        "undo",
        this.presentation,
        this.undoStack,
        this.redoStack,
        true,
      );
    }

    const result = executeCommand(this.presentation, executed.inverse);
    return this.createPreparedMutation(
      "undo",
      result.presentation,
      this.undoStack.slice(0, -1),
      [...this.redoStack, executed],
      false,
    );
  }

  /** 准备重做；没有可重做命令时返回明确的 no-op。 */
  prepareRedo(): PreparedCommandMutation {
    const executed = this.redoStack.at(-1);
    if (!executed) {
      return this.createPreparedMutation(
        "redo",
        this.presentation,
        this.undoStack,
        this.redoStack,
        true,
      );
    }

    const result = executeCommand(this.presentation, executed.command);
    return this.createPreparedMutation(
      "redo",
      result.presentation,
      [...this.undoStack, result.executed],
      this.redoStack.slice(0, -1),
      false,
    );
  }

  /**
   * 原子提交先前准备的 mutation。
   *
   * 任意其他真实提交都会推进内部 revision，使旧 prepared mutation 失效。
   */
  commitPreparedMutation(prepared: PreparedCommandMutation): Presentation {
    if (prepared.baseMutationRevision !== this.mutationRevision) {
      this.preparedMutations.delete(prepared.id);
      throw new Error(
        `Stale prepared mutation: expected CommandBus revision ${prepared.baseMutationRevision}, current revision is ${this.mutationRevision}`,
      );
    }

    const state = this.preparedMutations.get(prepared.id);
    if (!state) {
      throw new Error(`Unknown or already committed prepared mutation: ${prepared.id}`);
    }
    if (
      state.baseMutationRevision !== prepared.baseMutationRevision ||
      state.kind !== prepared.kind ||
      state.noOp !== prepared.noOp
    ) {
      throw new Error(`Prepared mutation metadata mismatch: ${prepared.id}`);
    }

    const nextPresentation = structuredClone(state.presentation);
    const nextUndoStack = structuredClone(state.undoStack);
    const nextRedoStack = structuredClone(state.redoStack);

    this.preparedMutations.delete(prepared.id);
    if (state.noOp) return this.getSnapshot();

    this.presentation = nextPresentation;
    this.undoStack = nextUndoStack;
    this.redoStack = nextRedoStack;
    this.mutationRevision += 1;
    return this.getSnapshot();
  }

  discardPreparedMutation(prepared: PreparedCommandMutation): void {
    this.preparedMutations.delete(prepared.id);
  }

  /** 原子执行单条命令；成功后记录逆命令，并清空 redo 历史。 */
  execute(command: PresentationCommand): Presentation {
    return this.commitPreparedMutation(this.prepareExecute(command));
  }

  /** 原子执行一组命令；任一命令失败都不会改变真实状态。 */
  executeMany(commands: PresentationCommand[]): Presentation {
    return this.commitPreparedMutation(this.prepareExecuteMany(commands));
  }

  /** 撤销最近一次已提交命令，并把原命令移入 redo 栈。 */
  undo(): Presentation {
    return this.commitPreparedMutation(this.prepareUndo());
  }

  /** 重做最近一次撤销的命令，并重新生成可撤销记录。 */
  redo(): Presentation {
    return this.commitPreparedMutation(this.prepareRedo());
  }

  private createPreparedMutation(
    kind: PreparedCommandMutationKind,
    presentation: Presentation,
    undoStack: ExecutedCommand[],
    redoStack: ExecutedCommand[],
    noOp: boolean,
  ): PreparedCommandMutation {
    const id = crypto.randomUUID();
    const state: PreparedCommandMutationState = {
      kind,
      baseMutationRevision: this.mutationRevision,
      presentation: structuredClone(presentation),
      undoStack: structuredClone(undoStack),
      redoStack: structuredClone(redoStack),
      noOp,
    };
    this.preparedMutations.set(id, state);
    return Object.freeze({
      id,
      kind,
      baseMutationRevision: state.baseMutationRevision,
      presentation: structuredClone(state.presentation),
      noOp,
    });
  }
}
