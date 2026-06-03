from __future__ import annotations

import asyncio
import json
import logging
import mimetypes
import os
import re
import shutil
import threading
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from queue import Queue
from typing import Any
from urllib.parse import quote

from fastapi import UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.core.config import get_api_settings
from app.core.errors import PlatformError
from packages.patent_disclosure_skill.adapter import (
    GenerationPipeline,
    OpenAICompatibleLLMClient,
    PatentLlmConfig,
    PipelineOptions,
    PipelineProgress,
)
from packages.patent_disclosure_skill.adapter.cnipa_searcher import CnipaPriorArtSearcher
from packages.patent_disclosure_skill.adapter.docx_exporter import DocxExporter
from packages.patent_disclosure_skill.adapter.material_reader import MaterialReader, validate_zip_safe
from packages.patent_disclosure_skill.adapter.openai_compatible_llm import PatentLlmError
from packages.py_common.db.session import get_engine

logger = logging.getLogger(__name__)

APP_CODE = "patent-disclosure"
MODULE_CODE = APP_CODE
SCHEMA = "patent_disclosure"

MATERIAL_TYPES = {"source", "reference", "existing"}
ALLOWED_MIME_TYPES = {
    ".md": {"text/markdown", "text/x-markdown", "text/plain"},
    ".txt": {"text/plain", "text/markdown", "text/x-markdown"},
    ".docx": {"application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/zip"},
    ".pptx": {"application/vnd.openxmlformats-officedocument.presentationml.presentation", "application/zip"},
    ".pdf": {"application/pdf"},
    ".zip": {"application/zip", "application/x-zip-compressed"},
}
GENERIC_UPLOAD_MIME_TYPES = {"", "application/octet-stream", "binary/octet-stream"}
ALLOWED_ARTIFACT_TYPES = {
    "patent_points",
    "cnipa_prior_art_notes",
    "disclosure_md",
    "disclosure_docx",
    "self_check",
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _json_dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), default=str)


