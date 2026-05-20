# -*- coding: utf-8 -*-
"""
项目数据 REST API — 替代前端 localStorage
提供项目 CRUD 接口，数据持久化到 PostgreSQL
"""

import json
import logging
from datetime import datetime, timezone
from typing import Optional, Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .database import get_db, ProjectRecord

logger = logging.getLogger("project-api")
router = APIRouter(prefix="/projects", tags=["projects"])


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


# ── Pydantic 模型 ──────────────────────────────────

class ProjectCreate(BaseModel):
    """创建项目请求体"""
    id: str
    name: str
    status: str = "uploading"
    data: dict  # 完整 Project JSON

class ProjectUpdate(BaseModel):
    """更新项目请求体（部分更新）"""
    name: Optional[str] = None
    status: Optional[str] = None
    data: Optional[dict] = None


class ProjectPatch(BaseModel):
    """字段级增量更新请求体（避免整对象覆盖）"""
    name: Optional[str] = None
    status: Optional[str] = None
    data_patch: dict[str, Any] = Field(default_factory=dict)
    remove_data_keys: list[str] = Field(default_factory=list)

class ProjectResponse(BaseModel):
    """项目响应"""
    id: str
    name: str
    status: str
    data: dict
    created_at: str
    updated_at: str


# ── CRUD 接口 ──────────────────────────────────

@router.get("")
def list_projects(db: Session = Depends(get_db)):
    """获取所有项目（按创建时间倒序）"""
    records = db.query(ProjectRecord).order_by(ProjectRecord.created_at.desc()).all()
    return [_to_response(r) for r in records]


@router.get("/{project_id}")
def get_project(project_id: str, db: Session = Depends(get_db)):
    """获取单个项目"""
    record = db.query(ProjectRecord).filter(ProjectRecord.id == project_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="项目不存在")
    return _to_response(record)


@router.post("", status_code=201)
def create_project(body: ProjectCreate, db: Session = Depends(get_db)):
    """创建项目"""
    existing = db.query(ProjectRecord).filter(ProjectRecord.id == body.id).first()
    if existing:
        raise HTTPException(status_code=409, detail="项目 ID 已存在")

    record = ProjectRecord(
        id=body.id,
        name=body.name,
        status=body.status,
        data=json.dumps(body.data, ensure_ascii=False),
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    logger.info(f"项目已创建: {body.id} ({body.name})")
    return _to_response(record)


@router.put("/{project_id}")
def update_project(project_id: str, body: ProjectUpdate, db: Session = Depends(get_db)):
    """更新项目（不存在则自动创建，upsert 模式）"""
    record = db.query(ProjectRecord).filter(ProjectRecord.id == project_id).first()

    if not record:
        # 项目不存在：自动创建（前端 localStorage 先行，后端需兜底）
        data = body.data or {}
        record = ProjectRecord(
            id=project_id,
            name=body.name or data.get("name", project_id),
            status=body.status or "uploaded",
            data=json.dumps(data, ensure_ascii=False),
        )
        db.add(record)
        db.commit()
        db.refresh(record)
        logger.info(f"项目自动创建（upsert）: {project_id}")
        return _to_response(record)

    if body.name is not None:
        record.name = body.name
    if body.status is not None:
        record.status = body.status
    if body.data is not None:
        record.data = json.dumps(body.data, ensure_ascii=False)

    record.updated_at = _utc_now()
    db.commit()
    db.refresh(record)
    return _to_response(record)


def _deep_merge_dict(base: dict[str, Any], patch: dict[str, Any]) -> dict[str, Any]:
    """递归合并字典：patch 优先，避免前端旧快照整对象覆盖。"""
    result = dict(base or {})
    for key, value in (patch or {}).items():
        if (
            key in result
            and isinstance(result.get(key), dict)
            and isinstance(value, dict)
        ):
            result[key] = _deep_merge_dict(result[key], value)
        else:
            result[key] = value
    return result


@router.patch("/{project_id}")
def patch_project(project_id: str, body: ProjectPatch, db: Session = Depends(get_db)):
    """字段级 patch 更新，服务端合并 data，避免整对象回写导致状态回退。"""
    record = db.query(ProjectRecord).filter(ProjectRecord.id == project_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="项目不存在")

    data = json.loads(record.data or "{}")
    if body.name is not None:
        record.name = body.name
        data["name"] = body.name
    if body.status is not None:
        record.status = body.status
        data["status"] = body.status

    if body.data_patch:
        if not isinstance(body.data_patch, dict):
            raise HTTPException(status_code=400, detail="data_patch 必须是对象")
        data = _deep_merge_dict(data, body.data_patch)

    if body.remove_data_keys:
        for key in body.remove_data_keys:
            if isinstance(key, str) and key:
                data.pop(key, None)

    record.data = json.dumps(data, ensure_ascii=False)
    record.updated_at = _utc_now()
    db.commit()
    db.refresh(record)
    return _to_response(record)


@router.delete("/{project_id}", status_code=204)
def delete_project(project_id: str, db: Session = Depends(get_db)):
    """删除项目"""
    record = db.query(ProjectRecord).filter(ProjectRecord.id == project_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="项目不存在")
    db.delete(record)
    db.commit()
    logger.info(f"项目已删除: {project_id}")
    return None


@router.get("/{project_id}/mappings")
def get_project_mappings(project_id: str, db: Session = Depends(get_db)):
    """获取项目的占位符映射表（用于前端反映射显示原文）"""
    record = db.query(ProjectRecord).filter(ProjectRecord.id == project_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="项目不存在")
    data = json.loads(record.data) if isinstance(record.data, str) else record.data
    mapping_table = data.get("mappingTable", {})
    return {"mappings": mapping_table, "count": len(mapping_table)}


@router.post("/batch", status_code=201)
def batch_create_projects(projects: list[ProjectCreate], db: Session = Depends(get_db)):
    """批量创建项目（用于 localStorage → PostgreSQL 同步）"""
    created = 0
    for proj in projects:
        existing = db.query(ProjectRecord).filter(ProjectRecord.id == proj.id).first()
        if existing:
            # 已存在则更新
            existing.name = proj.name
            existing.status = proj.status
            existing.data = json.dumps(proj.data, ensure_ascii=False)
            existing.updated_at = _utc_now()
        else:
            record = ProjectRecord(
                id=proj.id,
                name=proj.name,
                status=proj.status,
                data=json.dumps(proj.data, ensure_ascii=False),
            )
            db.add(record)
            created += 1
    db.commit()
    logger.info(f"批量导入完成: {created} 新建, {len(projects) - created} 更新")
    return {"created": created, "updated": len(projects) - created}


# ── 工具函数 ──────────────────────────────────

def _to_response(record: ProjectRecord) -> dict:
    """将数据库记录转为 API 响应对象"""
    data = json.loads(record.data) if isinstance(record.data, str) else record.data
    return {
        "id": record.id,
        "name": record.name,
        "status": record.status,
        "data": data,
        "created_at": record.created_at.isoformat() if record.created_at else "",
        "updated_at": record.updated_at.isoformat() if record.updated_at else "",
    }
