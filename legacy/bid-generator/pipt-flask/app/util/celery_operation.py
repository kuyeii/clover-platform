# -- coding: utf-8 --
# @Time : 2025/2/19 11:33
# @Author : Yao Sicheng
from celery.result import AsyncResult

from app.api.piptool.model.job_detail import JobDetail
from app.extension.celery_task.celery_init import my_celery
from app.util.status_code import PROGRESS, PENDING, FAILURE, SUCCESS, OTHER


def kill_task(task_id):
    my_celery.control.revoke(task_id, terminate=True)

def task_status(task_id):
    """更新task状态"""

    is_progress = False
    is_success = True
    response = {}
    task_result = AsyncResult(task_id, app=my_celery)
    task_result_dict = {}
    if task_result.state == 'SUCCESS':

        sub_task_list = task_result.info
        for sub_task in sub_task_list:
            sub_task_result = AsyncResult(sub_task, app=my_celery)
            if sub_task_result.state == 'SUCCESS':
                task_result_dict.update(sub_task_result.info)
            else:
                is_success = False
                if sub_task_result.state == 'PROGRESS':
                    is_progress = True
                    task_result_dict.update(sub_task_result.info.get("tables"))

        if is_progress:
            response['status'] = PROGRESS
        elif is_success:
            response['status'] = SUCCESS
        else:
            response['status'] = PENDING
    elif task_result.state == 'PENDING':
        response['status'] = PENDING
    elif task_result.state == 'FAILURE':
        response['status'] = FAILURE
    else:
        response['status'] = PROGRESS
    response['tables'] = task_result_dict

    count = sum(1 for v in task_result_dict.values() if v[0] == SUCCESS)

    # 比例
    total = len(task_result_dict)
    ratio =100 * count / total if total > 0 else 0
    response['progress'] = int(ratio)

    return response

def task_status_bak(task_id):
    """更新task状态"""
    task_result = AsyncResult(task_id, app=my_celery)
    response = {}
    # response = {
    #     'status': 0,
    #     'progress': 0,
    #     'date_done':None
    # }

    if task_result.state == 'PROGRESS':
        response['status'] = PROGRESS
        response['progress'] = task_result.info['progress']
        response['date_done'] = None
        response['tables'] = task_result.info['tables']

    elif task_result.state == 'FAILURE':
        response['status'] = FAILURE
        response['progress'] = 0
        response['date_done'] = task_result.date_done
        response['tables'] = None
    elif task_result.state =='SUCCESS':
        response['status'] = SUCCESS
        response['progress'] = 100
        response['tables'] = task_result.info
        response['date_done'] = task_result.date_done
    elif task_result.state == 'PENDING':
        response['status'] = PENDING
        response['progress'] = 0
        response['date_done'] = None
        response['tables'] = None
    else:
        response = {
            'status': OTHER,
            'progress': 0,
            'date_done':None
        }

    return response

def job_status_update(jobs):
    # 更新任务状态以及任务中表的执行状态
    jobs_update = []
    for job in jobs:
        if job.status == PENDING or job.status == PROGRESS:

            response = task_status(job.task)
            job_detail_list = JobDetail.query.filter_by(task_id=job.task).all()
            # if job.status ==
            tables = response['tables']
            for job_detail in job_detail_list:
                if tables is not None:
                    if job_detail.status != SUCCESS:
                        if tables.get(job_detail.table_name) is not None:
                            table_status, table_field_num, table_row_num = tables[job_detail.table_name]
                            job_detail.update(status=table_status, field_num=table_field_num, row_num=table_row_num, commit=True)

            job.status = response['status']
            job.progress = response['progress']
            job.update(status=response['status'], progress=response['progress'], commit=True)
        jobs_update.append(job)
    return jobs_update
