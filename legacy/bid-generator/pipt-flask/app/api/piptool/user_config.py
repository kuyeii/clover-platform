# -- coding: utf-8 --
# @Time : 2025/2/28 15:56
# @Author : Yao Sicheng
import math

import yaml
from flask import Blueprint, g, current_app
from sqlalchemy import text

from app.api import api, AuthorizationBearerSecurity
from app.api.piptool.exception import RuleNotFound
from app.api.piptool.model.rule import Rule
from app.api.piptool.schema import RuleSchemaList, RuleOutSchema, RuleInSchema, RulePageSchema, UserConfigOutSchema, \
    UserConfigInSchema
from app.api.piptool.schema.rule import RuleQuerySearchSchema
from app.lin import DocResponse, permission_meta, Logger, group_required, Success, NotFound

user_config_api = Blueprint("user_config", __name__)


@user_config_api.route('', methods=['GET'])
@api.validate(
    resp=DocResponse(NotFound("配置不存在"), r=UserConfigOutSchema),
    tags=["用户配置"],
)
def get_all_user_config():
    """
    获取配置
    """
    with open('app/config/config.yaml', encoding='utf-8') as file:
        user_config = yaml.load(file, Loader=yaml.SafeLoader)
    return user_config

@user_config_api.route("", methods=["PUT"])
@permission_meta(name="配置管理", module="用户配置")
@Logger(template='{user.username}修改了配置。') # 推送的消息
@group_required
@api.validate(
    resp=DocResponse(Success(73)),
    tags=["用户配置"],
    security=[AuthorizationBearerSecurity]
)
def update_rule(json: UserConfigInSchema):
    """
    更新配置信息，传入一个字典，将其保存到app/config/config.yaml中
    """
    # 将Pydantic模型转换为可序列化的字典
    config_data = json.dict()

    # 写入配置文件
    with open("app/config/config.yaml", 'w', encoding='utf-8') as file:
        yaml.dump(
            config_data,
            file,
            allow_unicode=True,  # 允许中文字符
            sort_keys=False,  # 保持键的顺序
            default_flow_style=False  # 使用块样式
        )
    current_app.config['USER_CONFIG'] = config_data
    return Success(73)
