# -- coding: utf-8 --
# @Time : 2023/10/26 16:43
# @Author : Yao Sicheng
import copy
import math

from flask import Blueprint, g, current_app
from flask_jwt_extended import get_current_user, current_user
from sqlalchemy import text, select

from app.api import api, AuthorizationBearerSecurity
from app.api.piptool.exception import JobNotFound
from app.api.piptool.model.custom_recognition import CustomRecognition
from app.api.piptool.model.data_source import DataSource
from app.api.piptool.model.job import Job
from app.api.piptool.model.job_group import MaskJobGroup
from app.api.piptool.model.job_report import JobReport
from app.api.piptool.model.mask_job import MaskJob
from app.api.piptool.model.rule import Rule
from app.api.piptool.schema import MaskJobInSchema, Job4MaskDetailOutSchema, MaskJobPageSchema, \
    MaskJobSchemaList, MaskJobOutSchema, MaskJobUpdateInSchema, Job4MaskDemoOutSchema, \
    MaskJobDemoInSchema
from app.api.piptool.schema.job import JobQuerySearchSchema
from app.extension.celery_task.pipt_task.assets.constant import IDENTIFY_INFO_TO_CHINESE
from app.extension.celery_task.tasks import identify_mask
from app.lin import Success, DocResponse, Logger, permission_meta, group_required, NotFound, login_required, db, manager
from app.util.mysql_operation import get_database_source_conn_engine_str
from app.util.status_code import DATABASE, PENDING, FAILURE
from app.util.tool import mask_demo_func

mask_job_api = Blueprint("mask_job", __name__)

# @mask_job_api.route('/<int:job_id>', methods=['GET'])
# @login_required
# @api.validate(
#     resp=DocResponse(NotFound, r=MaskJobReportSchemaList),
#     tags=["任务"],
#     security=[AuthorizationBearerSecurity]
# )
# def get_mask_job(job_id):
#     """
#     获取指定id的脱敏任务信息
#     """
#     user = get_current_user()
#     current_group_ids = manager.find_group_ids_by_user_id(current_user.id)
#     mask_job = MaskJob.query.filter_by(job_id=job_id, is_deleted=False).all()
#     if mask_job:
#         if not user.is_admin and mask_job.group_id not in current_group_ids:
#             raise UnAuthentication('身份验证失败')
#         return mask_job  # 如果存在，返回该数据的信息
#     raise NotFound('没有找到相关任务')  # 如果任务不存在，返回一个异常给前端


@mask_job_api.route('/detail/<int:job_id>', methods=['GET'])
@login_required
@api.validate(
    resp=DocResponse(JobNotFound, r=Job4MaskDetailOutSchema),
    tags=["脱敏任务"],
    security=[AuthorizationBearerSecurity]
)
def get_job_for_mask_detail(job_id):
    """脱敏任务待执行信息"""
    info_type_list = []
    info_type_list_chinese = []
    mask_demo = {}
    table_list = []
    job = Job.query.filter_by(id=job_id, is_deleted=False).first()
    name = job.name
    task_id = job.task
    job_report_list = JobReport.query.filter_by(task_id=task_id).all()
    for job_report in job_report_list:
        info_type_list_chinese.append(job_report.standard_type)
        info_type_list.append(job_report.sensitive_info_type)
        table_list.append(job_report.name)
    need_mask_table_num = len(set(table_list))
    need_mask_field_num = len(job_report_list)
    all_identify_info_type_chinese = list(set(info_type_list_chinese))

    return {
        'task_id': task_id,
        'name':name,
        'need_mask_table_num': need_mask_table_num,
        'need_mask_field_num': need_mask_field_num,
        'all_identify_info_type': all_identify_info_type_chinese,
        "mask_demo": mask_demo}

