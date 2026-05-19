# UI Style Guide

## 视觉定位
- 企业级 AI 工具箱
- 简洁、专业、稳定
- 白色与浅灰为主
- 低饱和科技感
- 模块卡片清晰隔离
- 首页采用“单标题 + 居中导航条 + 四叶草主视觉”
- 中心 hub 作为平台主视觉 logo
- 不再使用左侧 sidebar 和完整 topbar

## Tailwind 使用约束
- 只使用预设 Tailwind utility classes。
- 优先使用标准 spacing、radius、shadow、color scale。
- 允许使用标准渐变 utility，如 `bg-gradient-to-br`、`from-slate-50`、`to-slate-100`。

## 禁止 arbitrary values
- 禁止 `text-[14px]`
- 禁止 `w-[320px]`
- 禁止 `rounded-[18px]`
- 禁止 `shadow-[...]`
- 禁止 `bg-[linear-gradient(...)]`

## 禁止静态 inline style
- 禁止固定布局和视觉值写入 `style={{ ... }}`。
- 只有业务动态值才允许 inline style。
- 当前门户原则上不使用 inline style。

## 状态标签规范
- `incubating`：蓝色系
- `available`：绿色系
- `maintenance`：琥珀色系
- `offline`：灰色系
- `deprecated`：红色系

## 卡片规范
- 使用统一 `AppCard` 展示模块信息。
- 首页卡片只包含图标、名称、一行描述、状态和入口按钮。
- 卡片使用标准圆角、边框和阴影，不做复杂装饰。
- 首页卡片不展示仓库名、健康详情、URL 和技术字段。

## 响应式布局规范
- 首页桌面端使用 2 列四象限布局，中心 hub 作为聚合视觉中心。
- 平板和手机端自动回落为单列或紧凑双列。
- 导航为标题下方的居中浮层，不使用顶部完整品牌栏。
- 所有文本和按钮必须避免重叠、溢出和横向滚动。
