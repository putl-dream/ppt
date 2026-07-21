# AGENTS.md

本文件是写给在本仓库（Agent PPT）里工作的 AI coding agent 的规则。目的是约束"想法很好但落地质量参差"的问题：范围失控、为了测试变绿而作弊、遇到失败就甩锅、以及"测试通过但真实调用报错"。请在开始任何改动前完整阅读本文件。

## 项目速览

- Electron + electron-vite 桌面应用，前端 React 19 + TypeScript，主进程管理 Agent Runtime / Gateway / CommitGate。
- 关键目录：
  - `src/renderer/`：React 工作区、聊天流、PPT 镜像、设置面板
  - `src/main/agent/`：Agent runtime、工具注册、模型 gateway、commit gate、sub-agent
  - `src/shared/`：presentation 模型、command 模型、layout 系统、design tokens
  - `src/main/project/`：本地项目沙箱、artifact IO、diff
  - `src/main/deck/`：缩略图、导出历史、PPTX 导出
  - `skills/`：brief / outline / storyboard / layout / beautify / export / review 等工作流 skill
  - `tests/`：单元测试为主，`*.integration.test.ts` 是需要真实模型凭证的集成测试
- 详细架构说明见 `README.md` / `README.en.md` 和 `docs/README.md` 索引的设计文档，改动前先看是否已有相关计划文档，避免和已有方案冲突或重复造轮子。

## 常用命令（Windows / PowerShell，用 `npm.cmd`）

```powershell
npm.cmd run dev          # 启动开发环境
npm.cmd test             # 跑单元测试（已排除 *.integration.test.ts）
npm.cmd run test:integration:agent   # 跑真实网关集成测试，需要 OPENAI_API_KEY / ANTHROPIC_API_KEY
npm.cmd run typecheck    # tsc 严格检查（node + web 两个 tsconfig）
npm.cmd run build        # typecheck + electron-vite build
```

任何改动完成后，至少要跑 `npm.cmd run typecheck` 和 `npm.cmd test`；涉及模型调用相关代码（`src/main/agent/gateway/`、`src/main/agent/runtime/` 等）时，要评估是否需要 `test:integration:agent`。

## 一、范围与改动纪律

1. **只做能解决当前任务的最小改动**，不要顺手引入新的抽象层、新依赖，或对无关模块做"顺手优化"式重构。
2. 如果你认为存在更好的架构方案，先用简短文字描述方案和取舍，等待确认后再动手，不要直接大改。
3. 动手前先搜索仓库里是否已有类似模式（尤其是 `src/shared/layout-handlers/`、`src/main/agent/tools/` 这类高度模式化的目录），复用现有约定，不要另起一套写法。
4. 大任务（涉及多个模块 / 预计改动较大）必须先给出不超过 5 步的实施计划，且每一步写明验收方式；完成一步、验证通过后才能进入下一步，不允许跳步或一次性交付整个方案。

## 二、测试完整性：禁止"作弊式"让测试变绿

1. **测试文件是需求契约**，不允许为了让测试通过而放松断言、删除用例或修改期望值。
2. 测试失败时必须先归因，再动手：
   - 代码逻辑确实有 bug → 改代码，不碰测试；
   - 测试本身过时 / 理解有误 → 明确指出理由和依据，标记为"需要确认"，不要自行改测试；
   - 环境或 mock 配置问题 → 先解决这个，不要动业务逻辑。
3. **禁止针对具体测试输入写特判或硬编码返回值**来让某个用例通过。修复必须是符合业务逻辑的通用改动；做不到通用修复时，说明原因并暂停，不要用特判绕过去。
4. 任何一次改动如果涉及修改了 `tests/**` 下的文件，必须在总结里显式列出：改了哪个文件、改了什么、为什么改。没有修改测试文件时也要明确说明"未修改测试文件"。

## 三、遇到已存在的失败：不能凭感觉甩锅

1. 在改动前，先运行一次相关测试建立基线，记录当前（未修改状态下）有哪些测试本来就失败，作为后续判断依据。
2. 如果判断某个测试失败"与本次改动无关"，必须给出可复现的证据（例如：已确认基线阶段该测试同样失败 / 用 `git stash` 还原后重跑仍失败），不能仅凭"看起来不相关"下结论。
3. 即使确认某个失败与本次改动无关，也必须在总结中列出：具体是哪个测试、判断依据是什么、是否需要用户决定要不要处理。不允许直接跳过、完全不提及。

## 四、"测试通过"不等于"真实可用"

本仓库把单元测试和集成测试分开（`npm.cmd test` 默认排除 `*.integration.test.ts`），这个边界本身就说明"mock 通过"和"真实调用通过"是两件事，务必区分：

1. 涉及外部依赖调用的改动（模型 gateway、网络请求、文件系统、PPTX 导出等），除了单元测试，要说明是否有对应的集成测试覆盖；没有的话，指出这是验证盲区，并给出建议的手动验证方式。
2. 凡是 mock 外部依赖的地方，mock 的数据结构必须基于真实接口文档 / 项目里已有的真实响应样本，不能凑一个"看起来合理"的假数据。
3. 如果由于沙箱限制（无网络、无真实 API Key，如 `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` 未配置）导致无法运行 `test:integration:agent` 或做真实调用验证，必须在总结中明确说明这一限制，并列出建议用户手动验证的具体步骤，**不能因为单元测试通过就宣称任务已完成**。
4. 对于导出 PPTX、渲染反馈循环（`src/main/agent/runtime/render-feedback-loop.ts`）等"生成结果是否正确"依赖真实产物的功能，尽量在验证步骤里实际生成一次产物（如 `npm.cmd run generate:pptx`）并检查输出，而不是只看单测断言。

## 五、完成任务前的自查清单

提交/总结改动前，确认以下几点都已经做到：

- [ ] `npm.cmd run typecheck` 和 `npm.cmd test` 已跑过且通过，并给出实际输出而非"应该没问题"
- [ ] diff 范围与任务描述匹配，没有无关的顺手改动
- [ ] 如果修改了 `tests/**`，已说明改了什么、为什么
- [ ] 如果存在与本次改动无关的失败测试，已给出判断依据并上报，而不是静默跳过
- [ ] 如果涉及外部依赖 / 真实调用且未做集成验证，已明确说明这个限制和建议的手动验证方式
