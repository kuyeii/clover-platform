# -- coding: utf-8 --
# @Time : 2025/2/28 15:56
# @Author : Yao Sicheng
import math

from flask import Blueprint, g
from sqlalchemy import text

from app.api import api, AuthorizationBearerSecurity
from app.api.piptool.exception import RuleNotFound
from app.api.piptool.model.rule_risk import RuleRisk
from app.api.piptool.schema import RuleRiskSchemaList, RuleRiskOutSchema, RuleRiskInSchema, RuleRiskPageSchema
from app.api.piptool.schema.rule_risk import RuleRiskQuerySearchSchema
from app.lin import DocResponse, permission_meta, Logger, group_required, Success, NotFound

rule_risk_api = Blueprint("rule_risk", __name__)


@rule_risk_api.route('all', methods=['GET'])
@api.validate(
    resp=DocResponse(RuleNotFound, r=RuleRiskSchemaList),
    tags=["风险规则"],
)
def get_all_rules():
    """
    获取所有规则
    """
    rules = RuleRisk.get(one=False)
    return rules

@rule_risk_api.route('<int:id>', methods=['GET'])
@api.validate(
    resp=DocResponse(RuleNotFound, r=RuleRiskOutSchema),
    tags=["风险规则"]
)
def get_rule(id):
    """
    要报id获取规则
    """
    rule = RuleRisk.query.filter_by(id=id).first()
    if rule:
        return rule
    raise RuleNotFound


@rule_risk_api.route("/<int:id>", methods=['DELETE'])
@permission_meta(name="删除风险规则模板", module="风险规则管理")
@Logger(template='{user.username}删除了一组风险规则模板。') # 推送的消息
@group_required
@api.validate(
    resp=DocResponse(Success(42)),
    tags=["风险规则"],
    security=[AuthorizationBearerSecurity]
)
def delete_rule(id):
    """
    根据id删除规则
    """
    rule = RuleRisk.get(id=id)
    if rule:
        rule.delete(commit=True)
        return Success(42)

@rule_risk_api.route("/<int:id>", methods=["PUT"])
@permission_meta(name="修改风险规则模板", module="风险规则管理")
@Logger(template='{user.username}修改了一组风险规则模板。') # 推送的消息
@group_required
@api.validate(
    resp=DocResponse(Success(43)),
    tags=["风险规则"],
    security=[AuthorizationBearerSecurity]
)
def update_rule(id, json: RuleRiskInSchema):
    """
    更新规则信息
    """
    rule = RuleRisk.get(id=id)
    if rule:
        rule.update(
            id=id,
            **json.dict(),
            commit=True,
        )
        return Success(43)
    raise NotFound("规则不存在")

@rule_risk_api.route("", methods=["POST"])
@permission_meta(name="创建风险规则模板", module="风险规则管理")
@Logger(template='{user.username}创建了一个风险规则模板。') # 推送的消息
@group_required
@api.validate(
    resp=DocResponse(Success(41)),
    security=[AuthorizationBearerSecurity],
    tags=["风险规则"],
)
def create_rule(json: RuleRiskInSchema):
    """
    创建规则
    """
    RuleRisk.create(**json.dict(), commit=True)
    return Success(41)

@rule_risk_api.route("")
@api.validate(
    tags=["风险规则"],
    before=RuleRiskQuerySearchSchema.offset_handler,
    resp=DocResponse(r=RuleRiskPageSchema),
)
def get_rule_page(query: RuleRiskQuerySearchSchema):

    """
    规则分页展示
    """
    rule = RuleRisk.query.filter_by(is_deleted=False)
    total = rule.count()
    items = rule.filter_by(is_deleted=False).order_by(text("create_time asc")).offset(g.offset).limit(g.count).all()
    total_page = math.ceil(total / g.count)

    return RuleRiskPageSchema(
        page=g.page,
        count=g.count,
        total=total,
        items=items,
        total_page=total_page,
    )

@rule_risk_api.route("/search")
@api.validate(
    resp=DocResponse(r=RuleRiskPageSchema),
    before=RuleRiskQuerySearchSchema.offset_handler,
    tags=["风险规则"],
)
def search_rules(query: RuleRiskQuerySearchSchema):
    """
    数据源搜索（关键字），分页展示
    """
    if g.keyword:
        rule = RuleRisk.query.filter(RuleRisk.field.like(f"%{g.keyword}%"))
    else:
        rule = RuleRisk.query.filter()
    if g.name:
        rule = rule.filter(RuleRisk.field == g.name)
    if g.start and g.end:
        rule = rule.filter(RuleRisk.create_time.between(g.start, g.end))

    total = rule.count()
    items = rule.filter_by(is_deleted=False).order_by(text("create_time desc")).offset(g.offset).limit(g.count).all()
    total_page = math.ceil(total / g.count)

    return RuleRiskPageSchema(
        page=g.page,
        count=g.count,
        total=total,
        items=items,
        total_page=total_page,
    )
