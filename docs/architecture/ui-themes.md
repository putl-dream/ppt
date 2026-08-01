# 工作台 UI 主题（文件夹 CSS）

状态：Implemented。

Agent PPT 支持文件夹 CSS 工作台外观定制：在固定根目录
`~/.agent-ppt/themes/<主题名>/theme.css` 放置主题包，即可在设置中切换。
主题只影响**软件自身界面**，不影响幻灯片 DesignSystem、SVG 预览纸面或 PPTX 导出。
仅识别一级子目录中的 `theme.css`；根目录下的扁平 `*.css` 不会列入。

用户向「能做什么 / 食谱」见 [CSS 主题指南](../user-manual/css-themes.md)。
实现与样式契约的代码侧说明见
[`src/renderer/src/styles/README.md`](../../src/renderer/src/styles/README.md)。

## 与幻灯片视觉的关系

| 轴 | 作用对象 | 形态 |
|---|---|---|
| 工作台 UI 主题（本文） | 侧栏、输入框、设置页、窗口壳 | 内置 Studio / Catnip + 用户 `themes/<名>/theme.css` |
| DesignSystemV2 | 演示文稿配色 / 版式语气 | JSON（`design/design-spec.json` 等） |

二者不要混用：改 UI 主题不会改导出的 PPT；改 design-spec 也不会换工作台皮肤。

## 目录与发现

- 固定根目录：`~/.agent-ppt/themes/`（不提供自选路径）
- 尊重 `AGENT_PPT_DATA_DIR`：根目录为 `{applicationDataRoot}/themes/`
- 扫描**一级子目录**；仅当存在 `theme.css` 时列入
- 子目录名即主题 id（Unicode 字母数字与 `-` `_`，如 `midnight`、`午夜蓝`）
- 内置 id `studio`、`catnip` 保留；同名用户主题文件夹会被忽略
- `theme.css` 上限 256KB；路径穿越与越界读取会被拒绝
- 首次启动创建根目录，写入 `README.md` 与示例 `example/theme.css`（不自动选中）

## 使用方式

1. 设置 → **界面外观** → **打开主题根目录**
2. 新建或编辑 `themes/<主题名>/theme.css`
3. **刷新列表**，选择主题

选中项持久化在 UI 设置（`uiThemeId`）。内置 Catnip 直接从 renderer bundle
注入；未知或已删除的自定义 id 回退为 Studio。

## 加载机制

```text
内置 Catnip raw CSS ───────────────┐
                                  ├→ Renderer useAppearanceRuntime
themes/<id>/theme.css             │  → <style id="user-ui-theme"> 注入完整 CSS
  → Main list/read（IPC）─────────┘  → 覆盖 semantic token / 区域样式
```

- 内置 `data-skin="studio"` 始终作为底座
- 自定义主题是**叠加层**，不是替换整棵样式树
- CSP 允许 `style-src 'unsafe-inline'`，因此直接注入文本即可，无需自定义协议
- 主题 CSS **不裁剪选择器**；安全边界是目录隔离与体积上限

相关代码：

| 位置 | 职责 |
|---|---|
| `src/main/ui-themes.ts` | 目录 ensure / list / read |
| `ui-themes:list` / `read` / `open-directory` | IPC |
| `src/renderer/src/styles/themes/catnip.css` | 随应用打包的 Catnip 主题 |
| `src/renderer/src/app/userUiTheme.ts` | 内置主题映射、注入 / 移除 style 节点 |
| `src/renderer/src/app/useAppearanceRuntime.ts` | 选中主题后加载 CSS |
| 设置 → 界面外观 | 选择、打开文件夹、刷新 |

## 稳定契约（推荐写法）

优先覆盖 semantic CSS 变量，并按明暗双轴书写。只改 token 的主题应能整体改变
窗口背景、侧栏、主输入区与设置页，而无需绑定易变的组件 class。

