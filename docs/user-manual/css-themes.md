# CSS 主题指南

用文件夹里的 CSS 文件，定制 Agent PPT **工作台外观**（侧栏、输入框、聊天区、设置页、窗口壳）。主题文件会被**整份注入**到界面里，不只是换几组颜色。

主题**不会**改变幻灯片 DesignSystem、预览「纸面」颜色，也不会影响 PPTX 导出。

机制说明见 [工作台 UI 主题（架构）](../architecture/ui-themes.md)。

## 5 分钟上手

1. 打开应用 → **设置** → **界面外观**
2. 点 **打开主题根目录**（固定为 `~/.agent-ppt/theme/`，不能自选路径）
3. 编辑自带的 `example/theme.css`，或新建例如 `midnight/theme.css`
4. 回到设置，点 **刷新列表**，选中你的主题

目录长这样：

```text
~/.agent-ppt/theme/
  README.md
  example/
    theme.css
  midnight/
    theme.css
```

规则速览：

| 规则 | 说明 |
|---|---|
| 布局 | 每个主题一个子文件夹，入口文件必须是 `theme.css` |
| 名称 | 子文件夹名即主题 id（可用中文，如 `午夜蓝`） |
| 保留名 | 不要用文件夹名 `studio`（内置 Studio 占用） |
| 大小 | `theme.css` 不超过 256KB |
| 环境变量 | 若设置了 `AGENT_PPT_DATA_DIR`，根目录为 `{该目录}/theme/` |
| 旧布局 | 以前的扁平 `themes/*.css` 已废弃，不会自动迁移 |

## 你能定制什么

引擎**不裁剪选择器**：主题里写的 CSS 会按普通级联覆盖界面。稳定、省事的做法是改变量；需要细调时，再写区域钩子或具体选择器。

| 能力 | 怎么做 | 稳定程度 |
|---|---|---|
| 整体色板 / 明暗表面 | 覆盖 `--surface-*`、`--text-*`、`--border-*` | 高（推荐） |
| 强调色、成功/危险态 | `--accent-*`、`--danger`、`--success`、`--warning` | 高 |
| 圆角、间距、阴影、滚动条 | `--radius-*`、`--space-*`、`--elevation-*`、`--scrollbar-thumb-color` | 高 |
| UI 字体 | `--font-display` / `--font-body` / `--font-mono` | 高（见下方字体限制） |
| 字号阶梯 | `--text-sm`、`--text-base` 等 | 高 |
| 窗口 / 输入区背景图、渐变 | `body` 或 `[data-ui-region="…"]` 上写 `background` | 中 |
| 只改侧栏 / 输入区 / 设置 | `[data-ui-region="sidebar\|composer\|canvas\|settings"]` | 中 |
| 某一个控件的 padding、边框 | 写内部 class（如 `.double-deck-panel-card`） | 低（版本可能改 class） |

### 资源与安全策略（CSP）

写主题时注意浏览器安全策略：

- **图片 / 背景**：`url(...)` 可用 `data:` 或 `https:`（以及应用自身资源）
- **字体**：`font-src` 仅为 `'self'` 与 `data:`。优先改成**系统字体栈**；远程 `@font-face`（如 Google Fonts）通常加载不了，除非做成 `data:` 内嵌
- 主题来自固定根目录 `theme/<名>/theme.css`，单文件有大小上限；不会执行主题里的 JavaScript
- 主题夹里的相对路径图片（如 `url(./bg.png)`）**尚未**支持加载；背景请用 `https:` 或 `data:`

## 稳定写法：改 semantic 变量

界面大量样式读的是这些变量。只改变量，一般就能让窗口背景、侧栏、主输入区、设置页一起变色。

请同时写 **dark** 与 **light**（设置里的「明暗」会切换 `data-color-scheme`）：

