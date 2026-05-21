# PostgreSQL数据库设计与开发规范

> 来源文件：`03_PostgreSQL数据库设计与开发规范.pdf`

PostgreSQL 数据库设计与开发规范

| 项目 | 内容 |
| --- | --- |
| 版本 | v1.1（基于确认版约束） |
| 日期 | 2026-05-18 |
| 适用范围 | Portal、合同审查、标书生成、RAG 问答、企业竞对分析 |
| 关键约束 | PostgreSQL 18；第一阶段保留 iframe；暂用现有认证；数据短期共享；配置多环境化 |

## 0. 已确认约束

| 确认项 | 结论 |
| --- | --- |
| PostgreSQL 版本 | 开发、测试、生产均统一使用 PostgreSQL 18。 |
| 认证体系 | 第一阶段复用现有 Portal 登录与 session 机制，平台稳定后再升级认证体系。 |
| 多租户 | 当前不做复杂多租户，但表结构预留 tenant_id / organization_id 等扩展口子。 |
| 标书生成服务边界 | 短期保留标书生成现有独立逻辑，中期合并为 bid_generator 模块。 |
| 任务队列 | 第一阶段不引入 Celery/RQ，后续按长任务压力再评估。 |
| iframe 策略 | 第一阶段保留 iframe，第二阶段统一后端和数据库，第三阶段逐步去 iframe。 |
| 文件存储 | 暂时使用本地目录或 Docker volume，后续可平滑切换 MinIO。 |
| 权限策略 | 默认普通用户可使用五个模块，管理员可配置某用户不能使用某模块；所有数据短期共享。 |
| 数据隔离 | 暂时不做隔离，但业务表和查询接口预留 user_id、tenant_id、visibility、scope 等口子。 |
| 多环境配置 | 配置体系支持 dev/test/prod 多环境，Dify workflow key 按环境隔离。 |

## 1. 数据库版本与连接方式

所有环境统一使用 PostgreSQL 18。后端统一通过 SQLAlchemy 2.x + psycopg + Alembic 访问数据库，不允许业务模块自行维护裸连接池。

```
DATABASE_URL=postgresql+psycopg://clover:********@postgres:5432/clover_platform
```

| 确认项 | 结论 |
| --- | --- |
| 项 | 规范 |
| 数据库名 | clover_platform |
| 版本 | PostgreSQL 18 |
| 连接驱动 | psycopg 3 |
| ORM | SQLAlchemy 2.x |
| 迁移工具 | Alembic |
| 时区 | 所有时间字段使用 timestamptz，应用层统一按 Asia/Tokyo 展示。 |

## 2. Schema 设计

| schema | 用途 |
| --- | --- |
| core | 用户、session、权限、应用注册、文件、任务、审计、配置。 |
| contract_review | 合同审查业务数据。 |
| bid_generator | 标书生成业务数据。 |
| rag | RAG 会话与知识库相关数据。 |
| competitor_analysis | 竞对分析历史、画像和缓存数据。 |

```
CREATE SCHEMA IF NOT EXISTS core;
CREATE SCHEMA IF NOT EXISTS contract_review;
CREATE SCHEMA IF NOT EXISTS bid_generator;
CREATE SCHEMA IF NOT EXISTS rag;
CREATE SCHEMA IF NOT EXISTS competitor_analysis;
```

## 3. 命名规范

| 对象 | 规则 | 示例 |
| --- | --- | --- |
| 表名 | 小写蛇形命名，业务 schema 内不重复带模块前缀。 | contract_review.review_runs |
| 主键 | 统一 id，类型优先 UUID。 | id UUID PRIMARY KEY |
| 外键 | xxx_id。 | owner_user_id |
| 时间字段 | created_at、updated_at、deleted_at。 | created_at timestamptz |
| 布尔字段 | is_ / has_ / enable_ 开头。 | is_active |
| JSON 字段 | 使用 jsonb，不使用 json。 | payload jsonb |

## 4. 通用字段规范

id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NULL, organization_id UUID NULL, owner_user_id UUID NULL, created_by UUID NULL, updated_by UUID NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz NULL, visibility text NOT NULL DEFAULT 'shared', metadata jsonb NOT NULL DEFAULT '{}'::jsonb

## 5. JSONB 使用规范

- 开发阶段允许将 Dify 原始输出、文档解析结果、任务上下文放入 JSONB，降低早期建模成本。
- 需要列表筛选、排序、权限判断、统计的字段应拆成独立列。
- JSONB 字段必须有结构说明，不允许长期成为不可控垃圾桶。
- 常用 JSONB 查询字段需要加 GIN 或表达式索引。
## 6. 迁移规范

- 所有 DDL 变更必须通过 Alembic migration 提交。
- 一个 migration 只做一类变更，禁止混合大量无关表结构修改。
- 开发阶段可 reset 数据库，但 migration 文件仍要保持从空库可完整初始化。
- 禁止业务启动时自动 create_all 替代 migration。
