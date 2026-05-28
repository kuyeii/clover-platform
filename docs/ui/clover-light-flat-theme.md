# Clover Light Flat Theme UI 色彩规范

> 适用范围：Clover Platform 前端后台界面，尤其是知识库、工作台、应用管理、用户管理等企业级管理页面。  
> 目标：保留品牌主题色 `#0284c7`，但整体视觉保持低饱和、扁平化、白底、浅灰蓝边界，避免高饱和 SaaS 蓝和鲜艳状态色。

---

## 1. 总体设计原则

### 1.1 主题色不变

系统唯一主题色为：

```css
#0284c7
```

该色是 Clover Platform 的品牌主色，不能替换成灰蓝色、靛蓝色或其他蓝色。

### 1.2 控制主题色面积

`#0284c7` 只用于关键位置：

- 主按钮
- 当前导航选中态
- 链接文字
- 关键操作入口
- 输入框 focus 状态
- 少量关键数字或图标

不要将主题色大面积用于：

- 页面背景
- 卡片背景
- 表头背景
- 侧边栏大色块
- 大面积统计卡背景
- 大面积渐变

### 1.3 页面主观感受

页面第一眼应该是：

```text
白色 + 浅灰 + 浅灰蓝 + 少量 #0284c7
```

而不是：

```text
大面积蓝色 + 强烈状态色 + 高饱和按钮 + 重阴影
```

### 1.4 推荐用色比例

```text
85% 中性色
10% 品牌蓝
5% 低饱和语义色
```

---

## 2. 核心色板

## 2.1 Brand / 品牌色

| Token | 色值 | 用途 |
|---|---:|---|
| `--color-brand` | `#0284c7` | 唯一主题色、主按钮、选中态 |
| `--color-brand-hover` | `#0274ad` | 主按钮 hover |
| `--color-brand-active` | `#026699` | 主按钮 active |
| `--color-brand-soft` | `#eef8fc` | 导航选中背景、浅高亮底色 |
| `--color-brand-soft-hover` | `#e2f2f9` | 浅色按钮 hover |
| `--color-brand-border` | `#c7e6f4` | 浅品牌边框、focus 边界 |

使用约束：

- `--color-brand` 是唯一主色。
- 页面中不要引入其他高饱和蓝色作为主色。
- 浅色选中态优先使用 `--color-brand-soft`，不要使用实心深蓝色块。

---

## 2.2 Neutral / 中性色

| Token | 色值 | 用途 |
|---|---:|---|
| `--color-page-bg` | `#f7f9fc` | 页面背景 |
| `--color-sidebar-bg` | `#ffffff` | 侧边栏背景 |
| `--color-surface` | `#ffffff` | 卡片、表格、弹窗背景 |
| `--color-surface-soft` | `#fbfcfe` | 表头、浅层容器背景 |
| `--color-border` | `#e4eaf0` | 默认边框 |
| `--color-border-strong` | `#d6e0e8` | 输入框、卡片强化边框 |
| `--color-divider` | `#edf1f5` | 分割线、表格行线 |

使用约束：

- 页面主体以白色和浅灰蓝为主。
- 组件边界优先通过细边框表达，而不是阴影或背景色块。
- 表头背景不要使用蓝色，使用 `--color-surface-soft`。

---

## 2.3 Text / 文字色

| Token | 色值 | 用途 |
|---|---:|---|
| `--color-text-primary` | `#243447` | 一级标题、重要正文 |
| `--color-text-regular` | `#3d4f63` | 表格正文、普通内容 |
| `--color-text-secondary` | `#63778b` | 描述文字、二级导航 |
| `--color-text-muted` | `#8a9aab` | 占位符、弱说明 |
| `--color-text-disabled` | `#b6c1cc` | 禁用文字 |
| `--color-text-inverse` | `#ffffff` | 主按钮文字 |

使用约束：

