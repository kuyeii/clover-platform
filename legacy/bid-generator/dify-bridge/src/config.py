from typing import Optional
# -*- coding: utf-8 -*-
"""
Dify API 配置
"""

from dataclasses import dataclass, field
from pathlib import Path

import yaml


@dataclass
class DifyConfig:
    """Dify 平台连接配置"""
    base_url: str = "http://localhost:3000/v1"
    api_key: str = ""
    knowledge_base_id: str = ""
    workflow_id: str = ""
    timeout: int = 120
    max_retries: int = 3

    @classmethod
    def from_yaml(cls, config_path: str) -> "DifyConfig":
        """从全局 config.yaml 加载 Dify 配置段"""
        path = Path(config_path)
        if not path.exists():
            return cls()
        with open(path, "r", encoding="utf-8") as f:
            raw = yaml.safe_load(f) or {}
        dify_raw = raw.get("dify", {})
        return cls(**{k: v for k, v in dify_raw.items() if k in cls.__dataclass_fields__})
