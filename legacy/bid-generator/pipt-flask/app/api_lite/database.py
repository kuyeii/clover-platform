# -*- coding: utf-8 -*-
"""
pipt-lite 数据库模块
提供占位符映射关系的物理持久化存储
"""

import hashlib
import os
import uuid
from datetime import datetime
from pathlib import Path

from sqlalchemy import Column, String, Integer, DateTime, Text, create_engine, func, event
from sqlalchemy.orm import declarative_base, sessionmaker

# 数据库文件路径：默认固定在 pipt-flask 目录下，避免从仓库根目录启动时落到另一份 SQLite（缺表）
_PKG_ROOT = Path(__file__).resolve().parents[2]
_DEFAULT_DB = _PKG_ROOT / "pipt_mappings.db"
DB_PATH = Path(os.getenv("PIPT_DB_PATH", str(_DEFAULT_DB))).resolve()
DATABASE_URL = f"sqlite:///{DB_PATH}"

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False},
    echo=False
)


@event.listens_for(engine, "connect")
def _set_sqlite_pragmas(dbapi_connection, connection_record):
    """SQLite 单机生产加固：WAL + busy_timeout，降低写冲突与锁等待失败。"""
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL;")
    cursor.execute("PRAGMA busy_timeout=5000;")
    cursor.execute("PRAGMA synchronous=NORMAL;")
    cursor.close()

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

    id = Column(String, primary_key=True, default=lambda: uuid.uuid4().hex)
    session_id = Column(String, index=True, nullable=False, doc="工作流或会话的唯一标识")
    placeholder = Column(String, index=True, nullable=False, doc="占位符，如 {{__PIPT_name_1__}}")
    original_text = Column(String, nullable=False, doc="脱敏前的原始明文")
    entity_type = Column(String, nullable=False, doc="实体类别，如 name, phone")
    created_at = Column(DateTime, default=datetime.utcnow)


class EntityRegistry(Base):
    """
    全局实体注册表——实现跨文件、跨 session 的规范化占位符。
    同一实体文本在任何上下文中始终映射到相同的占位符。
    original_text_enc 字段由 Fernet 加密存储。
    """
    __tablename__ = "entity_registry"

    id = Column(Integer, primary_key=True, autoincrement=True)
    entity_key = Column(String, unique=True, index=True, nullable=False,
                        doc="SHA256(original_text + '|' + entity_type)，永不存原文")
    entity_type = Column(String, nullable=False, doc="name / org / phone / ...")
    original_text_enc = Column(String, nullable=False, doc="Fernet 加密后的原始明文")
    placeholder = Column(String, unique=True, index=True, nullable=False,
                         doc="{{__PIPT_org_1__}}，全局唯一")
    global_index = Column(Integer, nullable=False, doc="同 entity_type 下的全局序号")
    first_seen_at = Column(DateTime, default=datetime.utcnow)
    hit_count = Column(Integer, default=1, doc="被引用次数，供审计")


class ImageRegistry(Base):
    """
    全局图片映射表——管理从文档抽取的视觉媒体资源。彻底剥离物理图片，
    并与全局占位符关联。该占位符可无损向外丢给云端 LLM 和 Dify 知识库。
    """
    __tablename__ = "image_registry"

    id = Column(Integer, primary_key=True, autoincrement=True)
    image_hash = Column(String, unique=True, index=True, nullable=False, doc="图片的散列值，防文件重复（如MD5/SHA256）")
    project_id = Column(String, index=True, nullable=True, doc="归属项目 ID")
    abs_path = Column(String, nullable=False, doc="本地服务器永久化物理路径")
    preview_url = Column(String, nullable=False, doc="供前端直接访问的图片源路由")
    placeholder = Column(String, unique=True, index=True, nullable=False, doc="抛送给外部模型的空壳占位符，例如 __PRO_IMG_7b8a9c__")
    vlm_caption = Column(String, nullable=True, doc="基于本地 VLM 在需要时所生成的描述。纯粹本地算力")
    is_reference_only = Column(Integer, default=1, doc="标志该图是做引用查询 还是真要塞回排版")
    created_at = Column(DateTime, default=datetime.utcnow)



class ProjectRecord(Base):
    """项目记录表 — 与前端 Project interface 完全对齐"""
    __tablename__ = "projects"

    id = Column(String, primary_key=True, doc="项目 ID，如 proj_1710000000000")
    name = Column(String, nullable=False, doc="项目名")
    status = Column(String, nullable=False, default="uploading", doc="项目状态")
    data = Column(Text, nullable=False, default="{}", doc="完整项目 JSON 数据")
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


def init_db():
    """初始化数据库连同表结构（含后续新增的 ORM 表，如 image_registry）"""
    import logging

    _log = logging.getLogger(__name__)
    Base.metadata.create_all(bind=engine)
    _log.info("SQLite 路径: %s，已执行 create_all", DB_PATH)


def get_db():
    """获取数据库 Session（通常作为 FastAPI 依赖注入）"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