- 一级标题不要用纯黑。
- 普通文字不要用高饱和蓝。
- 弱说明、占位符、辅助信息统一使用灰蓝色。

---

## 2.4 Semantic / 语义色

语义色必须低饱和，不使用鲜艳红、绿、橙。

### Success / 成功、可检索

| Token | 色值 | 用途 |
|---|---:|---|
| `--color-success-bg` | `#eef8f4` | 成功标签背景 |
| `--color-success-border` | `#cfe9dd` | 成功标签边框 |
| `--color-success-text` | `#3d7b68` | 成功文字 |
| `--color-success-icon` | `#5e9f8a` | 成功图标 |

### Info / 信息、处理中

| Token | 色值 | 用途 |
|---|---:|---|
| `--color-info-bg` | `#eef7fc` | 信息标签背景 |
| `--color-info-border` | `#cce7f5` | 信息标签边框 |
| `--color-info-text` | `#0274ad` | 信息文字 |
| `--color-info-icon` | `#0284c7` | 信息图标 |

### Danger / 异常、失败

| Token | 色值 | 用途 |
|---|---:|---|
| `--color-danger-bg` | `#fbf0f1` | 异常标签背景 |
| `--color-danger-border` | `#efd1d5` | 异常标签边框 |
| `--color-danger-text` | `#a35f68` | 异常文字 |
| `--color-danger-icon` | `#bf717b` | 异常图标 |

### Warning / 警告，少用

| Token | 色值 | 用途 |
|---|---:|---|
| `--color-warning-bg` | `#fff8ea` | 警告背景 |
| `--color-warning-border` | `#f1dfb8` | 警告边框 |
| `--color-warning-text` | `#8b6d35` | 警告文字 |

使用约束：

- 知识库页面一般只需要 `成功 / 处理中 / 异常` 三种状态。
- 警告色慎用，避免页面变花。
- 状态标签使用浅底色 + 低饱和文字，不使用实心高饱和色块。

---

## 3. CSS Variables

建议在全局样式中集中定义：

```css
:root {
  /* Brand */
  --color-brand: #0284c7;
  --color-brand-hover: #0274ad;
  --color-brand-active: #026699;
  --color-brand-soft: #eef8fc;
  --color-brand-soft-hover: #e2f2f9;
  --color-brand-border: #c7e6f4;

  /* Surface */
  --color-page-bg: #f7f9fc;
  --color-sidebar-bg: #ffffff;
  --color-surface: #ffffff;
  --color-surface-soft: #fbfcfe;

  /* Border */
  --color-border: #e4eaf0;
  --color-border-strong: #d6e0e8;
  --color-divider: #edf1f5;

  /* Text */
  --color-text-primary: #243447;
  --color-text-regular: #3d4f63;
  --color-text-secondary: #63778b;
  --color-text-muted: #8a9aab;
  --color-text-disabled: #b6c1cc;
  --color-text-inverse: #ffffff;

  /* Success */
  --color-success-bg: #eef8f4;
  --color-success-border: #cfe9dd;
  --color-success-text: #3d7b68;
  --color-success-icon: #5e9f8a;

  /* Info */
  --color-info-bg: #eef7fc;
  --color-info-border: #cce7f5;
  --color-info-text: #0274ad;
  --color-info-icon: #0284c7;

  /* Danger */
  --color-danger-bg: #fbf0f1;
  --color-danger-border: #efd1d5;
  --color-danger-text: #a35f68;
  --color-danger-icon: #bf717b;

  /* Warning */
  --color-warning-bg: #fff8ea;
  --color-warning-border: #f1dfb8;
  --color-warning-text: #8b6d35;

  /* Interaction */
  --color-hover-bg: #f7f9fc;
  --color-focus-ring: rgba(2, 132, 199, 0.12);
}
```

---

## 4. 组件用色规范

## 4.1 页面背景

```css
body,
.app-page {
  background: var(--color-page-bg);
  color: var(--color-text-regular);
}
```

约束：