```css
:root[data-color-scheme="dark"] {
  --surface-canvas: #0f1419;
  --surface-base: #151b22;
  --surface-raised: #1b222c;
  --surface-sunken: #10151b;
  --surface-overlay: #222a35;
  --surface-hover: rgba(255, 255, 255, 0.06);
  --surface-active: rgba(255, 255, 255, 0.1);

  --text-primary: #f3f6fa;
  --text-secondary: #a8b3c2;
  --text-muted: #7b8796;
  --text-on-accent: #ffffff;

  --border-subtle: rgba(255, 255, 255, 0.06);
  --border-default: rgba(255, 255, 255, 0.1);
  --border-strong: rgba(255, 255, 255, 0.16);
  --border-focused: rgba(255, 255, 255, 0.22);

  --elevation-1: 0 1px 2px rgba(0, 0, 0, 0.45);
  --elevation-2: 0 4px 12px rgba(0, 0, 0, 0.5);
  --elevation-3: 0 16px 40px rgba(0, 0, 0, 0.55);

  --scrollbar-thumb-color: rgba(255, 255, 255, 0.14);
}

:root[data-color-scheme="light"] {
  --surface-canvas: #dde3ea;
  --surface-base: #e7ecf2;
  --surface-raised: #f7f9fc;
  --surface-sunken: #eef2f7;
  --surface-overlay: #ffffff;
  --surface-hover: rgba(0, 0, 0, 0.04);
  --surface-active: rgba(0, 0, 0, 0.07);

  --text-primary: #12161c;
  --text-secondary: #4a5563;
  --text-muted: #6b7280;
  --text-on-accent: #ffffff;

  --border-subtle: rgba(0, 0, 0, 0.06);
  --border-default: rgba(0, 0, 0, 0.1);
  --border-strong: rgba(0, 0, 0, 0.14);
  --border-focused: rgba(0, 0, 0, 0.2);

  --elevation-1: 0 1px 2px rgba(0, 0, 0, 0.06);
  --elevation-2: 0 4px 12px rgba(0, 0, 0, 0.08);
  --elevation-3: 0 16px 40px rgba(0, 0, 0, 0.12);

  --scrollbar-thumb-color: rgba(0, 0, 0, 0.18);
}
```

### 表面层级（很重要）

顺序是 elevation，不是「越来越黑」：

`canvas < base < raised < sunken < overlay`

| 变量 | 通常用在 |
|---|---|
| `--surface-canvas` | 窗口最底层背景 |
| `--surface-base` | 标题栏、侧栏连续壳 |
| `--surface-raised` | 主画布、设置页、输入卡片 |
| `--surface-sunken` | 凹陷输入、代码块 |
| `--surface-overlay` | 浮层卡片、菜单 |

暗色主题里，`--surface-sunken` **不要**比 `--surface-raised` 更暗，否则输入区会像黑洞。

### 常用变量一览

**强调与状态**

| 变量 | 用途 |
|---|---|
| `--accent-primary` / `--accent-primary-glow` | 主强调色与光晕 |
| `--accent-cyan` / `--accent-green` / `--accent-orange` / `--accent-purple` | 设置里的色板别名 |
| `--danger` / `--success` / `--warning`（及对应 `-glow` / `-border`） | 状态色 |
| `--diff-add` / `--diff-remove` | 差异高亮 |

**圆角与间距**

| 变量 | 用途 |
|---|---|
| `--radius-xs` … `--radius-xl`、`--radius-pill` | 基础圆角 |
| `--control-radius-*`、`--field-border-radius`、`--button-border-radius`、`--card-border-radius`、`--panel-border-radius` | 控件圆角（会吃设置里的圆角缩放） |
| `--space-1` … `--space-8` | 间距阶梯（4px 起） |

**字体与字号**

| 变量 | 用途 |
|---|---|
| `--font-display` / `--font-body` / `--font-mono` / `--font-serif` | 字体栈（serif 多用于幻灯片内容） |
| `--text-2xs` … `--text-2xl` 及对应 `--text-*-lh` | 字号与行高 |
| `--font-weight-regular` … `--font-weight-bold` | 400 / 500 / 600 / 700 |

完整定义见仓库内 `src/renderer/src/styles/tokens/semantic.css`、`typography.css`、`fonts.css`。

## 区域钩子

需要「只动一块 UI」时，优先用这些属性，而不是翻内部 class：

| 选择器 | 区域 |
|---|---|
| `[data-ui-region="sidebar"]` | 工作台侧栏、设置导航 |
| `[data-ui-region="composer"]` | 统一输入区（含欢迎标题附近） |
| `[data-ui-region="canvas"]` | 主画布：聊天、文件、设置内容区、预览面板 |
| `[data-ui-region="settings"]` | 设置页主体 |

## 食谱（可复制）

下面片段可以追加到你的主题文件；按需删改。

### 1. 只换色板

见上文「稳定写法」整段即可。自带的 `example/theme.css` 也是这种风格。

