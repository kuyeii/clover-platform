# -*- coding: utf-8 -*-
"""
pipt-lite 数据库模块
提供占位符映射关系的物理持久化存储
"""

import hashlib
import json
import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Any
from pathlib import Path
from urllib.parse import quote_plus

from dotenv import load_dotenv
from sqlalchemy import Column, DateTime, Index, Integer, String, Text, create_engine, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import declarative_base, sessionmaker

_log = logging.getLogger(__name__)
_PKG_ROOT = Path(__file__).resolve().parents[2]
SCHEMA_NAME = "bid_generator"


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _find_repo_root(start: Path | None = None) -> Path:
    current = (start or _PKG_ROOT).resolve()
    for candidate in (current, *current.parents):
        if (
            (candidate / "config" / "apps.yaml").is_file()
            and (candidate / "packages" / "py_common").is_dir()
            and (candidate / "legacy" / "bid-generator").is_dir()
        ):
            return candidate
    raise RuntimeError(f"Cannot locate clover-platform root from {current}")


def _load_env_files() -> None:
    repo_root = _find_repo_root()
    load_dotenv(repo_root / ".env", override=False)
    load_dotenv(_PKG_ROOT / ".env", override=False)


def _build_database_url() -> str:
    _load_env_files()
    database_url = os.getenv("DATABASE_URL", "").strip()
    if database_url:
        return database_url

    required = {
        "POSTGRES_HOST": os.getenv("POSTGRES_HOST"),
        "POSTGRES_DB": os.getenv("POSTGRES_DB"),
        "POSTGRES_USER": os.getenv("POSTGRES_USER"),
        "POSTGRES_PASSWORD": os.getenv("POSTGRES_PASSWORD"),
    }
    missing = [key for key, value in required.items() if not value]
    if missing:
        raise RuntimeError(
            "PostgreSQL connection settings are incomplete. "
            "Set DATABASE_URL or POSTGRES_HOST, POSTGRES_PORT, POSTGRES_DB, POSTGRES_USER, and POSTGRES_PASSWORD. "
            f"Missing: {', '.join(missing)}"
        )

    user = quote_plus(required["POSTGRES_USER"] or "")
    password = quote_plus(required["POSTGRES_PASSWORD"] or "")
    host = required["POSTGRES_HOST"]
    port = int(os.getenv("POSTGRES_PORT", "5432"))
    database = quote_plus(required["POSTGRES_DB"] or "")
    return f"postgresql+psycopg://{user}:{password}@{host}:{port}/{database}"


DATABASE_URL = _build_database_url()

engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,
    pool_size=5,
    max_overflow=5,
    echo=False,
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


# ── Fernet 字段加密工具 ─────────────────────────────────────────────────────

class FernetEncryptor:
    """
    基于 cryptography.Fernet 的字段级 AES-128-CBC 加密工具。
    密钥从环境变量 PIPT_DB_KEY 读取（Base64-urlsafe 32 字节）。
    若未配置密钥则降级为明文存储（开发模式）。
    生成密钥：python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
    """
    _instance = None

    def __init__(self):
        from cryptography.fernet import Fernet
        raw_key = os.environ.get("PIPT_DB_KEY", "")
        env = os.environ.get("PIPT_ENV", "").strip().lower()
        if env in {"prod", "production"} and not raw_key:
            raise RuntimeError("生产环境必须配置 PIPT_DB_KEY，禁止明文落库")
        if raw_key:
            self._fernet = Fernet(raw_key.encode() if isinstance(raw_key, str) else raw_key)
        else:
            import logging
            logging.getLogger(__name__).warning(
                "PIPT_DB_KEY 未配置，original_text 将以明文存储（仅用于开发环境）"
            )
            self._fernet = None

    @classmethod
    def get(cls) -> "FernetEncryptor":
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    def encrypt(self, text: str) -> str:
        """加密明文，返回 Base64 字符串"""
        if self._fernet is None:
            return text
        return self._fernet.encrypt(text.encode("utf-8")).decode("ascii")

    def decrypt(self, token: str) -> str:
        """解密 Base64 字符串，返回明文"""
        if self._fernet is None:
            return token
        try:
            return self._fernet.decrypt(token.encode("ascii")).decode("utf-8")
        except Exception:
            return token  # 降级返回原值（兼容旧明文数据）


def make_entity_key(original_text: str, entity_type: str) -> str:
    """生成实体唯一查询键（SHA256，不含原文）"""
    raw = f"{original_text}|{entity_type}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


# ── 数据模型 ──────────────────────────────────────────────────────────────────