- 页面背景使用浅灰蓝，不使用纯白铺满整个页面。
- 卡片和表格使用白色，从背景中轻微浮出。

---

## 4.2 左侧导航

### 默认状态

```css
.nav-item {
  background: transparent;
  color: var(--color-text-secondary);
}

.nav-item .icon {
  color: #7f91a5;
}
```

### Hover 状态

```css
.nav-item:hover {
  background: #f3f7fa;
  color: var(--color-text-regular);
}
```

### 选中状态

```css
.nav-item.active {
  background: var(--color-brand-soft);
  color: var(--color-brand);
}

.nav-item.active .icon {
  color: var(--color-brand);
}
```

约束：

- 选中态使用浅蓝底，不使用深蓝色块。
- 侧边栏背景保持白色。
- 非选中图标统一使用灰蓝色。
- 不使用渐变导航背景。

---

## 4.3 页面标题区

```css
.page-title {
  color: var(--color-text-primary);
  font-weight: 700;
}

.page-description {
  color: var(--color-text-secondary);
}
```

约束：

- 页面标题不使用品牌蓝。
- 描述文字保持灰蓝，避免喧宾夺主。

---

## 4.4 主按钮

例如：上传资料。

```css
.button-primary {
  background: var(--color-brand);
  border: 1px solid var(--color-brand);
  color: var(--color-text-inverse);
  box-shadow: none;
}

.button-primary:hover {
  background: var(--color-brand-hover);
  border-color: var(--color-brand-hover);
}

.button-primary:active {
  background: var(--color-brand-active);
  border-color: var(--color-brand-active);
}

.button-primary:focus-visible {
  box-shadow: 0 0 0 3px var(--color-focus-ring);
}
```

约束：

- 一个页面首屏尽量只保留一个主按钮。
- 主按钮不使用渐变。
- 主按钮不使用明显投影。
- 不要使用 `#2563eb`、`#3b82f6` 等替代主题蓝。

---

## 4.5 次级按钮

例如：刷新。

```css
.button-secondary {
  background: var(--color-surface);
  border: 1px solid var(--color-border-strong);
  color: var(--color-text-regular);
  box-shadow: none;
}

.button-secondary:hover {
  background: var(--color-hover-bg);
  border-color: #cbd8e3;
}
```

约束：

- 次级按钮不使用蓝色背景。
- 图标使用灰蓝。
- hover 只做轻微灰底变化。

---

## 4.6 卡片

```css
.card {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 12px;
  box-shadow: none;
}

.card-title {
  color: var(--color-text-primary);
  font-weight: 600;
}
```

约束：

- 主页面卡片默认无阴影。
- 卡片不要使用彩色背景。
- 卡片层级靠边框、留白、背景色差区分。

---

## 4.7 知识库概览 / 统计区

```css
.metric-label {
  color: var(--color-text-secondary);
}

.metric-value {
  color: var(--color-text-primary);
}

.metric-value.brand {
  color: var(--color-brand);
}

.metric-value.success {
  color: var(--color-success-text);
}

.metric-value.danger {
  color: var(--color-danger-text);
}

.metric-divider {
  background: var(--color-divider);
}
```

约束：

- 不要每个数字都使用高饱和颜色。
- 常规数字使用正文深色。
- 仅异常、处理中、关键指标可使用语义色或品牌色。
- 图标使用线性图标，不使用实心大色块。

---

## 4.8 搜索框 / 筛选框 / 输入框

```css
.input,
.select {
  background: var(--color-surface);
  border: 1px solid var(--color-border-strong);
  color: var(--color-text-regular);
}

.input::placeholder {
  color: var(--color-text-muted);
}

.input:focus,
.select:focus {
  border-color: var(--color-brand);
  box-shadow: 0 0 0 3px var(--color-focus-ring);
  outline: none;
}
```

约束：

- 默认状态不要有蓝色边框。
- focus 状态可以使用主题蓝。
- 搜索图标使用 `--color-text-muted`。