选择器固定写成 `:root[data-skin][data-color-scheme="…"]`。内置 skin 在
`tokens/skins/studio.css` 里用 `:root[data-skin="studio"][data-color-scheme="…"]`
（特异度 0,3,0）定义整套色板；主题若只写 `:root[data-color-scheme="…"]`
（0,2,0）会输掉级联，颜色静默失效。`[data-skin]` 让特异度持平，注入的
`<style id="user-ui-theme">` 位于 `<head>` 末尾，靠文档顺序取胜。

```css
:root[data-skin][data-color-scheme="dark"] {
  --surface-canvas: #0f1419;   /* 窗口 / 应用背景 */
  --surface-base: #151b22;     /* 标题栏 + 侧栏连续壳 */
  --surface-raised: #1b222c;   /* 主画布、设置页、输入卡片 */
  --surface-sunken: #212a35;   /* 凹陷输入、代码块 */
  --surface-overlay: #27313d;  /* 浮层卡片、菜单 */
  --text-primary: #f3f6fa;
  --text-secondary: #a8b3c2;
  --text-muted: #7b8796;
  --border-subtle: rgba(255, 255, 255, 0.06);
  --border-default: rgba(255, 255, 255, 0.1);
  --border-strong: rgba(255, 255, 255, 0.16);
  --border-focused: rgba(255, 255, 255, 0.22);
}

:root[data-skin][data-color-scheme="light"] {
  --surface-canvas: #dde3ea;
  --surface-base: #e7ecf2;
  --surface-raised: #f7f9fc;
  --surface-sunken: #eef2f7;
  --surface-overlay: #ffffff;
  --text-primary: #12161c;
  --text-secondary: #4a5563;
  --text-muted: #6b7280;
  --border-subtle: rgba(0, 0, 0, 0.06);
  --border-default: rgba(0, 0, 0, 0.1);
}
```

表面 elevation 顺序：`canvas < base < raised < sunken < overlay`。暗色主题中
`sunken` 不应比 `raised` 更暗，否则输入区会像黑洞。

完整 semantic 名称见 `src/renderer/src/styles/tokens/semantic.css`。

## 深度定制

次稳定面是区域钩子：

| 钩子 | 区域 |
|---|---|
| `[data-ui-region="sidebar"]` | 工作台 / 设置侧栏 |
| `[data-ui-region="composer"]` | 统一输入区 |
| `[data-ui-region="canvas"]` | 主画布（聊天、文件、设置内容、预览面板） |
| `[data-ui-region="settings"]` | 设置页主体 |

示例：

```css
[data-ui-region="composer"] .double-deck-panel-card {
  border-radius: 16px;
  background-image: linear-gradient(180deg, transparent, rgba(0, 0, 0, 0.08));
}
```

组件 class 名可能随版本变更，**不**作为长期公共 API。能用 token 或
`data-ui-region` 解决的，不要绑死内部 class。

## 非主题面

下列表面故意不跟工作台主题走，以保持演示稿「纸面」观感：

- 幻灯片预览纸面（如 `.mirror-slide-frame`、`.mirror-focus-canvas` 的固定浅色底）
- DesignSystem / SVG 页面内容本身

## 明确边界

- 不做主题市场、zip 包、远程 URL 主题
- 不提供「选择任意文件夹作为主题源」；根目录固定
- 不把根目录下的扁平 `themes/*.css` 列入主题列表
- 本轮不加载主题包内相对路径资源（`url(./bg.png)`）；目录结构为后续预留
- 不把 `UiSkin` 扩成任意字符串；自定义主题走独立的 `uiThemeId`
- 不做 CSS 选择器白名单 / sanitize

## 验证

- 单元测试：`tests/ui-themes.test.ts`（路径安全、列表、体积上限）
- 单元测试：`tests/user-ui-theme.test.ts`（style 注入 / 移除、id 归一）
- 手工：设置中选中 `example`，确认侧栏 / 输入区 / 设置页随 token 变色，幻灯片纸面仍为浅色