### 2. 窗口渐变背景

```css
:root[data-color-scheme="dark"] body {
  background:
    radial-gradient(1200px 600px at 10% -10%, rgba(56, 189, 248, 0.16), transparent 55%),
    radial-gradient(900px 500px at 90% 0%, rgba(168, 85, 247, 0.12), transparent 50%),
    var(--surface-canvas);
}

:root[data-color-scheme="light"] body {
  background:
    radial-gradient(1200px 600px at 10% -10%, rgba(14, 165, 233, 0.12), transparent 55%),
    var(--surface-canvas);
}
```

### 3. 输入区背景图 + 更大圆角

```css
[data-ui-region="composer"] .double-deck-panel-card {
  border-radius: 18px;
  border-color: var(--border-strong);
  box-shadow: var(--elevation-2);
  /* 远程 https 或 data: 均可；本地绝对路径 file: 通常不可用 */
  background-image:
    linear-gradient(180deg, color-mix(in srgb, var(--surface-raised) 88%, transparent), var(--surface-raised)),
    url("https://images.example.com/soft-noise.png");
  background-size: cover;
  background-position: center;
}
```

### 4. 换 UI 字体（系统栈）

```css
:root {
  --font-display: "Segoe UI", "PingFang SC", "Microsoft YaHei UI", system-ui, sans-serif;
  --font-body: "Segoe UI", "PingFang SC", "Microsoft YaHei UI", system-ui, sans-serif;
  --font-mono: "Cascadia Code", "JetBrains Mono", Consolas, monospace;
}
```

### 5. 侧栏更「沉」一点

```css
[data-ui-region="sidebar"] {
  background: color-mix(in srgb, var(--surface-base) 92%, black);
}

[data-ui-region="sidebar"] .workbench-sidebar-action-row:hover,
[data-ui-region="sidebar"] .sidebar-rail-btn:hover {
  background: var(--surface-hover);
}
```

### 6. 聊天主区略抬高对比

```css
[data-ui-region="canvas"] {
  --surface-raised: color-mix(in srgb, var(--surface-raised) 90%, var(--accent-primary) 10%);
}
```

（在区域内重定义变量，只影响该区域子树里继续用 `var(--surface-raised)` 的元素。）

## 与设置里其它外观选项的关系

主题 CSS 与设置面板选项是**叠加**的，不是互斥：

| 设置项 | 作用 |
|---|---|
| 皮肤 / 主题 | 选 Studio 或某个 `theme/<名>/` 主题包 |
| 明暗 | 切换 `data-color-scheme`（主题应提供两套变量） |
| 强调色 | 设置 `data-accent`，影响 `--accent-primary` 等 |
| 控件形状 / 内容圆角 | 影响圆角家族与 `--content-radius-scale` |

若主题里写死了 `--accent-primary`，可能盖过设置里的强调色——这是预期级联结果。想保留设置强调色，就不要在主题里覆盖 `--accent-primary`。

## 不要改什么

- 幻灯片预览「纸面」：故意保持浅色底，方便对照真实导出
- 演示文稿 DesignSystem / SVG 页面内容：走项目里的 design-spec，不是 UI 主题
- 不要用文件夹名 `studio`

## 排错

| 现象 | 排查 |
|---|---|
| 列表里没有新主题 | 是否为 `theme/<名>/theme.css`？点了「刷新列表」？文件夹名是否合法（字母数字/中文、`-`、`_`，无路径分隔符）？ |
| 选了没变化 | 选择器是否挂在正确的 `data-color-scheme` 上？是否被更具体规则盖住？打开开发者工具看 `#user-ui-theme` 是否注入 |
| 选中后回到 Studio | 文件被删、过大（>256KB）、或 id 非法时会回退 |
| 背景图不显示 | 是否用了 `file:` 本地路径？改用 `https:` 或 `data:` |
| 自定义字体无效 | 远程字体常被 CSP 拦截；改用系统字体或 `data:` 内嵌 |
| 只有局部变色 | 那些区域可能仍有硬编码色（尤其部分预览/产物卡片）；先用 token + 区域钩子覆盖外壳 |

## 进阶阅读

- [工作台 UI 主题（架构）](../architecture/ui-themes.md) — 加载链路、IPC、边界
- 仓库 [`src/renderer/src/styles/README.md`](../../src/renderer/src/styles/README.md) — skin × color-scheme 分层与模块约定
