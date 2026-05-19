import os

import yaml

from .base import BaseConfig


class DevelopmentConfig(BaseConfig):
    """
    开发环境配置
    """

    """
    开发环境配置
    """
    CELERY_BROKER_URL = os.getenv("CELERY_BROKER_URL")
    RESULT_BACKEND = os.getenv("RESULT_BACKEND")
    PIPT_ASSETS = os.getenv("PIPT_ASSETS")
    with open('app/config/config.yaml', encoding='utf-8') as file:
        USER_CONFIG = yaml.load(file, Loader=yaml.SafeLoader)