class MappingRecord(Base):
    """
    占位符映射记录表（session 级别，保留用于历史兼容）
    通过 session_id 隔离不同的请求或工作流上下文。
    新代码应优先使用 EntityRegistry。
    """
    __tablename__ = "mapping_records"
    __table_args__ = (
        Index("idx_bid_mapping_records_session_id", "session_id"),
        Index("idx_bid_mapping_records_placeholder", "placeholder"),
        {"schema": SCHEMA_NAME},
    )

    id = Column(String, primary_key=True, default=lambda: uuid.uuid4().hex)
    session_id = Column(String, nullable=False, doc="工作流或会话的唯一标识")
    placeholder = Column(String, nullable=False, doc="占位符，如 {{__PIPT_name_1__}}")
    original_text = Column(String, nullable=False, doc="脱敏前的原始明文")
    entity_type = Column(String, nullable=False, doc="实体类别，如 name, phone")
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), default=_utc_now)


class EntityRegistry(Base):
    """
    全局实体注册表——实现跨文件、跨 session 的规范化占位符。
    同一实体文本在任何上下文中始终映射到相同的占位符。
    original_text_enc 字段由 Fernet 加密存储。
    """
    __tablename__ = "entity_registry"
    __table_args__ = (
        Index("idx_bid_entity_registry_entity_key", "entity_key"),
        Index("idx_bid_entity_registry_placeholder", "placeholder"),
        Index("idx_bid_entity_registry_entity_type", "entity_type"),
        {"schema": SCHEMA_NAME},
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    entity_key = Column(String, unique=True, nullable=False,
                        doc="SHA256(original_text + '|' + entity_type)，永不存原文")
    entity_type = Column(String, nullable=False, doc="name / org / phone / ...")
    original_text_enc = Column(String, nullable=False, doc="Fernet 加密后的原始明文")
    placeholder = Column(String, unique=True, nullable=False,
                         doc="{{__PIPT_org_1__}}，全局唯一")
    strong_placeholder = Column(String, unique=True, nullable=True,
                                doc="@@PIPT:v1:e000001:kxxxxxxxx@@，新协议强 token")
    global_index = Column(Integer, nullable=False, doc="同 entity_type 下的全局序号")
    first_seen_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), default=_utc_now)
    hit_count = Column(Integer, nullable=False, server_default="1", default=1, doc="被引用次数，供审计")


class PiptAuditLog(Base):
    """PIPT 脱敏识别与回映射审计日志；details 只放上下文和计数，原文仅保留 SHA256。"""
    __tablename__ = "pipt_audit_logs"
    __table_args__ = (
        Index("idx_bid_pipt_audit_logs_operation", "operation"),
        Index("idx_bid_pipt_audit_logs_status", "status"),
        Index("idx_bid_pipt_audit_logs_project_id", "project_id"),
        Index("idx_bid_pipt_audit_logs_session_id", "session_id"),
        Index("idx_bid_pipt_audit_logs_placeholder", "placeholder"),
        Index("idx_bid_pipt_audit_logs_created_at", "created_at"),
        {"schema": SCHEMA_NAME},
    )

    id = Column(String, primary_key=True, default=lambda: uuid.uuid4().hex)
    operation = Column(String, nullable=False, doc="recognize / desensitize / restore / resolve")
    status = Column(String, nullable=False, doc="success / miss / ambiguous / skipped / error")
    source = Column(String, nullable=False, server_default="", default="", doc="调用来源或链路名称")
    session_id = Column(String, nullable=True)
    project_id = Column(String, nullable=True)
    task_id = Column(String, nullable=True)
    placeholder = Column(String, nullable=True)
    entity_type = Column(String, nullable=True)
    original_hash = Column(String, nullable=True, doc="原文 SHA256，避免审计表泄露明文")
    text_hash = Column(String, nullable=True, doc="输入或输出文本 SHA256")
    details = Column(JSONB, nullable=False, server_default=text("'{}'::jsonb"), default=dict)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), default=_utc_now)


def hash_audit_text(value: Any) -> str:
    """生成审计用 SHA256；空值返回空串，避免把敏感原文写入日志。"""
    text_value = str(value or "")
    if not text_value:
        return ""
    return hashlib.sha256(text_value.encode("utf-8")).hexdigest()


def _safe_json_value(value: Any) -> dict[str, Any]:
    try:
        json.dumps(value if isinstance(value, dict) else {}, ensure_ascii=False, default=str)
        return value if isinstance(value, dict) else {}
    except Exception:
        return {}


def add_pipt_audit_log(
    db_session: Any,
    *,
    operation: str,
    status: str,
    source: str = "",
    session_id: str | None = None,
    project_id: str | None = None,
    task_id: str | None = None,
    placeholder: str | None = None,
    entity_type: str | None = None,
    original_text: Any = None,
    text: Any = None,
    details: dict[str, Any] | None = None,
) -> None:
    """
    写入 PIPT 审计日志。
    入参中的 original_text/text 仅用于计算 hash，不落明文；调用方可在 details 放非敏感计数和来源。
    审计使用独立短事务，避免日志表异常污染脱敏映射主事务。
    """
    _ = db_session
    audit_db = SessionLocal()
    try:
        audit_db.add(PiptAuditLog(
            operation=str(operation or "unknown")[:100],
            status=str(status or "unknown")[:100],
            source=str(source or "")[:200],
            session_id=session_id or None,
            project_id=project_id or None,
            task_id=task_id or None,
            placeholder=placeholder or None,
            entity_type=entity_type or None,
            original_hash=hash_audit_text(original_text) or None,
            text_hash=hash_audit_text(text) or None,
            details=_safe_json_value(details or {}),
        ))
        audit_db.commit()
    except Exception as exc:
        audit_db.rollback()
        _log.warning("PIPT 审计日志写入失败: %s", exc)
    finally:
        audit_db.close()


