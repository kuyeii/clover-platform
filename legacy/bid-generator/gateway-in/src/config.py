# -*- coding: utf-8 -*-
"""
gateway-in 配置管理
从全局 config.yaml 加载入口网关相关配置
"""

from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

import yaml


@dataclass
class PiptConfig:
    """pipt-flask 脱敏服务配置"""
    base_url: str = "http://localhost:5000"
    timeout: int = 30
    target_entities: list[str] = field(default_factory=lambda: [
        "name", "phone", "id_number", "email", "addr", "bank", "car_id", "ip", "org"
    ])
    desensitize_method: str = "mask"
    placeholder_format: str = "{{__PIPT_{type}_{index}__}}"


@dataclass
class ParsingConfig:
    """文件解析配置"""
    supported_formats: list[str] = field(default_factory=lambda: [".pdf", ".docx", ".doc", ".html"])
    max_file_size_mb: int = 100


@dataclass
class SecurityConfig:
    """安全等级配置"""
    default_tier: int = 1
    tier2_keywords: list[str] = field(default_factory=lambda: ["内部", "机密", "财务"])
    strip_images_for_tier2: bool = True
    tier_mapping: dict = field(default_factory=dict)


@dataclass
class GatewayInConfig:
    """入口网关总配置"""
    pipt: PiptConfig = field(default_factory=PiptConfig)
    parsing: ParsingConfig = field(default_factory=ParsingConfig)
    security: SecurityConfig = field(default_factory=SecurityConfig)

    @classmethod
    def from_yaml(cls, config_path: str) -> "GatewayInConfig":
        """从 YAML 配置文件加载"""
        path = Path(config_path)
        if not path.exists():
            return cls()

        with open(path, "r", encoding="utf-8") as f:
            raw = yaml.safe_load(f) or {}

        pipt_raw = raw.get("pipt", {})
        parsing_raw = raw.get("parsing", {})
        security_raw = raw.get("security", {})

        return cls(
            pipt=PiptConfig(**{k: v for k, v in pipt_raw.items() if k in PiptConfig.__dataclass_fields__}),
            parsing=ParsingConfig(**{k: v for k, v in parsing_raw.items() if k in ParsingConfig.__dataclass_fields__}),
            security=SecurityConfig(**{k: v for k, v in security_raw.items() if k in SecurityConfig.__dataclass_fields__}),
        )
