import math

from flask import Blueprint, g
from sqlalchemy import text

from app.api import AuthorizationBearerSecurity, api
from app.api.piptool.model.system_logger import SystemLog
from app.api.piptool.schema.system_log import SystemLogPageSchema, SystemLogQuerySearchSchema
from app.lin import DocResponse, group_required, permission_meta

system_log_api = Blueprint("system_log_api", __name__)


@system_log_api.route("")
@permission_meta(name="查询系统运行日志", module="系统运行日志管理")
@group_required
@api.validate(
    resp=DocResponse(r=SystemLogPageSchema),
    before=SystemLogQuerySearchSchema.offset_handler,
    security=[AuthorizationBearerSecurity],
    tags=["系统日志"],
)
def get_logs(query: SystemLogQuerySearchSchema):
    """
    日志浏览查询（人员，时间, 关键字），分页展示
    """
    system_logs = SystemLog.query.filter()
    total = system_logs.count()
    items = system_logs.order_by(text("create_time desc")).offset(g.offset).limit(g.count).all()
    total_page = math.ceil(total / g.count)
    return SystemLogPageSchema(
        page=g.page,
        count=g.count,
        total=total,
        items=items,
        total_page=total_page,
    )


@system_log_api.route("/search")
@permission_meta(name="搜索系统运行日志", module="系统运行日志管理")
@group_required
@api.validate(
    resp=DocResponse(r=SystemLogPageSchema),
    security=[AuthorizationBearerSecurity],
    before=SystemLogQuerySearchSchema.offset_handler,
    tags=["系统日志"],
)
def search_logs(query: SystemLogQuerySearchSchema):
    """
    日志搜索（人员，时间, 关键字），分页展示
    """
    if g.keyword:
        system_logs = SystemLog.query.filter(SystemLog.message.like(f"%{g.keyword}%"))
    else:
        system_logs = SystemLog.query.filter()
    if g.start and g.end:
        system_logs = system_logs.filter(SystemLog.create_time.between(g.start, g.end))
    if g.level:
        system_logs = system_logs.filter(SystemLog.level == g.level)

    total = system_logs.count()
    items = system_logs.order_by(text("create_time desc")).offset(g.offset).limit(g.count).all()

    total_page = math.ceil(total / g.count)

    return SystemLogPageSchema(
        page=g.page,
        count=g.count,
        total=total,
        items=items,
        total_page=total_page,
    )