@mask_job_api.route('demo', methods=['POST'])
@login_required
@api.validate(
    resp=DocResponse(JobNotFound, r=Job4MaskDemoOutSchema),
    tags=["脱敏任务"],
    security=[AuthorizationBearerSecurity]
)
def get_mask_demo(json: MaskJobDemoInSchema):
    """获取指定任务、指定脱敏规则的脱敏样例"""
    base = copy.copy(IDENTIFY_INFO_TO_CHINESE)
    custom_recognitions = CustomRecognition.get(one=False)
    for custom_recognition in custom_recognitions:
        base[custom_recognition.category_identifier] = custom_recognition.category
    info_type_list = []
    info_type_list_chinese = []
    mask_demo = {}
    table_list = []
    job_id = json.job_id
    rule_id = json.rule_id
    job = Job.query.filter_by(id=job_id, is_deleted=False).first()
    rule = Rule.query.filter_by(id=rule_id, is_deleted=False).first()
    if not job:
        raise NotFound("任务不存在")
    if not rule:
        raise NotFound("脱敏规则不存在")
    rule_template = rule.rule_template
    task_id = job.task
    job_report_list = JobReport.query.filter_by(task_id=task_id).all()
    for job_report in job_report_list:
        info_type_list_chinese.append(job_report.standard_type)
        info_type_list.append(job_report.sensitive_info_type)
        table_list.append(job_report.name)
    all_identify_info_type = list(set(info_type_list))

    result_dict = mask_demo_func(rule_template, all_identify_info_type)
    for key, value in result_dict.items():
        key_chinese = base.get(key)
        mask_demo[key_chinese] = value
    return {"mask_demo": mask_demo}



@mask_job_api.route("", methods=["POST"])
@permission_meta(name="创建任务", module="任务管理")
@Logger(template='{user.username}创建了脱敏任务。') # 推送的消息
@group_required
@api.validate(
    resp=DocResponse(Success(21)),
    tags=["脱敏任务"],
    security = [AuthorizationBearerSecurity]
)
def create_mask_job(json: MaskJobInSchema):
    current_group_ids = manager.find_group_ids_by_user_id(current_user.id)

    """创建脱敏任务"""
    config = current_app.config.get('USER_CONFIG')
    job_id = json.job_id
    job = Job.get(id=job_id)
    if not job:
        raise NotFound("相关识别任务不存在")
    scan_database_name = job.scan_database_name
    scan_database_id = job.scan_database_id
    save_database_id = job.save_database_id
    task_id = job.task
    rule_id = json.rule_id
    scan_database = DataSource.query.filter_by(id=scan_database_id, is_deleted=False).first()
    if scan_database is None:
        raise NotFound("扫描数据源不存在")
    # scan_database_name = scan_database.data_source_name
    scan_database_type = scan_database.database_type

    save_database = DataSource.query.filter_by(id=save_database_id, is_deleted=False).first()
    # save_database_name = save_database.data_source_name
    if save_database is None:
        raise NotFound("保存数据源不存在")
    save_database_type = save_database.database_type


    rule = Rule.query.filter_by(id=rule_id, is_deleted=False).first()
    if rule:
        rule_template = rule.rule_template
        rule_name = rule.rule_name
    else:
        raise NotFound("脱敏规则不存在")

    table_name_list = [
        name
        for (name,) in db.session.execute(
            select(JobReport.name)
            .filter_by(is_deleted=False, task_id=task_id)
            .distinct()
        ).all()
    ]
    if not table_name_list:
        raise NotFound('待脱敏表不存在，无需脱敏')
    if scan_database and save_database :
        if scan_database.data_source_type == DATABASE:
            scan_database_conn_engine_str = get_database_source_conn_engine_str(scan_database, scan_database_type)
        else:
            scan_database_conn_engine_str = None
        save_database_conn_engine_str = get_database_source_conn_engine_str(save_database, save_database_type)
        mask_database_id = json.mask_database_id
        mask_database = DataSource.query.filter_by(id=mask_database_id, is_deleted=False).first()
        mask_database_name = mask_database.data_source_name
        mask_database_type = mask_database.database_type
        mask_database_conn_engine_str = get_database_source_conn_engine_str(mask_database, mask_database_type)

        mask_job = MaskJob.create(**json.dict(),
                                  status=PENDING,
                                  scan_database_id=scan_database_id,
                                  scan_database_name=scan_database_name,
                                  # save_database_name=save_database_name,
                                  # scan_database_name=scan_database_name,
                                  mask_database_name=mask_database_name,
                                  progress=0,
                                  rule_name=rule_name,
                                  commit=True)

        for group_id in current_group_ids:
            MaskJobGroup.create(mask_job_id=mask_job.id, group_id=group_id, commit=True)
        mask_job_id = mask_job.id

        mask_job_task = identify_mask.delay(config, task_id, mask_job_id, table_name_list, scan_database_conn_engine_str, save_database_conn_engine_str, mask_database_conn_engine_str, rule_template)
        # mask_job.update(task=mask_job_task.task_id, commit=True)
        return Success(81)


