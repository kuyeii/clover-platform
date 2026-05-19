# dify-bridge — ProEngine Dify 桥接层（历史目录）

> 当前规范入口已经迁移到项目根目录下的 `dify/manifest.yml + dify/workflows/`。本目录保留为历史桥接层与旧 DSL 归档，不再作为当前 manifest、rewrite 和导入脚本的事实来源。

## 目录结构

```
dify-bridge/
  ├── dify-workflows/   — 旧版 Dify 工作流 I/O 文档 + DSL 导出归档
  └── README.md
```

## 当前口径

- 当前纳管工作流见 `../dify/manifest.yml`。
- 当前 DSL 事实来源见 `../dify/workflows/`。
- 当前模型 rewrite、节点漂移检测、批量校验均以 `../dify/manifest.yml` 为准。

## 历史目录用途

- 回溯旧版 `requirement_extractor`、`blueprint_generator` 等历史 DSL。
- 对照旧脚本或旧开发阶段的工作流设计。
- 不建议继续把这里的 DSL 直接当作现行部署入口。
