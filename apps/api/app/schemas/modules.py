from __future__ import annotations

from pydantic import BaseModel


class ModuleDevInfo(BaseModel):
    kind: str
    enabled: bool


class ModuleInfo(BaseModel):
    code: str
    module_key: str
    name: str
    description: str
    enabled: bool
    route_path: str
    target_api_prefix: str
    iframe_enabled: bool
    permission_default: bool
    dev: ModuleDevInfo
    legacy_health_check: str
    storage_namespace: str