@mask_job_api.route("/search/<int:job_id>")
@login_required
@api.validate(
    resp=DocResponse(JobNotFound, r=MaskJobSchemaList),
    tags=["脱敏任务"],
    security=[AuthorizationBearerSecurity]
)
def get_mask_job_by_job_id(job_id):

    """
    通过job_id获取所有脱敏任务
    """
    mask_jobs = MaskJob.query.filter_by(job_id=job_id, is_deleted=False).all()
    return mask_jobs


@mask_job_api.route("<int:id>")
@login_required
@api.validate(
    resp=DocResponse(NotFound, r=MaskJobOutSchema),
    tags=["脱敏任务"],
    security=[AuthorizationBearerSecurity]
)
def get_mask_job(id):

    """
    通过job_id获取所有脱敏任务
    """
    mask_job = MaskJob.get(id=id)
    return mask_job

@mask_job_api.route("<int:id>", methods=['PUT'])
@login_required
@api.validate(
    resp=DocResponse(Success),
    tags=["脱敏任务"],
    security=[AuthorizationBearerSecurity]
)
def update_mask_job(id, json: MaskJobUpdateInSchema):

    """
    通过job_id修改脱敏任务
    """
    mask_job = MaskJob.get(id=id)

    if mask_job:
        mask_job.update(
            id=id,
            **json.dict(),
            commit=True,
        )
        return Success(83)
    raise JobNotFound


@mask_job_api.route("/<int:id>", methods=['DELETE'])
@login_required
@api.validate(
    resp=DocResponse(Success(82)),
    tags=["脱敏任务"],
    security=[AuthorizationBearerSecurity]
)
def delete_job(id):
    """
    根据id删除任务
    """

    mask_job = MaskJob.query.filter_by(id=id, is_deleted=False).first()
    if mask_job:
        mask_job.delete(commit=True)
        return Success(82)
    raise NotFound("未找到任务")


@mask_job_api.route("")
@login_required
@api.validate(
    resp=DocResponse(r=MaskJobPageSchema),
    before=JobQuerySearchSchema.offset_handler,
    tags=["脱敏任务"],
    security=[AuthorizationBearerSecurity]
)
def get_mask_job_page(query: JobQuerySearchSchema):

    """
    任务分页展示
    """
    user = get_current_user()
    current_group_ids = manager.find_group_ids_by_user_id(current_user.id)
    if user.is_admin:
        mask_jobs = MaskJob.query.filter(MaskJob.is_deleted==False)
    else:
        # 非管理员查询：通过DataSourceGroup表关联查询有权限的数据源
        mask_jobs = MaskJob.query.join(
            MaskJobGroup,
            MaskJob.id == MaskJobGroup.job_id
        ).filter(
            MaskJob.is_deleted == False,
            MaskJobGroup.group_id.in_(current_group_ids),
        ).distinct()  # 去重避免重复数据源


    total = mask_jobs.count()
    items = mask_jobs.order_by(text("create_time desc")).offset(g.offset).limit(g.count).all()
    # if items:
    #     items = job_status_update(items)
    total_page = math.ceil(total / g.count)

    return MaskJobPageSchema(
        page=g.page,
        count=g.count,
        total=total,
        items=items,
        total_page=total_page,
    )



@mask_job_api.route("/<int:id>", methods=["PUT"])
@permission_meta(name="修改任务", module="任务管理")
@Logger(template='{user.username}修改了一项任务。') # 推送的消息
@group_required
@api.validate(
    resp=DocResponse(Success(23)),
    tags=["任务"],
    security=[AuthorizationBearerSecurity]
)
def update_job(id, json: MaskJobInSchema):
    """
    更新任务信息
    """

    mask_job = MaskJob.get(id=id)
    if mask_job:
        mask_job.update(
            id=id,
            **json.dict(),
            commit=True,
        )
        return Success(23)
    raise NotFound("未找到任务")
