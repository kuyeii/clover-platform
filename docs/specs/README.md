# Specs

本目录记录 10-F 之后的阶段 spec，用于把剩余工作拆成可执行、可验收、可回退的阶段。

这些 spec 基于当前状态：

- `apps/web` 是默认统一前端主入口。
- `apps/api` 是默认统一后端主入口。
- legacy 前端、legacy 后端和 iframe 配置保留为回滚入口。
- 部分业务能力仍复用 legacy 源码、本地文件目录、模块内任务状态和模块内 Dify 调用。

## 阶段顺序

| 阶段 | 文件 | 优先级 | 核心目标 |
| --- | --- | --- | --- |
| 10-G | [stage-10-g-unified-acceptance-and-release-readiness.md](./stage-10-g-unified-acceptance-and-release-readiness.md) | P0 | 对当前统一前后端主链路做总体验收和发布准备。 |
| 11-A | [stage-11-a-legacy-runtime-decoupling.md](./stage-11-a-legacy-runtime-decoupling.md) | P1 | 逐步移除 `apps/api` 对 legacy 运行时代码的硬依赖。 |
| 11-B | [stage-11-b-platform-common-capabilities.md](./stage-11-b-platform-common-capabilities.md) | P1 | 补齐统一 Dify、文件、任务、workflow 运行记录等公共能力。 |
| 11-C | [stage-11-c-bid-generator-native-convergence.md](./stage-11-c-bid-generator-native-convergence.md) | P1 | 按 RAG/竞对模式推进标书生成原生化，PIPT 归入统一后端能力。 |
| 12-A | [stage-12-a-frontend-shared-packages.md](./stage-12-a-frontend-shared-packages.md) | P2 | 将稳定的前端 API client、UI、共享类型沉淀到 packages。 |
| 12-B | [stage-12-b-iframe-and-legacy-retirement.md](./stage-12-b-iframe-and-legacy-retirement.md) | P2 | 在验收充分后下线 iframe 和 legacy 前端回滚配置。 |

## 通用规则

- 每个阶段必须先定位问题原因，再列行动计划，再实施。
- 每个阶段都必须保持主链路可运行：`apps/web + apps/api + PostgreSQL`。
- 不允许在没有回滚路径和验收记录的情况下删除 legacy 目录。
- 不允许提交真实密钥、生产密码、运行时端口文件、构建产物、缓存目录或本地数据库。
- 涉及 UI 的改动必须遵守现有 Figma/设计系统原则，优先保持当前视觉语言和交互，不引入无关重设计。
- 阶段 spec 是约束，不是一次性大重构许可。未被当前阶段列入“允许做”的事项，默认不做。

## 建议执行方式

每个阶段开始前应产出简短执行计划，至少包含：

- 本阶段要解决的问题和原因。
- 涉及的目录、接口、数据表和配置。
- 风险点和回退策略。
- 自动验收命令和手工验收清单。

每个阶段完成后应更新对应 spec 或新增阶段记录，写明：

- 实际改动范围。
- 未完成项和原因。
- 已运行的验收命令。
- 需要人工确认的事项。