class ImageRegistry(Base):
    """
    全局图片映射表——管理从文档抽取的视觉媒体资源。彻底剥离物理图片，
    并与全局占位符关联。该占位符可无损向外丢给云端 LLM 和 Dify 知识库。
    """
    __tablename__ = "image_registry"
    __table_args__ = (
        Index("idx_bid_image_registry_image_hash", "image_hash"),
        Index("idx_bid_image_registry_project_id", "project_id"),
        Index("idx_bid_image_registry_placeholder", "placeholder"),
        {"schema": SCHEMA_NAME},
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    image_hash = Column(String, unique=True, nullable=False, doc="图片的散列值，防文件重复（如MD5/SHA256）")
    project_id = Column(String, nullable=True, doc="归属项目 ID")
    abs_path = Column(String, nullable=False, doc="本地服务器永久化物理路径")
    preview_url = Column(String, nullable=False, doc="供前端直接访问的图片源路由")
    placeholder = Column(String, unique=True, nullable=False, doc="抛送给外部模型的空壳占位符，例如 __PRO_IMG_7b8a9c__")
    vlm_caption = Column(String, nullable=True, doc="基于本地 VLM 在需要时所生成的描述。纯粹本地算力")
    is_reference_only = Column(Integer, nullable=False, server_default="1", default=1, doc="标志该图是做引用查询 还是真要塞回排版")
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), default=_utc_now)


class KnowledgeImageAsset(Base):
    """知识库图片语义资产表：物理路径仍以 ImageRegistry 为准。"""
    __tablename__ = "knowledge_image_assets"
    __table_args__ = (
        Index("idx_bid_knowledge_image_assets_image_hash", "image_hash"),
        Index("idx_bid_knowledge_image_assets_placeholder", "placeholder"),
        Index("idx_bid_knowledge_image_assets_source_doc", "source_doc"),
        Index("idx_bid_knowledge_image_assets_caption_status", "caption_status"),
        {"schema": SCHEMA_NAME},
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    image_hash = Column(String, unique=True, nullable=False)
    placeholder = Column(String, unique=True, nullable=False)
    source_doc = Column(String, nullable=False, server_default="", default="")
    source_page = Column(Integer, nullable=True)
    nearby_text_sanitized = Column(Text, nullable=True)
    caption = Column(String, nullable=False, server_default="", default="")
    image_type = Column(String, nullable=False, server_default="", default="")
    summary = Column(Text, nullable=False, server_default="", default="")
    tags_json = Column(Text, nullable=False, server_default="[]", default="[]")
    caption_status = Column(String, nullable=False, server_default="pending", default="pending")
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), default=_utc_now)



class ProjectRecord(Base):
    """项目记录表 — 与前端 Project interface 完全对齐"""
    __tablename__ = "projects"
    __table_args__ = (
        Index("idx_bid_projects_created_at", "created_at"),
        Index("idx_bid_projects_updated_at", "updated_at"),
        Index("idx_bid_projects_status", "status"),
        {"schema": SCHEMA_NAME},
    )

    id = Column(String, primary_key=True, doc="项目 ID，如 proj_1710000000000")
    name = Column(String, nullable=False, doc="项目名")
    status = Column(String, nullable=False, server_default="uploading", default="uploading", doc="项目状态")
    data = Column(Text, nullable=False, server_default="{}", default="{}", doc="完整项目 JSON 数据")
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), default=_utc_now)
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), default=_utc_now, onupdate=_utc_now)


def init_db():
    """初始化 PostgreSQL schema 与 ORM 表，作为统一初始化后的兼容兜底。"""
    try:
        with engine.begin() as conn:
            conn.execute(text(f'CREATE SCHEMA IF NOT EXISTS "{SCHEMA_NAME}"'))
        Base.metadata.create_all(bind=engine)
    except Exception as exc:
        raise RuntimeError(
            "pipt-lite PostgreSQL 初始化失败，请检查 DATABASE_URL 或 POSTGRES_* 配置，并执行 "
            "python scripts/init_db.py && alembic upgrade head"
        ) from exc
    _log.info("pipt-lite PostgreSQL schema %s 已执行 create_all 兼容检查", SCHEMA_NAME)


def get_db():
    """获取数据库 Session（通常作为 FastAPI 依赖注入）"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