---

## 4.9 表格

```css
.table {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 10px;
  overflow: hidden;
}

.table thead {
  background: var(--color-surface-soft);
  color: var(--color-text-secondary);
}

.table th,
.table td {
  border-bottom: 1px solid var(--color-divider);
}

.table tbody tr:hover {
  background: #f8fafc;
}
```

约束：

- 表头不使用蓝色背景。
- 表格不使用强斑马纹。
- 表格操作区优先使用更多菜单或文字按钮，不使用大面积彩色按钮。
- 行 hover 只使用很浅的灰底。

---

## 4.10 文件类型图标

默认文件图标：

```css
.file-icon {
  background: #f3f6f9;
  border: 1px solid #dfe7ee;
  color: var(--color-text-secondary);
}
```

PDF：

```css
.file-icon.pdf {
  background: #fbf0f1;
  color: var(--color-danger-text);
}
```

Word：

```css
.file-icon.word {
  background: var(--color-info-bg);
  color: var(--color-info-text);
}
```

Excel：

```css
.file-icon.excel {
  background: var(--color-success-bg);
  color: var(--color-success-text);
}
```

约束：

- 文件图标可以区分类型，但颜色必须低饱和。
- 图标面积要小，不要抢主按钮视觉。
- 不使用鲜艳 PDF 红、Word 蓝、Excel 绿。

---

## 4.11 状态标签

### 可检索

```css
.badge.success {
  background: var(--color-success-bg);
  border: 1px solid var(--color-success-border);
  color: var(--color-success-text);
}
```

### 处理中

```css
.badge.info {
  background: var(--color-info-bg);
  border: 1px solid var(--color-info-border);
  color: var(--color-info-text);
}
```

### 异常

```css
.badge.danger {
  background: var(--color-danger-bg);
  border: 1px solid var(--color-danger-border);
  color: var(--color-danger-text);
}
```

### 未启用 / 草稿

```css
.badge.muted {
  background: #f3f6f9;
  border: 1px solid #dfe7ee;
  color: var(--color-text-secondary);
}
```

通用标签样式：

```css
.badge {
  display: inline-flex;
  align-items: center;
  height: 24px;
  padding: 0 8px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 500;
  line-height: 1;
}
```

约束：

- 标签不使用实心高饱和背景。
- 标签只用于状态，不用于普通说明文字。
- 标签圆角建议 6px。

---

## 4.12 分页

```css
.pagination-item {
  background: var(--color-surface);
  border: 1px solid var(--color-border-strong);
  color: var(--color-text-secondary);
}

.pagination-item:hover {
  background: var(--color-hover-bg);
}

.pagination-item.active {
  background: var(--color-brand-soft);
  border-color: var(--color-brand);
  color: var(--color-brand);
}
```

约束：

- 当前页不要使用深蓝实心块。
- 分页保持轻量边框型。

---

## 4.13 空状态

```css
.empty-state {
  background: var(--color-surface);
  border: 1px dashed var(--color-border-strong);
  color: var(--color-text-secondary);
  border-radius: 12px;
}

.empty-state-icon {
  color: #c8d3de;
}

.empty-state-title {
  color: var(--color-text-primary);
}

.empty-state-description {
  color: var(--color-text-secondary);
}

.empty-state .button {
  background: var(--color-surface);
  border: 1px solid var(--color-border-strong);
  color: var(--color-brand);
}
```

约束：

- 空状态不要大面积蓝色。
- 图标不要使用彩色插画。
- 边框使用浅灰蓝虚线。
- 空状态按钮可使用次级按钮样式，不一定使用主按钮。

---

## 5. 阴影与扁平化规范

主页面默认不使用阴影：

```css
box-shadow: none;
```

如果下拉菜单、弹窗、浮层必须使用阴影，只允许极弱阴影：

```css
box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
```

禁止使用明显投影：

