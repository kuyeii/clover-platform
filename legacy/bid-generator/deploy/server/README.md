# ProEngine 服务器部署

当前 `clover-platform` 第 5-D 阶段已经将 pipt-lite 运行数据迁移到 PostgreSQL `bid_generator` schema。此目录下旧的单模块 Docker Compose / 后端镜像配置已不再匹配当前 monorepo PostgreSQL 启动方式，因此不再作为可运行部署入口维护。

当前开发启动方式仍以仓库根目录统一脚本为准：

```bash
python scripts/init_db.py
alembic upgrade head
python scripts/dev.py --only bid-generator
```

统一 Docker 部署会在后续部署阶段单独设计。不要从本目录恢复旧的本地数据库卷或旧映射库配置；PDF / DOCX / 图片 / raw_doc / kb_sync_status 等文件缓存仍按业务代码保留在文件系统。