def _json_loads_dict(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    if not value:
        return {}
    try:
        data = json.loads(value)
    except (TypeError, json.JSONDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


def _to_iso(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    return str(value)


def _user_id(user: dict[str, Any]) -> str | None:
    value = str(user.get("id") or "")
    return value if _is_uuid(value) else None


def _is_uuid(value: str | None) -> bool:
    if not value:
        return False
    try:
        uuid.UUID(str(value))
    except ValueError:
        return False
    return True


def _safe_name(value: str, fallback: str = "file") -> str:
    cleaned = re.sub(r"[^\w\u4e00-\u9fff.-]+", "_", value.strip(), flags=re.UNICODE).strip("._")
    return cleaned[:120] or fallback


def _artifact_mime(artifact_type: str, filename: str) -> str:
    if artifact_type == "disclosure_docx" or filename.endswith(".docx"):
        return "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    if filename.endswith(".md"):
        return "text/markdown; charset=utf-8"
    return mimetypes.guess_type(filename)[0] or "application/octet-stream"


def _find_chromium_executable() -> Path | None:
    for key in (
        "PATENT_DISCLOSURE_CHROMIUM_PATH",
        "PUPPETEER_EXECUTABLE_PATH",
        "PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH",
        "CHROME_BIN",
        "CHROMIUM_BIN",
    ):
        value = os.getenv(key)
        if value:
            path = Path(value).expanduser()
            if path.is_file() and os.access(path, os.X_OK):
                return path
    for name in ("chromium", "chromium-browser", "google-chrome", "google-chrome-stable", "chrome"):
        found = shutil.which(name)
        if found:
            return Path(found)
    cache_root = Path(os.getenv("PLAYWRIGHT_BROWSERS_PATH") or Path.home() / ".cache" / "ms-playwright")
    if cache_root.exists():
        for pattern in (
            "chromium-*/chrome-linux/chrome",
            "chromium-*/chrome-mac/Chromium.app/Contents/MacOS/Chromium",
            "chromium-*/chrome-win/chrome.exe",
        ):
            for path in cache_root.glob(pattern):
                if path.is_file() and os.access(path, os.X_OK):
                    return path
    return None


def _db_error(exc: Exception) -> PlatformError:
    logger.exception("Patent disclosure database operation failed")
    return PlatformError(
        code="DATABASE_ERROR",
        message="专利交底书数据库访问失败。",
        status_code=500,
        details={"module": "patent-disclosure", "schema": SCHEMA},
    )


def ensure_patent_disclosure_storage() -> None:
    try:
        with get_engine().begin() as conn:
            exists = conn.execute(
                text("SELECT to_regclass('patent_disclosure.cases') IS NOT NULL")
            ).scalar_one()
    except (SQLAlchemyError, RuntimeError) as exc:
        raise _db_error(exc) from exc
    if not exists:
        raise PlatformError(
            code="DATABASE_ERROR",
            message="专利交底书数据库表不存在，请先执行迁移。",
            status_code=500,
            details={"schema": SCHEMA},
        )


@dataclass(frozen=True)
class PatentDisclosureSettings:
    repo_root: Path
    data_dir: Path
    skill_dir: Path
    max_file_size_bytes: int
    max_case_size_bytes: int
    allowed_extensions: set[str]
    cnipa_enabled: bool
    skip_prior_art: bool
    cnipa_timeout_seconds: int
    cnipa_max_results: int
    enable_mermaid_render: bool
    tool_timeout_seconds: int
    llm: PatentLlmConfig

    @classmethod
    def from_env(cls) -> "PatentDisclosureSettings":
        repo_root = get_api_settings().repo_root
        data_dir = Path(os.getenv("PATENT_DISCLOSURE_DATA_DIR") or repo_root / "data" / "patent_disclosure")
        skill_dir = Path(os.getenv("PATENT_DISCLOSURE_SKILL_DIR") or repo_root / "packages" / "patent_disclosure_skill" / "upstream")
        allowed = {
            item.strip().lower()
            for item in os.getenv("PATENT_DISCLOSURE_ALLOWED_EXTENSIONS", ".md,.txt,.docx,.pptx,.pdf,.zip").split(",")
            if item.strip()
        }
        return cls(
            repo_root=repo_root,
            data_dir=data_dir,
            skill_dir=skill_dir,
            max_file_size_bytes=int(os.getenv("PATENT_DISCLOSURE_MAX_FILE_SIZE_MB", "50")) * 1024 * 1024,
            max_case_size_bytes=int(os.getenv("PATENT_DISCLOSURE_MAX_CASE_SIZE_MB", "300")) * 1024 * 1024,
            allowed_extensions=allowed,
            cnipa_enabled=os.getenv("PATENT_DISCLOSURE_CNIPA_ENABLED", "true").lower() in {"1", "true", "yes"},
            skip_prior_art=os.getenv("PATENT_DISCLOSURE_SKIP_PRIOR_ART", "false").lower() in {"1", "true", "yes"},
            cnipa_timeout_seconds=int(os.getenv("PATENT_DISCLOSURE_CNIPA_TIMEOUT_SECONDS", "300")),
            cnipa_max_results=int(os.getenv("PATENT_DISCLOSURE_CNIPA_MAX_RESULTS", "20")),
            enable_mermaid_render=os.getenv("PATENT_DISCLOSURE_ENABLE_MERMAID_RENDER", "true").lower()
            in {"1", "true", "yes"},
            tool_timeout_seconds=int(os.getenv("PATENT_DISCLOSURE_TOOL_TIMEOUT_SECONDS", "300")),
            llm=PatentLlmConfig(
                base_url=os.getenv("PATENT_DISCLOSURE_LLM_BASE_URL", ""),
                api_key=os.getenv("PATENT_DISCLOSURE_LLM_API_KEY", ""),
                model=os.getenv("PATENT_DISCLOSURE_LLM_MODEL", ""),
                timeout_seconds=int(os.getenv("PATENT_DISCLOSURE_LLM_TIMEOUT_SECONDS", "180")),
                max_retries=int(os.getenv("PATENT_DISCLOSURE_LLM_MAX_RETRIES", "2")),
                temperature=float(os.getenv("PATENT_DISCLOSURE_LLM_TEMPERATURE", "0.2")),
            ),
        )


class PatentSseBroker:
    def __init__(self) -> None:
        self._queues: dict[str, list[Queue[dict[str, Any] | None]]] = {}
        self._lock = threading.Lock()

    def publish(self, job_id: str, event: dict[str, Any]) -> None:
        with self._lock:
            queues = list(self._queues.get(job_id, []))
        for queue in queues:
            queue.put(event)

    def close(self, job_id: str) -> None:
        with self._lock:
            queues = list(self._queues.pop(job_id, []))
        for queue in queues:
            queue.put(None)

    def subscribe(self, job_id: str) -> Queue[dict[str, Any] | None]:
        queue: Queue[dict[str, Any] | None] = Queue(maxsize=100)
        with self._lock:
            self._queues.setdefault(job_id, []).append(queue)
        return queue

    def unsubscribe(self, job_id: str, queue: Queue[dict[str, Any] | None]) -> None:
        with self._lock:
            queues = self._queues.get(job_id)
            if not queues:
                return
            if queue in queues:
                queues.remove(queue)
            if not queues:
                self._queues.pop(job_id, None)


SSE_BROKER = PatentSseBroker()


class PatentFileStore:
    def __init__(self, settings: PatentDisclosureSettings) -> None:
        self.settings = settings
        self.root = settings.data_dir.resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    def case_root(self, case_id: str) -> Path:
        return self._inside_root(self.root / "cases" / case_id)

    def material_original_dir(self, case_id: str) -> Path:
        return self.case_root(case_id) / "materials" / "original"

    def material_parsed_dir(self, case_id: str) -> Path:
        return self.case_root(case_id) / "materials" / "parsed"

    def output_dir(self, case_id: str, version_no: int) -> Path:
        return self.case_root(case_id) / "outputs" / f"v{version_no}"

    def tmp_dir(self, case_id: str, job_id: str) -> Path:
        return self.case_root(case_id) / "tmp" / job_id

    def save_upload(self, *, case_id: str, upload: UploadFile) -> tuple[str, Path, int, str | None]:
        filename = upload.filename or "material"
        ext = Path(filename).suffix.lower()
        if ext not in self.settings.allowed_extensions:
            raise PlatformError(
                code="PATENT_UNSUPPORTED_FILE_TYPE",
                message="暂不支持该文件类型，请上传 md、txt、docx、pptx、pdf 或 zip。",
                status_code=400,
            )
        target_dir = self.material_original_dir(case_id)
        target_dir.mkdir(parents=True, exist_ok=True)
        stored_name = f"{uuid.uuid4().hex}{ext}"
        target = self._inside_root(target_dir / stored_name)

        size = 0
        with target.open("wb") as out:
            while chunk := upload.file.read(1024 * 1024):
                size += len(chunk)
                if size > self.settings.max_file_size_bytes:
                    target.unlink(missing_ok=True)
                    raise PlatformError(
                        code="PATENT_UPLOAD_TOO_LARGE",
                        message="上传文件超过大小限制。",
                        status_code=413,
                    )
                out.write(chunk)
        try:
            _validate_upload_mime(ext, upload.content_type, target)
        except PlatformError:
            target.unlink(missing_ok=True)
            raise
        if ext == ".zip":
            try:
                validate_zip_safe(target)
            except Exception as exc:
                target.unlink(missing_ok=True)
                raise PlatformError(
                    code="PATENT_PARSE_FAILED",
                    message="ZIP 文件包含不安全路径或无法解析。",
                    status_code=400,
                ) from exc
        return filename, target, size, upload.content_type

    def ensure_within_root(self, path: str | Path) -> Path:
        return self._inside_root(Path(path))

    def _inside_root(self, path: Path) -> Path:
        resolved = path.resolve()
        if resolved != self.root and self.root not in resolved.parents:
            raise PlatformError(code="PATENT_PERMISSION_DENIED", message="文件路径越界。", status_code=403)
        return resolved


def _validate_upload_mime(ext: str, content_type: str | None, path: Path) -> None:
    declared = (content_type or "").split(";", 1)[0].strip().lower()
    allowed = ALLOWED_MIME_TYPES.get(ext, set())
    if declared not in GENERIC_UPLOAD_MIME_TYPES and declared not in allowed:
        raise PlatformError(
            code="PATENT_UNSUPPORTED_FILE_TYPE",
            message="上传文件 MIME 类型与扩展名不匹配。",
            status_code=400,
            details={"extension": ext, "mimeType": declared},
        )
    if not _file_signature_matches(ext, path):
        raise PlatformError(
            code="PATENT_UNSUPPORTED_FILE_TYPE",
            message="上传文件内容与扩展名不匹配。",
            status_code=400,
            details={"extension": ext},
        )


def _file_signature_matches(ext: str, path: Path) -> bool:
    head = path.read_bytes()[:4096]
    if ext == ".pdf":
        return head.startswith(b"%PDF-")
    if ext in {".docx", ".pptx", ".zip"}:
        return head.startswith((b"PK\x03\x04", b"PK\x05\x06", b"PK\x07\x08"))
    if ext in {".md", ".txt"}:
        if b"\x00" in head:
            return False
        try:
            head.decode("utf-8")
        except UnicodeDecodeError:
            return False
        return True
    return False


class PatentDisclosureService:
    def __init__(self, settings: PatentDisclosureSettings | None = None) -> None:
        self.settings = settings or PatentDisclosureSettings.from_env()
        self.file_store = PatentFileStore(self.settings)

    def health(self) -> dict[str, Any]:
        skill_found = (self.settings.skill_dir / "SKILL.md").is_file()
        cnipa_available = self.settings.cnipa_enabled and (self.settings.skill_dir / "tools" / "cnipa_epub_search.py").is_file()
        docx_available = (self.settings.skill_dir / "tools" / "md_to_docx.py").is_file()
        mermaid_available = (
            (self.settings.skill_dir / "tools" / "mermaid_render.py").is_file()
            and (
                (self.settings.skill_dir / "tools" / "node_modules" / ".bin" / "mmdc").is_file()
                or shutil.which("mmdc") is not None
                or shutil.which("npx") is not None
            )
            and _find_chromium_executable() is not None
        )
        prior_art_skipped = self.settings.skip_prior_art
        return {
            "ok": skill_found and self.settings.llm.configured and (cnipa_available or prior_art_skipped) and docx_available,
            "module": APP_CODE,
            "skillFound": skill_found,
            "openaiCompatibleConfigured": self.settings.llm.configured,
            "cnipaAvailable": cnipa_available,
            "priorArtSkipped": prior_art_skipped,
            "docxExportAvailable": docx_available,
            "mermaidRenderAvailable": mermaid_available,
            "sseEnabled": True,
        }

    def create_case(self, user: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
        ensure_patent_disclosure_storage()
        title = str(payload.get("title") or "").strip()
        if not title:
            raise PlatformError(code="VALIDATION_ERROR", message="案件名称不能为空。", status_code=422)
        try:
            with get_engine().begin() as conn:
                row = conn.execute(
                    text(
                        """
                        INSERT INTO patent_disclosure.cases (
                          owner_user_id, title, technical_topic, applicant, project_name,
                          description, status, anonymize, metadata
                        )
                        VALUES (
                          :owner_user_id, :title, :technical_topic, :applicant, :project_name,
                          :description, 'draft', :anonymize, '{}'::jsonb
                        )
                        RETURNING *
                        """
                    ),
                    {
                        "owner_user_id": _user_id(user),
                        "title": title,
                        "technical_topic": str(payload.get("technicalTopic") or "").strip(),
                        "applicant": str(payload.get("applicant") or "").strip(),
                        "project_name": str(payload.get("projectName") or "").strip(),
                        "description": str(payload.get("description") or "").strip(),
                        "anonymize": bool(payload.get("anonymize", True)),
                    },
                ).mappings().one()
        except SQLAlchemyError as exc:
            raise _db_error(exc) from exc
        return _case_from_row(row)

    def list_cases(self, user: dict[str, Any], *, limit: int = 30, offset: int = 0) -> dict[str, Any]:
        ensure_patent_disclosure_storage()
        limit = min(max(limit, 1), 100)
        offset = max(offset, 0)
        owner_filter = "" if user.get("role") == "admin" else "WHERE c.owner_user_id = :owner_user_id"
        params = {"owner_user_id": _user_id(user), "limit": limit, "offset": offset}
        try:
            with get_engine().begin() as conn:
                total = int(
                    conn.execute(
                        text(f"SELECT COUNT(*) FROM patent_disclosure.cases c {owner_filter}"),
                        params,
                    ).scalar_one()
                )
                rows = conn.execute(
                    text(
                        f"""
                        SELECT
                          c.*,
                          COUNT(DISTINCT m.id) AS material_count,
                          COUNT(DISTINCT a.id) AS artifact_count,
                          (
                            SELECT j.status
                            FROM patent_disclosure.jobs j
                            WHERE j.case_id = c.id
                            ORDER BY j.created_at DESC
                            LIMIT 1
                          ) AS latest_job_status
                        FROM patent_disclosure.cases c
                        LEFT JOIN patent_disclosure.materials m ON m.case_id = c.id
                        LEFT JOIN patent_disclosure.artifacts a ON a.case_id = c.id
                        {owner_filter}
                        GROUP BY c.id
                        ORDER BY c.updated_at DESC, c.created_at DESC
                        LIMIT :limit OFFSET :offset
                        """
                    ),
                    params,
                ).mappings().all()
        except SQLAlchemyError as exc:
            raise _db_error(exc) from exc
        return {"items": [_case_list_item_from_row(row) for row in rows], "total": total}

    def get_case_detail(self, user: dict[str, Any], case_id: str) -> dict[str, Any]:
        case = self._get_case_for_user(user, case_id)
        return {
            "case": case,
            "materials": self.list_materials(user, case_id)["items"],
            "latestJob": self._latest_job(case_id),
            "artifacts": self.list_artifacts(user, case_id)["items"],
        }

    def list_materials(self, user: dict[str, Any], case_id: str) -> dict[str, Any]:
        self._get_case_for_user(user, case_id)
        try:
            with get_engine().begin() as conn:
                rows = conn.execute(
                    text(
                        """
                        SELECT *
                        FROM patent_disclosure.materials
                        WHERE case_id = :case_id
                        ORDER BY created_at DESC
                        """
                    ),
                    {"case_id": case_id},
                ).mappings().all()
        except SQLAlchemyError as exc:
            raise _db_error(exc) from exc
        return {"items": [_material_from_row(row) for row in rows]}

    def upload_materials(
        self,
        user: dict[str, Any],
        *,
        case_id: str,
        files: list[UploadFile],
        material_type: str,
    ) -> dict[str, Any]:
        if material_type not in MATERIAL_TYPES:
            raise PlatformError(code="VALIDATION_ERROR", message="材料类型不合法。", status_code=422)
        self._get_case_for_user(user, case_id)
        if not files:
            raise PlatformError(code="VALIDATION_ERROR", message="请至少上传一个文件。", status_code=422)
        current_size = self._case_material_size(case_id)
        items: list[dict[str, Any]] = []
        for upload in files:
            filename, path, size, mime_type = self.file_store.save_upload(case_id=case_id, upload=upload)
            current_size += size
            if current_size > self.settings.max_case_size_bytes:
                path.unlink(missing_ok=True)
                raise PlatformError(code="PATENT_UPLOAD_TOO_LARGE", message="案件材料累计大小超过限制。", status_code=413)
            try:
                with get_engine().begin() as conn:
                    core_file_id = conn.execute(
                        text(
                            """
                            INSERT INTO core.files (
                              module_code, owner_user_id, filename, storage_backend,
                              storage_path, mime_type, size_bytes, metadata
                            )
                            VALUES (
                              :module_code, :owner_user_id, :filename, 'local',
                              :storage_path, :mime_type, :size_bytes, '{}'::jsonb
                            )
                            RETURNING id
                            """
                        ),
                        {
                            "module_code": MODULE_CODE,
                            "owner_user_id": _user_id(user),
                            "filename": filename,
                            "storage_path": str(path),
                            "mime_type": mime_type,
                            "size_bytes": size,
                        },
                    ).scalar_one()
                    row = conn.execute(
                        text(
                            """
                            INSERT INTO patent_disclosure.materials (
                              case_id, core_file_id, filename, material_type, storage_path,
                              mime_type, size_bytes, parse_status, metadata
                            )
                            VALUES (
                              :case_id, :core_file_id, :filename, :material_type, :storage_path,
                              :mime_type, :size_bytes, 'pending', '{}'::jsonb
                            )
                            RETURNING *
                            """
                        ),
                        {
                            "case_id": case_id,
                            "core_file_id": str(core_file_id),
                            "filename": filename,
                            "material_type": material_type,
                            "storage_path": str(path),
                            "mime_type": mime_type,
                            "size_bytes": size,
                        },
                    ).mappings().one()
                    conn.execute(
                        text("UPDATE patent_disclosure.cases SET status = 'ready', updated_at = now() WHERE id = :case_id"),
                        {"case_id": case_id},
                    )
            except SQLAlchemyError as exc:
                raise _db_error(exc) from exc
            items.append(_material_from_row(row))
        return {"items": items}

    def delete_material(self, user: dict[str, Any], material_id: str) -> dict[str, Any]:
        try:
            with get_engine().begin() as conn:
                row = conn.execute(
                    text(
                        """
                        SELECT m.*, c.owner_user_id
                        FROM patent_disclosure.materials m
                        JOIN patent_disclosure.cases c ON c.id = m.case_id
                        WHERE m.id = :material_id
                        """
                    ),
                    {"material_id": material_id},
                ).mappings().first()
                if not row:
                    raise PlatformError(code="PATENT_MATERIAL_NOT_FOUND", message="材料不存在。", status_code=404)
                self._assert_owner(user, row.get("owner_user_id"))
                conn.execute(text("DELETE FROM patent_disclosure.materials WHERE id = :id"), {"id": material_id})
        except PlatformError:
            raise
        except SQLAlchemyError as exc:
            raise _db_error(exc) from exc
        for key in ("storage_path", "parsed_text_path"):
            value = row.get(key)
            if value:
                path = self.file_store.ensure_within_root(str(value))
                path.unlink(missing_ok=True)
        return {"ok": True}

    def start_generation(self, user: dict[str, Any], case_id: str, options: dict[str, Any]) -> dict[str, Any]:
        health = self.health()
        if not health["skillFound"]:
            raise PlatformError(code="PATENT_SKILL_NOT_FOUND", message="专利交底书 skill 文件未找到。", status_code=503)
        if not health["openaiCompatibleConfigured"]:
            raise PlatformError(code="PATENT_LLM_NOT_CONFIGURED", message="专利交底书生成模型尚未配置。", status_code=503)
        if not health["cnipaAvailable"] and not health.get("priorArtSkipped"):
            raise PlatformError(code="PATENT_CNIPA_UNAVAILABLE", message="国知局查新工具不可用。", status_code=503)
        if not health["docxExportAvailable"]:
            raise PlatformError(code="PATENT_DOCX_EXPORT_FAILED", message="Word 导出工具不可用。", status_code=503)

        case = self._get_case_for_user(user, case_id)
        materials = self._materials_for_case(case_id)
        if not materials:
            raise PlatformError(code="VALIDATION_ERROR", message="请先上传项目材料。", status_code=422)
        job_input = {
            "outputFormats": options.get("outputFormats") or ["md", "docx"],
            "includeMermaid": bool(options.get("includeMermaid", True)),
            "renderMermaidPng": bool(options.get("renderMermaidPng", True)),
            "anonymize": bool(options.get("anonymize", case.get("anonymize", True))),
            "extraInstruction": str(options.get("extraInstruction") or ""),
        }
        try:
            with get_engine().begin() as conn:
                core_job_id = conn.execute(
                    text(
                        """
                        INSERT INTO core.jobs (
                          module_code, job_type, status, progress, input, output, created_by
                        )
                        VALUES (
                          :module_code, 'generate_disclosure', 'pending', 0,
                          CAST(:input AS jsonb), '{}'::jsonb, :created_by
                        )
                        RETURNING id
                        """
                    ),
                    {"module_code": MODULE_CODE, "input": _json_dumps(job_input), "created_by": _user_id(user)},
                ).scalar_one()
                row = conn.execute(
                    text(
                        """
                        INSERT INTO patent_disclosure.jobs (
                          case_id, core_job_id, status, step, progress, input, output, created_by
                        )
                        VALUES (
                          :case_id, :core_job_id, 'pending', 'pending', 0,
                          CAST(:input AS jsonb), '{}'::jsonb, :created_by
                        )
                        RETURNING *
                        """
                    ),
                    {
                        "case_id": case_id,
                        "core_job_id": str(core_job_id),
                        "input": _json_dumps(job_input),
                        "created_by": _user_id(user),
                    },
                ).mappings().one()
                conn.execute(
                    text("UPDATE patent_disclosure.cases SET status = 'running', updated_at = now() WHERE id = :case_id"),
                    {"case_id": case_id},
                )
        except SQLAlchemyError as exc:
            raise _db_error(exc) from exc

        job = _job_from_row(row)
        threading.Thread(
            target=self._run_generation_job,
            args=(job["id"], case, materials, job_input),
            daemon=True,
        ).start()
        return {
            **job,
            "sseUrl": f"/api/v1/patent-disclosure/api/jobs/{job['id']}/stream",
        }

    def get_job(self, user: dict[str, Any], job_id: str) -> dict[str, Any]:
        try:
            with get_engine().begin() as conn:
                row = conn.execute(
                    text(
                        """
                        SELECT j.*, c.owner_user_id
                        FROM patent_disclosure.jobs j
                        JOIN patent_disclosure.cases c ON c.id = j.case_id
                        WHERE j.id = :job_id
                        """
                    ),
                    {"job_id": job_id},
                ).mappings().first()
        except SQLAlchemyError as exc:
            raise _db_error(exc) from exc
        if not row:
            raise PlatformError(code="PATENT_JOB_NOT_FOUND", message="任务不存在。", status_code=404)
        self._assert_owner(user, row.get("owner_user_id"))
        return _job_from_row(row)

    async def stream_job_events(self, user: dict[str, Any], job_id: str):
        job = self.get_job(user, job_id)
        initial_event = _job_event(job)
        yield _sse("progress", initial_event)
        if job["status"] == "succeeded":
            yield _sse("done", {**initial_event, "artifactIds": job.get("output", {}).get("artifactIds", [])})
            return
        if job["status"] == "failed":
            yield _sse("error", {**initial_event, "message": job.get("errorMessage") or "生成失败"})
            return

        queue = SSE_BROKER.subscribe(job_id)
        try:
            while True:
                try:
                    event = await asyncio.wait_for(asyncio.to_thread(queue.get), timeout=15)
                except asyncio.TimeoutError:
                    yield _sse("heartbeat", {"status": "running", "time": _now_iso()})
                    continue
                if event is None:
                    final = self.get_job(user, job_id)
                    event_name = "done" if final["status"] == "succeeded" else "error"
                    yield _sse(event_name, _job_event(final))
                    return
                event_name = str(event.pop("_event", "progress"))
                yield _sse(event_name, event)
                if event_name in {"done", "error"}:
                    return
        finally:
            SSE_BROKER.unsubscribe(job_id, queue)

    def list_artifacts(self, user: dict[str, Any], case_id: str) -> dict[str, Any]:
        self._get_case_for_user(user, case_id)
        try:
            with get_engine().begin() as conn:
                rows = conn.execute(
                    text(
                        """
                        SELECT *
                        FROM patent_disclosure.artifacts
                        WHERE case_id = :case_id
                        ORDER BY created_at DESC, version_no DESC
                        """
                    ),
                    {"case_id": case_id},
                ).mappings().all()
        except SQLAlchemyError as exc:
            raise _db_error(exc) from exc
        return {"items": [_artifact_from_row(row) for row in rows]}

    def download_artifact(self, user: dict[str, Any], artifact_id: str) -> FileResponse:
        try:
            with get_engine().begin() as conn:
                row = conn.execute(
                    text(
                        """
                        SELECT a.*, c.owner_user_id
                        FROM patent_disclosure.artifacts a
                        JOIN patent_disclosure.cases c ON c.id = a.case_id
                        WHERE a.id = :artifact_id
                        """
                    ),
                    {"artifact_id": artifact_id},
                ).mappings().first()
        except SQLAlchemyError as exc:
            raise _db_error(exc) from exc
        if not row:
            raise PlatformError(code="PATENT_ARTIFACT_NOT_FOUND", message="产物不存在。", status_code=404)
        self._assert_owner(user, row.get("owner_user_id"))
        path = self.file_store.ensure_within_root(str(row["storage_path"]))
        if not path.is_file():
            raise PlatformError(code="PATENT_ARTIFACT_NOT_FOUND", message="产物文件不存在。", status_code=404)
        filename = str(row["filename"])
        return FileResponse(
            path,
            media_type=str(row.get("mime_type") or _artifact_mime(str(row["artifact_type"]), filename)),
            filename=filename,
            headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}"},
        )

    def _run_generation_job(self, job_id: str, case: dict[str, Any], materials: list[dict[str, Any]], options: dict[str, Any]) -> None:
        try:
            self._set_job_progress(job_id, "running", "pending", 1, "生成任务已启动")
            version_no = self._next_version(case["id"])
            timestamp = datetime.now().strftime("%Y%m%d%H%M%S")
            safe_case_title = _safe_name(str(case.get("title") or "patent_disclosure"), "patent_disclosure")
            output_dir = self.file_store.output_dir(case["id"], version_no)
            tmp_dir = self.file_store.tmp_dir(case["id"], job_id)
            parsed_dir = self.file_store.material_parsed_dir(case["id"])

            pipeline = GenerationPipeline(
                skill_dir=self.settings.skill_dir,
                material_reader=MaterialReader(self.settings.skill_dir, self.settings.tool_timeout_seconds),
                llm=OpenAICompatibleLLMClient(self.settings.llm),
                cnipa_searcher=CnipaPriorArtSearcher(
                    self.settings.skill_dir,
                    timeout_seconds=self.settings.cnipa_timeout_seconds,
                    max_results=self.settings.cnipa_max_results,
                ),
                docx_exporter=DocxExporter(
                    self.settings.skill_dir,
                    timeout_seconds=self.settings.tool_timeout_seconds,
                    enable_mermaid_render=self.settings.enable_mermaid_render and bool(options.get("renderMermaidPng", True)),
                ),
            )

            def emit(progress: PipelineProgress) -> None:
                self._set_job_progress(job_id, "running", progress.step, progress.progress, progress.message)

            result = pipeline.run(
                case=case,
                materials=materials,
                output_dir=output_dir,
                parsed_dir=parsed_dir,
                tmp_dir=tmp_dir,
                safe_case_title=safe_case_title,
                timestamp=timestamp,
                options=PipelineOptions(
                    output_formats=list(options.get("outputFormats") or ["md", "docx"]),
                    include_mermaid=bool(options.get("includeMermaid", True)),
                    render_mermaid_png=bool(options.get("renderMermaidPng", True)),
                    anonymize=bool(options.get("anonymize", True)),
                    skip_prior_art=self.settings.skip_prior_art,
                    extra_instruction=str(options.get("extraInstruction") or ""),
                ),
                emit=emit,
            )
            self._update_parsed_materials(result.parsed_materials)
            artifact_ids = self._save_pipeline_artifacts(
                case_id=case["id"],
                job_id=job_id,
                version_no=version_no,
                paths=[
                    ("patent_points", result.patent_points_md),
                    ("cnipa_prior_art_notes", result.prior_art_md),
                    ("disclosure_md", result.disclosure_md),
                    ("disclosure_docx", result.disclosure_docx),
                    ("self_check", result.self_check_md),
                ],
                warnings=result.warnings,
            )
            self._set_job_done(job_id, case["id"], artifact_ids, result.warnings)
        except PatentLlmError as exc:
            self._set_job_failed(job_id, case["id"], str(exc), code=exc.code)
        except Exception as exc:
            logger.exception("Patent disclosure generation failed job_id=%s", job_id)
            self._set_job_failed(job_id, case["id"], str(exc) or "生成失败。")
        finally:
            SSE_BROKER.close(job_id)

    def _update_parsed_materials(self, parsed_materials: list[dict[str, str]]) -> None:
        if not parsed_materials:
            return
        try:
            with get_engine().begin() as conn:
                for item in parsed_materials:
                    material_id = item.get("id")
                    if not material_id:
                        continue
                    conn.execute(
                        text(
                            """
                            UPDATE patent_disclosure.materials
                            SET parse_status = :parse_status,
                                parsed_text_path = NULLIF(:parsed_text_path, '')
                            WHERE id = :material_id
                            """
                        ),
                        {
                            "material_id": material_id,
                            "parse_status": item.get("status") or "parsed",
                            "parsed_text_path": item.get("parsed_text_path") or "",
                        },
                    )
        except SQLAlchemyError:
            logger.exception("Failed to update parsed material status")

    def _set_job_progress(self, job_id: str, status: str, step: str, progress: int, message: str) -> None:
        progress = max(0, min(100, int(progress)))
        try:
            with get_engine().begin() as conn:
                conn.execute(
                    text(
                        """
                        UPDATE patent_disclosure.jobs
                        SET status = :status, step = :step, progress = :progress,
                            updated_at = now()
                        WHERE id = :job_id
                        """
                    ),
                    {"job_id": job_id, "status": status, "step": step, "progress": progress},
                )
                conn.execute(
                    text(
                        """
                        UPDATE core.jobs
                        SET status = :status, progress = :progress, updated_at = now()
                        WHERE id = (SELECT core_job_id FROM patent_disclosure.jobs WHERE id = :job_id)
                        """
                    ),
                    {"job_id": job_id, "status": status, "progress": progress},
                )
        except SQLAlchemyError:
            logger.exception("Failed to update patent job progress job_id=%s", job_id)
        event = {"status": status, "step": step, "progress": progress, "message": message}
        SSE_BROKER.publish(job_id, event)

    def _set_job_done(self, job_id: str, case_id: str, artifact_ids: list[str], warnings: list[str]) -> None:
        output = {"artifactIds": artifact_ids, "warnings": warnings}
        try:
            with get_engine().begin() as conn:
                conn.execute(
                    text(
                        """
                        UPDATE patent_disclosure.jobs
                        SET status = 'succeeded', step = 'succeeded', progress = 100,
                            output = CAST(:output AS jsonb), updated_at = now(), finished_at = now()
                        WHERE id = :job_id
                        """
                    ),
                    {"job_id": job_id, "output": _json_dumps(output)},
                )
                conn.execute(
                    text(
                        """
                        UPDATE core.jobs
                        SET status = 'succeeded', progress = 100, output = CAST(:output AS jsonb),
                            updated_at = now(), finished_at = now()
                        WHERE id = (SELECT core_job_id FROM patent_disclosure.jobs WHERE id = :job_id)
                        """
                    ),
                    {"job_id": job_id, "output": _json_dumps(output)},
                )
                conn.execute(
                    text("UPDATE patent_disclosure.cases SET status = 'succeeded', updated_at = now() WHERE id = :case_id"),
                    {"case_id": case_id},
                )
        except SQLAlchemyError:
            logger.exception("Failed to mark patent job succeeded job_id=%s", job_id)
        SSE_BROKER.publish(
            job_id,
            {"_event": "done", "status": "succeeded", "step": "succeeded", "progress": 100, "artifactIds": artifact_ids},
        )

    def _set_job_failed(self, job_id: str, case_id: str, message: str, *, code: str = "PATENT_GENERATION_FAILED") -> None:
        safe_message = message[:2000] or "生成失败。"
        try:
            with get_engine().begin() as conn:
                conn.execute(
                    text(
                        """
                        UPDATE patent_disclosure.jobs
                        SET status = 'failed', step = 'failed', progress = 100,
                            error_message = :error_message, updated_at = now(), finished_at = now()
                        WHERE id = :job_id
                        """
                    ),
                    {"job_id": job_id, "error_message": safe_message},
                )
                conn.execute(
                    text(
                        """
                        UPDATE core.jobs
                        SET status = 'failed', progress = 100, error_message = :error_message,
                            updated_at = now(), finished_at = now()
                        WHERE id = (SELECT core_job_id FROM patent_disclosure.jobs WHERE id = :job_id)
                        """
                    ),
                    {"job_id": job_id, "error_message": safe_message},
                )
                conn.execute(
                    text("UPDATE patent_disclosure.cases SET status = 'failed', updated_at = now() WHERE id = :case_id"),
                    {"case_id": case_id},
                )
        except SQLAlchemyError:
            logger.exception("Failed to mark patent job failed job_id=%s", job_id)
        SSE_BROKER.publish(
            job_id,
            {"_event": "error", "status": "failed", "step": "failed", "progress": 100, "message": safe_message, "code": code},
        )

    def _save_pipeline_artifacts(
        self,
        *,
        case_id: str,
        job_id: str,
        version_no: int,
        paths: list[tuple[str, Path]],
        warnings: list[str],
    ) -> list[str]:
        artifact_ids: list[str] = []
        try:
            with get_engine().begin() as conn:
                for artifact_type, path in paths:
                    if artifact_type not in ALLOWED_ARTIFACT_TYPES or not path.is_file():
                        continue
                    mime_type = _artifact_mime(artifact_type, path.name)
                    core_file_id = conn.execute(
                        text(
                            """
                            INSERT INTO core.files (
                              module_code, filename, storage_backend, storage_path,
                              mime_type, size_bytes, metadata
                            )
                            VALUES (
                              :module_code, :filename, 'local', :storage_path,
                              :mime_type, :size_bytes, CAST(:metadata AS jsonb)
                            )
                            RETURNING id
                            """
                        ),
                        {
                            "module_code": MODULE_CODE,
                            "filename": path.name,
                            "storage_path": str(path),
                            "mime_type": mime_type,
                            "size_bytes": path.stat().st_size,
                            "metadata": _json_dumps({"warnings": warnings}),
                        },
                    ).scalar_one()
                    artifact_id = conn.execute(
                        text(
                            """
                            INSERT INTO patent_disclosure.artifacts (
                              case_id, job_id, core_file_id, artifact_type, version_no,
                              filename, storage_path, mime_type, size_bytes, metadata
                            )
                            VALUES (
                              :case_id, :job_id, :core_file_id, :artifact_type, :version_no,
                              :filename, :storage_path, :mime_type, :size_bytes, CAST(:metadata AS jsonb)
                            )
                            RETURNING id
                            """
                        ),
                        {
                            "case_id": case_id,
                            "job_id": job_id,
                            "core_file_id": str(core_file_id),
                            "artifact_type": artifact_type,
                            "version_no": version_no,
                            "filename": path.name,
                            "storage_path": str(path),
                            "mime_type": mime_type,
                            "size_bytes": path.stat().st_size,
                            "metadata": _json_dumps({"warnings": warnings}),
                        },
                    ).scalar_one()
                    artifact_ids.append(str(artifact_id))
        except SQLAlchemyError as exc:
            raise _db_error(exc) from exc
        latest = self.file_store.case_root(case_id) / "outputs" / "latest"
        try:
            if latest.exists() or latest.is_symlink():
                if latest.is_dir() and not latest.is_symlink():
                    shutil.rmtree(latest)
                else:
                    latest.unlink()
            latest.symlink_to(self.file_store.output_dir(case_id, version_no), target_is_directory=True)
        except OSError:
            pass
        return artifact_ids

    def _get_case_for_user(self, user: dict[str, Any], case_id: str) -> dict[str, Any]:
        if not _is_uuid(case_id):
            raise PlatformError(code="PATENT_CASE_NOT_FOUND", message="案件不存在。", status_code=404)
        try:
            with get_engine().begin() as conn:
                row = conn.execute(
                    text("SELECT * FROM patent_disclosure.cases WHERE id = :case_id"),
                    {"case_id": case_id},
                ).mappings().first()
        except SQLAlchemyError as exc:
            raise _db_error(exc) from exc
        if not row:
            raise PlatformError(code="PATENT_CASE_NOT_FOUND", message="案件不存在。", status_code=404)
        self._assert_owner(user, row.get("owner_user_id"))
        return _case_from_row(row)

    def _assert_owner(self, user: dict[str, Any], owner_user_id: Any) -> None:
        if user.get("role") == "admin":
            return
        if str(owner_user_id or "") != str(_user_id(user) or ""):
            raise PlatformError(code="PATENT_PERMISSION_DENIED", message="当前用户没有访问该案件的权限。", status_code=403)

    def _case_material_size(self, case_id: str) -> int:
        try:
            with get_engine().begin() as conn:
                return int(
                    conn.execute(
                        text("SELECT COALESCE(SUM(size_bytes), 0) FROM patent_disclosure.materials WHERE case_id = :case_id"),
                        {"case_id": case_id},
                    ).scalar_one()
                )
        except SQLAlchemyError as exc:
            raise _db_error(exc) from exc

    def _materials_for_case(self, case_id: str) -> list[dict[str, Any]]:
        try:
            with get_engine().begin() as conn:
                rows = conn.execute(
                    text("SELECT * FROM patent_disclosure.materials WHERE case_id = :case_id ORDER BY created_at ASC"),
                    {"case_id": case_id},
                ).mappings().all()
        except SQLAlchemyError as exc:
            raise _db_error(exc) from exc
        return [_material_internal_from_row(row) for row in rows]

    def _latest_job(self, case_id: str) -> dict[str, Any] | None:
        try:
            with get_engine().begin() as conn:
                row = conn.execute(
                    text(
                        """
                        SELECT *
                        FROM patent_disclosure.jobs
                        WHERE case_id = :case_id
                        ORDER BY created_at DESC
                        LIMIT 1
                        """
                    ),
                    {"case_id": case_id},
                ).mappings().first()
        except SQLAlchemyError as exc:
            raise _db_error(exc) from exc
        return _job_from_row(row) if row else None

    def _next_version(self, case_id: str) -> int:
        try:
            with get_engine().begin() as conn:
                return int(
                    conn.execute(
                        text(
                            "SELECT COALESCE(MAX(version_no), 0) + 1 FROM patent_disclosure.artifacts WHERE case_id = :case_id"
                        ),
                        {"case_id": case_id},
                    ).scalar_one()
                )
        except SQLAlchemyError as exc:
            raise _db_error(exc) from exc


def _case_from_row(row: Any) -> dict[str, Any]:
    metadata = _json_loads_dict(row.get("metadata"))
    return {
        "id": str(row["id"]),
        "title": row.get("title") or "",
        "technicalTopic": row.get("technical_topic") or "",
        "applicant": row.get("applicant") or "",
        "projectName": row.get("project_name") or "",
        "description": row.get("description") or "",
        "status": row.get("status") or "draft",
        "anonymize": bool(row.get("anonymize")),
        "metadata": metadata,
        "createdAt": _to_iso(row.get("created_at")),
        "updatedAt": _to_iso(row.get("updated_at")),
    }


def _case_list_item_from_row(row: Any) -> dict[str, Any]:
    case = _case_from_row(row)
    return {
        **case,
        "materialCount": int(row.get("material_count") or 0),
        "artifactCount": int(row.get("artifact_count") or 0),
        "latestJobStatus": row.get("latest_job_status"),
    }


def _material_from_row(row: Any) -> dict[str, Any]:
    return {
        "id": str(row["id"]),
        "caseId": str(row["case_id"]),
        "filename": row.get("filename") or "",
        "fileName": row.get("filename") or "",
        "materialType": row.get("material_type") or "source",
        "storagePath": "",
        "mimeType": row.get("mime_type"),
        "sizeBytes": int(row.get("size_bytes") or 0),
        "fileSize": int(row.get("size_bytes") or 0),
        "parseStatus": row.get("parse_status") or "pending",
        "parsedTextPath": "",
        "metadata": _json_loads_dict(row.get("metadata")),
        "createdAt": _to_iso(row.get("created_at")),
    }


def _material_internal_from_row(row: Any) -> dict[str, Any]:
    item = _material_from_row(row)
    item["storage_path"] = row.get("storage_path")
    item["parsed_text_path"] = row.get("parsed_text_path")
    return item


def _job_from_row(row: Any) -> dict[str, Any]:
    return {
        "id": str(row["id"]),
        "caseId": str(row["case_id"]),
        "status": row.get("status") or "pending",
        "step": row.get("step") or "pending",
        "currentStep": row.get("step") or "pending",
        "progress": int(row.get("progress") or 0),
        "input": _json_loads_dict(row.get("input")),
        "output": _json_loads_dict(row.get("output")),
        "errorMessage": row.get("error_message"),
        "createdAt": _to_iso(row.get("created_at")),
        "updatedAt": _to_iso(row.get("updated_at")),
        "finishedAt": _to_iso(row.get("finished_at")),
    }


def _artifact_from_row(row: Any) -> dict[str, Any]:
    artifact_type = row.get("artifact_type") or ""
    filename = row.get("filename") or ""
    return {
        "id": str(row["id"]),
        "caseId": str(row["case_id"]),
        "jobId": str(row["job_id"]) if row.get("job_id") else None,
        "artifactType": artifact_type,
        "kind": _artifact_kind(artifact_type),
        "versionNo": int(row.get("version_no") or 1),
        "filename": filename,
        "name": filename,
        "mimeType": row.get("mime_type") or _artifact_mime(artifact_type, filename),
        "sizeBytes": int(row.get("size_bytes") or 0),
        "size": int(row.get("size_bytes") or 0),
        "metadata": _json_loads_dict(row.get("metadata")),
        "createdAt": _to_iso(row.get("created_at")),
    }


def _artifact_kind(artifact_type: str) -> str:
    return {
        "disclosure_md": "markdown",
        "disclosure_docx": "docx",
        "cnipa_prior_art_notes": "prior_art",
        "patent_points": "patent_points",
        "self_check": "self_check",
    }.get(artifact_type, artifact_type)


def _job_event(job: dict[str, Any]) -> dict[str, Any]:
    return {
        "status": job["status"],
        "step": job["step"],
        "currentStep": job["step"],
        "progress": job["progress"],
        "message": job.get("errorMessage") or "",
        "artifactIds": job.get("output", {}).get("artifactIds", []),
    }


def _sse(event: str, payload: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"


def get_patent_disclosure_service() -> PatentDisclosureService:
    return PatentDisclosureService()