```css
box-shadow: 0 8px 24px rgba(...);
box-shadow: 0 12px 32px rgba(...);
box-shadow: 0 16px 40px rgba(...);
```

---

## 6. 页面结构建议：知识库页面

推荐页面结构：

```text
左侧导航
└── Logo / 平台名
└── 知识库
└── 工作台
└── 应用
└── 使用分析
└── 设置
└── 帮助与反馈

主内容区
└── 页面标题区
    ├── 知识库
    ├── 说明文字
    ├── 刷新
    └── 上传资料

└── 知识库概览
    ├── 资料总数
    ├── 可检索
    ├── 处理中
    ├── 异常
    └── 最近更新

└── 资料管理
    ├── 搜索资料名称
    ├── 状态筛选
    └── 资料表格

└── 空状态，仅在无资料时显示
```

页面约束：

- 用户界面不展示 Dify Dataset、环境变量、Server misconfiguration 等配置内容。
- 配置类问题只能在后台日志、管理员设置或系统监控中展示。
- 面向用户的知识库页面只表达资料管理、状态、搜索、上传、操作。

---

## 7. 禁止使用清单

### 7.1 禁止使用的高饱和蓝

```css
#2563eb
#3b82f6
#4070d0
#1d4ed8
#1e40af
```

### 7.2 禁止大面积使用的深蓝

```css
#0c4a6e
#075985
#082f49
```

这些颜色可以偶尔用于深色模式或极小面积图形，但不要用于当前浅色后台主题。

### 7.3 禁止使用的高饱和语义色

```css
#22c55e
#16a34a
#f59e0b
#ef4444
#dc2626
```

状态色必须使用本规范中的低饱和语义色。

### 7.4 禁止的视觉风格

不要使用：

- 大面积蓝色背景
- 明显渐变按钮
- 强投影卡片
- 彩色插画式空状态
- 多种高饱和状态色并列
- 表头蓝底白字
- 深蓝导航选中块

---

## 8. 前端验收规则

实现后按以下规则检查：

1. 主题色是否仍为 `#0284c7`。
2. 页面是否以白色、浅灰、浅灰蓝为主体。
3. `#0284c7` 是否只用于主按钮、选中态、链接、focus 等关键位置。
4. 左侧导航选中态是否为浅蓝底 + 主题蓝文字，而不是深蓝色块。
5. 卡片是否只有细边框，无明显阴影。
6. 表头是否为浅灰白背景，而不是蓝色背景。
7. 状态标签是否为浅底低饱和色，而不是鲜艳红绿蓝。
8. 文件类型图标是否低饱和，不抢主按钮视觉。
9. 空状态是否简洁、浅色、无彩色插画。
10. 页面是否没有展示 Dify Dataset、环境变量、服务配置等技术信息。

---

## 9. 给 Codex 的执行说明

请按照本规范调整前端 UI 颜色与组件样式：

1. 保留品牌主题色 `#0284c7`，不要替换为其他蓝色。
2. 将全局颜色整理为本文件中的 CSS Variables。
3. 将页面背景、卡片、表格、侧边栏调整为白色和浅灰蓝体系。
4. 将主按钮、导航选中态、链接、focus 状态统一使用 `--color-brand`。
5. 将状态标签、文件类型图标改为低饱和浅底样式。
6. 去掉主页面明显阴影，改用细边框和留白表达层级。
7. 避免引入高饱和蓝、绿、红、橙。
8. 知识库页面不展示任何配置项、环境变量、Dataset ID、Server misconfiguration 等面向开发者的信息。

最终视觉目标：

```text
Clover Light Flat Theme
低饱和 / 浅灰蓝 / 白底 / 扁平化 / 轻边框 / 少量品牌蓝 / 克制状态色
```

一句话原则：

> `#0284c7` 是品牌主色，但不是页面底色；页面以白色和浅灰蓝为主体，品牌蓝只负责引导用户点击和识别当前状态。
