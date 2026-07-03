# 叙事弧与页数规划

来源思路：[guizang-ppt-skill](https://github.com/op7418/guizang-ppt-skill)。在 storyboard / outline 阶段使用。

## 叙事弧模板

```
钩子 Hook        → 1 页  : 反差 / 问题 / 硬数据（cover 或 case）
定调 Context     → 1–2 页: 背景 / 为什么讲（section + concept）
主体 Core        → 3–5 页: 核心论点，layout 穿插 concept/process/comparison/case
转折 Shift       → 1 页  : 打破预期 / 新观点（section 或 comparison）
收束 Takeaway    → 1–2 页: 金句 / 行动项（summary）
```

**三张表对齐后再写 slide**：叙事弧 + 页数预算 + 版式节奏表（见下）。

## 时长 → 页数

| 分享时长 | 建议页数 |
|----------|----------|
| 15 分钟 | ≈ 10 页 |
| 30 分钟 | ≈ 20 页 |
| 45 分钟 | ≈ 25–30 页 |

轻量路径（≤10 页）可跳过 brief，但 storyboard 仍应隐含叙事弧。

## 版式节奏（8 页示例）

| 页 | layout | 叙事角色 |
|----|--------|----------|
| 1 | cover | Hook · 开场 |
| 2 | case | 硬数据抛出 |
| 3 | concept | 背景/context |
| 4 | process | 流程/方法 |
| 5 | section | 章节呼吸 |
| 6 | comparison | 转折/对比 |
| 7 | concept | 核心论点 |
| 8 | summary | Takeaway |

## 节奏硬规则

- ❌ 连续 3 页以上**相同 layout**
- ❌ 8 页以上 deck 没有 `section`（章节呼吸）
- ❌ 全程只有 `concept`，缺少 `case`/`process`/`comparison` 变化
- ✅ 每 3–4 页插入 1 个 `section` 或 `cover` 级页面
- ✅ 数据页（`case`）与流程页（`process`）穿插在 concept 之间
- ✅ 7 页以上 deck 至少使用 **4 种不同 layout**

## 版式多样性（storyboard 自检）

| deck 规模 | 最少不同 layout 数 |
|-----------|-------------------|
| 7–8 页 | ≥ 4 |
| 10 页以上 | ≥ 5 |

必须覆盖：1 个 cover、1 个 summary、≥1 个 section、≥1 个数据或流程页（case/process）。

## chrome 与 kicker 分工（内容层）

| 字段 | 角色 | 示例 |
|------|------|------|
| `slide.title` | 页标题 / 栏目标题（稳定、可扫读） | 「上半年工作情况」 |
| body text[0] | 本页钩子 / kicker（每页不同、短） | 「一个数字改变决策」 |
| body text[1…] | 正文要点 | 独立 text element |

**反模式**：`slide.title` 与第一条 body 语义重复（如标题「设计先行」+ 要点「Phase 01 设计阶段」）。
