# Stage 12-B: iframe 与 Legacy 前端下线 Spec

## 1. 背景

10-F 后 `apps/web` 主业务路径不依赖 iframe，但 iframe 代码、legacy 前端和 `config/apps.yaml` 中的 iframe 回滚配置仍保留。它们当前是安全回滚手段，不应在未验收前删除。

## 2. 目标

- 在统一前后端主链路稳定后，逐步下线 iframe 回滚链路。
- 删除或冻结不再需要的 legacy 前端启动配置。
- 保留必要的历史源码或迁移对照材料，但不让它们影响默认开发和部署。
- 降低维护成本、构建成本和安全风险。

## 3. 前置条件

进入本阶段前必须满足：

- Stage 10-G 已完成，五模块主链路验收通过。
- Stage 11-A 已解除 `apps/api` 对相关 legacy 前端/后端运行时的必要依赖，或已列明仍需保留的后端源码依赖。
- Stage 11-B 已完成关键文件、任务、Dify 追踪接入，或已明确暂缓项。
- 生产或联调环境已连续稳定运行一个迭代周期。
- 产品、研发、测试确认不再依赖 iframe 回滚。

## 4. 允许做

- 删除 `apps/web/src/modules/iframe` 及 iframe bridge 代码。
- 移除 `config/apps.yaml` 中不再使用的 `iframe_enabled`、`iframe_url_env` 或 legacy frontend dev 配置。
- 移除 legacy 前端默认检查和启动参数。
- 删除已确认无运行依赖的 legacy 前端目录。
- 保留必要的 legacy 后端源码目录，但必须标注为运行依赖或历史归档。
- 更新 README、preflight、dev.py、部署文档。

## 5. 禁止做

- 不删除仍被 `apps/api` import 的 legacy 源码。
- 不删除仍包含必要业务资产、模板、字体、导出资源或 Dify manifest 的目录。
- 不在没有验收记录的情况下删除回滚入口。
- 不同时做大规模业务重构。
- 不改变用户可见业务流程。

## 6. 技术约束

- 删除前必须用 `rg` 审计引用关系。
- `scripts/dev.py`、`scripts/preflight.py` 和 `runtime/ports.json` 写入逻辑必须同步更新。
- `apps/web` 路由必须全部指向原生页面。
- `config/apps.yaml` 应保留模块注册、权限、API prefix、storage namespace、workflow refs 等必要字段。
- 文档必须明确 legacy 剩余目录的性质：运行依赖、历史归档、测试资产或可删除候选。

## 7. 删除候选分级

| 等级 | 含义 | 处理 |
| --- | --- | --- |
| A | 已无引用、无资产、无回滚需求 | 可删除 |
| B | 无默认运行需求，但仍有历史对照价值 | 归档或保留 |
| C | 仍被 `apps/api` 或构建引用 | 禁止删除 |
| D | 包含字体、模板、manifest、示例数据等资产 | 迁移资产后再评估 |

## 8. 验收标准

- `rg "iframe|ModuleFrame|iframeBridge|iframe_url|iframe_enabled" apps config packages scripts` 仅剩必要历史文档引用，或有明确解释。
- 默认启动、preflight、build 均通过。
- 五个业务模块入口仍进入 `apps/web` 原生页面。
- 无 legacy 前端 dev server 被默认启动或默认检查。
- 删除后仍可部署 `apps/web + apps/api`。
- 若保留 legacy 源码，README 中明确保留原因。

## 9. 回退策略

- 删除前必须打标签或保留可恢复分支。
- 每次只删除一个模块的 iframe/legacy 前端链路。
- 如出现生产阻塞，优先恢复该模块 legacy 前端目录和配置，而不是回滚无关模块。

## 10. 完成定义

- iframe 不再是代码和配置层面的可运行路径。
- legacy 前端不再参与默认开发、构建、preflight 或部署。
- legacy 目录只保留明确仍需的运行依赖、历史归档或资产。
