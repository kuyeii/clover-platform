# -- coding: utf-8 --
# @Time : 2025/2/28 15:56
# @Author : Yao Sicheng
from datetime import datetime

from flask import Blueprint, current_app
from sqlalchemy import text

from app.api import api
from app.api.piptool.model.system_logger import SystemLog
from app.api.piptool.schema import SystemUsage
from app.lin import DocResponse
from app.util.status_code import WARN, USAGE
from app.util.tool import get_cpu_usage, get_memory_usage

system_usage_api = Blueprint("system_usage", __name__)


@system_usage_api.route('', methods=['GET'])
@api.validate(
    resp=DocResponse(r=SystemUsage),
    tags=["系统监控"],
)
def system_usage():
    """系统资源使用率接口"""
    user_config = current_app.config.get('USER_CONFIG')
    cooldown_seconds = user_config.get('cooldown_seconds')
    cpu_usage_warning = user_config.get('cpu_usage_warning')
    mem_usage_warning = user_config.get('memory_usage_warning')
    cpu_usage = int(get_cpu_usage())
    mem_usage = int(get_memory_usage())
    system_logs = SystemLog.query.filter_by(type=USAGE).order_by(text("create_time desc")).first()
    # 补全代码
    # 计算最近的关于usage的日志的创建时间是否与现在的差值超过了1小时
    if cooldown_seconds == 0:
        should_log = False
    elif system_logs:
        # 计算上次预警到现在的时间差
        time_diff = (datetime.now() - system_logs.create_time).total_seconds()
        should_log = time_diff > cooldown_seconds
    else:
        # 如果没有找到历史预警日志，则记录新日志
        should_log = True

    if should_log and (cpu_usage > cpu_usage_warning or mem_usage > mem_usage_warning):
        SystemLog.create_log(
            message=f"系统资源预警：CPU占用：{cpu_usage}%，内存占用：{mem_usage}%。",
            level=WARN,
            type=USAGE,
            commit=True,
        )
    return {
        'cpu_usage_percent': cpu_usage,
        'memory_usage_percent': mem_usage,
    }
