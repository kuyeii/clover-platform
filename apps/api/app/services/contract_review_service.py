from __future__ import annotations

import os
from pathlib import Path

from app.core.config import get_api_settings

DEFAULT_ANALYSIS_SCOPE = "full_detail"

ANALYSIS_SCOPE_ALIASES: dict[str, str] = {
    "": DEFAULT_ANALYSIS_SCOPE,
    "all": "full_detail",
    "all_detail": "full_detail",
    "all_detailed": "full_detail",
    "detail": "full_detail",
    "detailed": "full_detail",
    "full": "full_detail",
    "full_detail": "full_detail",
    "full_detailed": "full_detail",
    "high": "high_risk_only",
    "high_only": "high_risk_only",
    "high_risk": "high_risk_only",
    "high_risk_only": "high_risk_only",
    "only_high": "high_risk_only",
}
ANALYSIS_SCOPE_LABELS: dict[str, str] = {
    "full_detail": "深度审查",
    "high_risk_only": "仅高风险",
}
REVIEW_SIDE_MAPPING: dict[str, str] = {
    "supplier": "乙方",
    "vendor": "乙方",
    "party_b": "乙方",
    "乙方": "乙方",
    "customer": "甲方",
    "buyer": "甲方",
    "party_a": "甲方",
    "甲方": "甲方",
}


def _normalize_analysis_scope(value: str | None, default: str = DEFAULT_ANALYSIS_SCOPE) -> str:
    raw = str(value or "").strip().lower()
    normalized_default = ANALYSIS_SCOPE_ALIASES.get(str(default or "").strip().lower(), DEFAULT_ANALYSIS_SCOPE)
    return ANALYSIS_SCOPE_ALIASES.get(raw, normalized_default)


def _analysis_scope_label(value: str | None) -> str:
    scope = _normalize_analysis_scope(value)
    return ANALYSIS_SCOPE_LABELS.get(scope, ANALYSIS_SCOPE_LABELS[DEFAULT_ANALYSIS_SCOPE])


def _normalize_review_side(value: str | None) -> str:
    raw = str(value or "").strip()
    return REVIEW_SIDE_MAPPING.get(raw.lower(), REVIEW_SIDE_MAPPING.get(raw, "")) or "乙方"


def _env_value(name: str, default: str = "") -> str:
    value = os.getenv(name, "").strip()
    if value:
        return value

    repo_root = get_api_settings().repo_root
    for env_path in (repo_root / ".env", repo_root / "legacy" / "contract_review" / ".env"):
        parsed = _read_env_file_value(env_path, name)
        if parsed:
            return parsed
    return default


def _read_env_file_value(env_path: Path, name: str) -> str:
    try:
        if not env_path.exists():
            return ""
        with env_path.open("r", encoding="utf-8") as file:
            for raw_line in file:
                line = raw_line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, value = line.split("=", 1)
                if key.strip() == name:
                    return value.strip().strip('"').strip("'")
    except OSError:
        return ""
    return ""


def get_health_payload() -> dict[str, str]:
    return {"status": "ok"}


def get_config_payload() -> dict[str, str]:
    analysis_scope = _normalize_analysis_scope(_env_value("ANALYSIS_SCOPE", "full_detail"))
    return {
        "review_side": _normalize_review_side(_env_value("REVIEW_SIDE")),
        "contract_type_hint": _env_value("CONTRACT_TYPE_HINT", "service_agreement"),
        "analysis_scope": analysis_scope,
        "analysis_scope_label": _analysis_scope_label(analysis_scope),
    }
