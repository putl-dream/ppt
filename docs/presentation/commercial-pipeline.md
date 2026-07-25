# Commercial Visual Compiler v2

> 文档类型：现行架构
> 状态：主链路已落地，当前重点为质量可信化和真实交付验证

## 1. 目标

Lean Mode 在一次结构化内容模型调用后，通过确定性本地管线生成商业初稿：

- 每页有明确结论和视觉焦点；
- 页面角色与节奏可辨认；
- 素材有来源、授权状态和裁切策略；
- 相同输入得到相同结构结果；
- 主要对象保持可编辑；
- 质量报告区分机器证据和人工审美。

## 2. 主链路

```text
request
  → structured model call
  → LeanDeckSpecV2
  → CommercialVisualDirector
  → DirectedDeckPlanV1
  → CommercialAssetResolver
  → Resolved assets
  → Commercial compiler
  → Presentation + commands
  → CommercialQualityGate
  → optional bounded visual review
  → CommitGate / preview / export
```

## 3. 分层责任

| 层 | 负责 | 不负责 |
|---|---|---|
| 内容模型 | 商业叙事、结论、内容结构、视觉意图 | 坐标和底层元素 |
| DeckSpec v2 | 内容与视觉语义 | 渲染后元素树 |
| Visual Director | Scene、节奏、variant、素材需求 | 发明商业事实 |
| Asset Resolver | 搜索、过滤、本地化、授权、焦点 | 决定叙事 |
| Compiler | 确定性坐标和可编辑元素 | 自主重写内容 |
| Quality Gate | 可复现硬失败、warning 和证据 | 冒充人工审美 |
| Renderer/Exporter | 忠实呈现、postflight | 二次解释设计意图 |

## 4. DeckSpec v2

DeckSpec 保存：

- deck 目标和受众；
- 每页 narrative role、headline、supporting content；
- visual intent；
- image mode；
- chart/data semantics；
- notes/source。

它不保存坐标、字体尺寸和 PresentationElement。

Schema 在 Provider 原生 structured output 和本地 Zod 两处验证。模型文本解析兼容只存在于输入边界，不能成为第二个规范。

## 5. Commercial Scene

Scene 是商业页面语法，不是静态模板。Scene 声明：

- 适用 narrative role；
- 必需/可选内容槽；
- 支持的资产类型；
- layout/grammar 映射；
- variant 和背景策略；
- 质量约束。

Visual Director 使用确定性输入选择 Scene，并控制：

- 强视觉页和信息页交替；
- 首尾呼应；
- 避免连续同构；
- 关键数据/案例/计划的视觉角色；
- 素材请求。

## 6. 素材解析

```text
AssetRequest
  → search candidates
  → license/source/dimension hard filter
  → deterministic relevance score
  → localize
  → focus/crop
  → ResolvedAssetManifest
```

规则：

- restricted 永远阻断；
- unknown license 不能声称已授权；
- sourcePageUrl/provider 保留到 Presentation；
- required image 无合格候选时质量失败；
- 一张图默认不跨页重复；
- 无图降级必须显式更换 Scene，而不是留下空框。

## 7. 确定性编译

编译器：

- 使用稳定 ID factory；
- 不读取时间、随机数或网络；
- 同一 Spec、Plan、Asset Manifest 生成相同 canonical hash；
- 输出 Presentation 与可审查 commands；
- 复用 Design System、Layout Grammar 和原生 chart。

## 8. 质量门

硬失败至少包括：

- schema/element invalid；
- overflow 或严重重叠；
- required asset 缺失；
- 未授权 restricted asset；
- 空卡片/空图片框；
- 无可识别焦点；
- postflight 结构失败。

机器评分必须附 `scoreDetails` 证据。不适用维度为 `null/not-applicable`，不得用其他分数伪造 100。

人工审美边界见 [商业视觉质量评分规范](./quality-rubric.md)。

## 9. 有界视觉复盘

只有首版已通过 deterministic gate 且 Electron 成功渲染 PNG 时才允许：

- 最多检查有限页面；
- 最多一次模型调用；
- 最多修改有限页面；
- 只修改 visual 字段；
- 修订版必须重新过 gate。

失败时保留首个已通过质量门的版本，不无限重试。

## 10. 交付

商业生成脚本输出：

- editable PPTX
- contact sheet HTML
- quality/postflight JSON
- Presentation snapshot

生成只有在 CommercialQualityGate 与 PPTX postflight 同时通过时成功。

## 11. 关键实现

- `src/shared/lean/deck-spec-v2.ts`
- `src/shared/commercial-visual/`
- `src/main/agent/lean/lean-v2-pipeline.ts`
- `src/main/agent/lean/lean-presentation-service.ts`
- `src/main/agent/lean/commercial-visual-review.ts`
- `src/main/agent/assets/commercial-asset-resolver.ts`
- `src/main/deck/pptx-postflight.ts`
- `scripts/generate-commercial-pptx.ts`

## 12. 当前重点

- 建立真实商业样稿和三人盲评数据；
- 验证机器指标与人工评分的相关性；
- 扩大真实素材与授权覆盖；
- 提高图片焦点和品牌适配；
- 保持原生图表、notes 和三端一致性；
- 与 Agent Mode 的后半段 artifact/quality/proposal 契约逐步统一。
