# Stage 11-A: Legacy 运行时依赖解耦 Spec

## 1. 背景

当前 `apps/api` 虽然是主业务后端，但仍复用部分 legacy 源码。合同审查依赖 `legacy/contract_review/src`，标书生成依赖 `legacy/bid-generator/pipt-flask/app/api_lite`、`gateway-out` 和 `dify-bridge`。这些依赖使 legacy 目录仍是运行时的一部分，影响部署、测试、包边界和后续删除。

## 2. 目标

- 将仍被 `apps/api` 直接 import 的 legacy 运行时代码逐步迁出到明确的模块或公共包。
- 优先解耦合同审查和标书生成，因为它们对 legacy 源码依赖最重。
- 保持外部 API、文件产物和用户流程不退化。
- 为后续删除 legacy 前端、legacy 后端和 legacy 源码依赖创造条件。

## 3. 优先顺序

1. 合同审查：Dify client、DOCX locator、review store、文件 artifact 读写。
2. 标书生成：`api_lite` router、TaskManager、DocumentForge、gateway-out、dify-bridge。
3. RAG：确认 legacy backend 仅作为配置兼容来源，逐步迁配置读取。
4. 竞对分析：确认 legacy 项目仅作为配置兼容来源，逐步迁配置读取。

## 4. 允许做

- 在 `modules/<module>` 或 `packages/py_common` 中创建清晰的 service/repository/storage/dify 代码。
- 以小步迁移方式替换 `sys.path`、动态 import 和 legacy 包路径扩展。
- 增加 adapter 层，保证旧 API 响应兼容。
- 增加回归测试覆盖迁移前后的行为一致性。
- 保留必要的 legacy fallback，但必须默认不走 fallback。
- 补充模块 README，说明哪些 legacy 依赖已解除，哪些仍保留。

## 5. 禁止做

- 不改变业务 API URL、请求体、响应结构，除非单独做兼容说明和迁移窗口。
- 不改变 Dify workflow 输入输出语义。
- 不重写合同审查算法、标书生成算法或文档生成核心逻辑。
- 不删除 legacy 目录，除非依赖审计和回滚验收已完成。
- 不把复杂业务直接塞进 `apps/api/app/api` router。
- 不引入新微服务。

## 6. 技术约束

- 新代码必须有明确模块边界：router 只做协议适配，service 处理业务编排，repository 处理数据访问。
- 跨模块调用不得直接 import 对方业务 service；公共能力进入 `packages/py_common` 或 `core`。
- 迁移过程中必须保持 `apps/api` 可单独启动。
- 迁移后的代码不得依赖工作目录隐式路径，应通过配置或 repo root 解析。
- 文件路径必须可配置，并为后续 `py_common.storage` 接管预留接口。

## 7. 交付物

- legacy import 审计清单。
- 每个模块的迁移 PR 或阶段记录。
- 新模块代码、adapter、测试和 README 更新。
- 删除 legacy 依赖前置条件清单。

## 8. 验收标准

- `rg "legacy/|sys.path|api_lite|gateway-out|dify-bridge" apps/api packages modules` 的结果显著减少，并且剩余项都有文档解释。
- 默认 `python scripts/dev.py` 仍只启动 `apps/web + apps/api`。
- 合同审查上传、审查、AI 改写、下载回归通过。
- 标书生成项目、上传解析、SSE、导出、预览、knowledge/kb 回归通过。
- 迁移后的 service 有最小测试覆盖。
- legacy fallback 路径仍可显式启动验证。

## 9. 风险与回退

- DOCX 定位、导出和标书组装属于高风险路径，每次只迁一类能力。
- 若迁移后出现兼容问题，优先回退 adapter 指向 legacy 实现，而不是回滚整个阶段。
- 回退期间必须保持接口鉴权和敏感头过滤。

## 10. 完成定义

- `apps/api` 主路径不再需要合同审查和标书生成 legacy 源码作为运行时 import 依赖。
- legacy 目录保留仅用于回滚、对照、历史资产或尚未迁移的明确清单。
- 可以进入公共 Dify、storage、jobs 平台化阶段。
