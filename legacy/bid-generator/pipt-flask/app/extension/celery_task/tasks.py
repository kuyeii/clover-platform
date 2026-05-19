# -- coding: utf-8 --
# @Time : 2024/5/27 9:12
# @Author : Yao Sicheng
import copy
import os
import pickle
import uuid
from datetime import datetime
from urllib.parse import urlparse, unquote

import numpy as np
import pandas as pd
from celery import chord
from sqlalchemy import create_engine, inspect

from app.extension.celery_task.celery_init import my_celery
from app.extension.celery_task.global_model import get_identify_model, get_fast_model
from app.extension.celery_task.pipt_task.assets.constant import IDENTIFY_INFO_TO_CHINESE
from app.extension.celery_task.pipt_task.classification.judge import FastScan, DirectOut
from app.extension.celery_task.pipt_task.desensitize.simple_anonymization import Anonymizer
from app.extension.celery_task.pipt_task.mdt.mdt_generate import MdtGenerator
from app.extension.celery_task.pipt_task.per_info_iden.table_identify import IdentifyAnalytics
from app.extension.celery_task.pipt_task.report.identify_report import IdentifyReport
from app.extension.celery_task.pipt_task.risk_assessment.risk_process import RiskProcessor
from app.extension.celery_task.pipt_task.utils.data_conversion import file_to_dataframe, read_text
from app.util.status_code import DATABASE, API, SUCCESS, INFO, PROGRESS, PENDING, WARN, TASK, FAILURE


def datasource_process(inspector, table_name, engine):
    is_tabular = True
    # 遍历内层字典，只提取值为True的键

    # field_comment_dict, comment_field_dict = get_all_field_comments(inspector, scan_database_conn_engine_str, table_name)

    # 获取列详情
    columns = inspector.get_columns(table_name)
    # 构建字段名到注释的映射
    field_comment_dict = {}
    comment_field_dict = {}
    for col in columns:
        field_name = col['name']
        if col.get('comment', '') is None:
            comment = field_name
        else:
            comment = col.get('comment', '').strip()  # 使用字段名作为默认注释
        field_comment_dict[field_name] = comment
    # 构建注释到字段名的映射（处理重复注释）
    for field, comment in field_comment_dict.items():
        comment_field_dict[comment] = field
    df = pd.read_sql_table(table_name, engine)
    # 更新df表的字段名为注释
    df_col_field = df.columns
    df_col_comment = []
    for col in df.columns:
        comment = field_comment_dict[col]
        if comment is not None:
            df_col_comment.append(comment)
        else:
            df_col_comment.append(col)
    df.columns = df_col_comment

    #TODO 过滤空块
    # if df.empty:
    #     return df, None, None, None, df_col_field, None


    return df, df_col_field, comment_field_dict, is_tabular

def filedata_process(tables_url, filed_comment_dict=None):
    # 遍历内层字典，只提取值为True的键
    file_type = os.path.splitext(tables_url)[1]  # 输出: .txt
    if file_type in ('.csv', '.json', '.xml', '.xls', '.xlsx'):
        is_tabular = True
        data = file_to_dataframe(tables_url, file_type)
        df_col_field = data.columns
        # filed_comment_dict是用于对字段名进行替换的列表，现在默认不使用
        if filed_comment_dict is not None:
            comment_field_dict = {value: key for key, value in filed_comment_dict.items()}
            fields = list(data.columns)
            comments = [filed_comment_dict[field] for field in fields]
            data.columns = comments
        else:
            comment_field_dict = {field: field for field in df_col_field}
        return data, df_col_field, comment_field_dict, is_tabular
    else:
        is_tabular = False
        data = read_text(tables_url, file_type)
        return data, None, None, is_tabular

@my_celery.task
def identify_mask(config, task_id, mask_job_id, table_name_list, scan_database_conn_engine_str, save_database_conn_engine_str, mask_database_conn_engine_str, rule_template):
    from starter import app
    from app.api.piptool.model.mask_job import MaskJob
    from app.api.piptool.model.job_detail import MaskJobDetail
    from app.api.piptool.model.job_report import JobReport

    with app.app_context():
        mask_job = MaskJob.query.filter_by(is_deleted=False, id=mask_job_id).first()

        mask_job.update(status=PROGRESS, commit=True)
        for table_name in table_name_list:
            MaskJobDetail.create(table_name=table_name, status=PENDING, mask_job_id=mask_job_id, commit=True)
    anonymizer = Anonymizer(origin_table=None, identify_table=None, desensitization_method=rule_template)
    identify_report = IdentifyReport(config)
    save_engine = create_engine(save_database_conn_engine_str)
    scan_engine = create_engine(scan_database_conn_engine_str)
    mask_engine = create_engine(mask_database_conn_engine_str)
    total = len(table_name_list)
    all_data_dict = {}
    for index, table_name in enumerate(table_name_list):
        current_progress = int(index / total * 100)
        # TODO 表不存在的情况；识别结果为空的情况
        df = pd.read_sql_table(table_name, scan_engine)
        df_out = pd.read_sql_table(table_name, save_engine)
        anonymizer.update_need_anonymized_data(new_data=df, new_data_iden_res=df_out)
        with app.app_context():
            mask_job_detail = MaskJobDetail.query.filter_by(mask_job_id=mask_job_id, table_name=table_name).first()
            mask_job_detail.update(status=PROGRESS, commit=True)
        anonymizer.all_desensitize()
        anonymizer.origin_table.to_sql(table_name, con=mask_engine, if_exists='replace', index=False)
        with app.app_context():
            df_mask = anonymizer.origin_table
            field_info_data_dict = identify_report.mask_report_result(df_out, df_mask)
            all_data_dict.update(field_info_data_dict)

            mask_job = MaskJob.query.filter_by(is_deleted=False, id=mask_job_id).first()
            mask_job_detail = MaskJobDetail.query.filter_by(mask_job_id=mask_job_id, table_name=table_name).first()
            mask_job_detail.update(status=SUCCESS, commit=True)

            if index == total - 1:
                mask_job.update(progress=100, status=SUCCESS, end_time=datetime.utcnow(), commit=True)

                job_report_list = JobReport.query.filter_by(task_id=task_id)

                for job_report in job_report_list:
                    included_sensitive_info_e_mask = all_data_dict[
                        (job_report.sensitive_field_name, job_report.sensitive_info_type)]
                    job_report.update(included_sensitive_info_e_mask=included_sensitive_info_e_mask, commit=True)
            else:
                mask_job.update(progress=current_progress, commit=True)

# def text_identify_method(app, celery_task, data, table_name, tables_list_status, job_name, total,
#                          current_progress, identify, info_type_list,
#                          is_desensitize, mask_database_conn_engine_str, anonymizer,
#                          is_statistics, stat_database_conn_engine_str, mdt_generator,
#                          risk_processor, out_engine, identify_report, JobReport, MdtReport, current_group_ids,
#                          BriefReport, SystemLog, identify_info_to_chinese):
#     all_identify_list = identify.identify_naive_func(data, info_type_list)
#     # 转换数据
#     rows = []
#     for row_idx, entities in all_identify_list:
#         for entity in entities:
#             rows.append({
#                 'row': row_idx,
#                 'type': entity[0],
#                 'info': entity[1],
#                 'start': entity[2],
#                 'end': entity[3]
#             })
#
#     # 创建DataFrame
#     df_out = pd.DataFrame(rows)
#
#
#     df_out.to_sql(table_name, con=out_engine, if_exists='replace', index=False)
#
#     with app.app_context():
#
#         # 工具中不展示敏感内容
#         info_store_dict = {}
#
#         table_report_list = identify_report.text_report_result(df_out, identify_info_to_chinese)
#
#         for table_report in table_report_list:
#             # # 工具中不展示敏感内容
#             # if table_report[1] in info_store_dict.keys():
#             #     info_store_dict[table_report[1]] = info_store_dict[table_report[1]] + table_report[3]
#             # else:
#             #     info_store_dict[table_report[1]] = table_report[3]
#
#             JobReport.create(task_id=celery_task.request.id, name=table_name, sensitive_field_name='',
#                              sensitive_info_type=table_report[0], standard_type=table_report[1],
#                              sensitive_info_num=table_report[2],
#                              included_sensitive_info_e_mask='',
#                              commit=True)
#
#         info_store_dict = {}
#         # for table_report in table_report_list:
#         #     # 工具中不展示敏感内容
#         #     if table_report[1] in info_store_dict.keys():
#         #         info_store_dict[table_report[1]] = info_store_dict[table_report[1]] + table_report[3]
#         #     else:
#         #         info_store_dict[table_report[1]] = table_report[3]
#         #
#         #     JobReport.create(task_id=celery_task.request.id, name=table_name, sensitive_field_name=table_report[0],
#         #                      sensitive_info_type=table_report[1], standard_type=table_report[2],
#         #                      sensitive_info_num=table_report[3],
#         #                      included_sensitive_info_e_mask=table_report[4],
#         #                      commit=True)
#         if is_statistics:
#             for mdt_report in mdt_generator.mdt_stat:
#                 if mdt_report[1] == 0:
#                     continue
#                 else:
#                     MdtReport.create(task_id=celery_task.request.id, name=table_name, info_type=mdt_report[0],
#                                      pop_num=mdt_report[1],
#                                      commit=True)
#         # brief_report = identify_report.brief_report_result(df, df_out, info_store_dict,
#         #                                                    mdt_generator.microdata, risk_processor.risk_stats)
#         # print(brief_report)
#         # for group_id in current_group_ids:
#         #     BriefReport.create(task_id=celery_task.request.id, name=table_name, rows_num=brief_report[0],
#         #                        group_id=group_id,
#         #                        risk_rows_num=brief_report[1], all_info_types=brief_report[2],
#         #                        all_info_num=brief_report[3], related_pop_num=brief_report[4],
#         #                        risk=brief_report[5], mean_risk=brief_report[6],
#         #                        high_risk_counts=brief_report[7], minor_high_risk_counts=brief_report[8],
#         #                        medium_risk_counts=brief_report[9],
#         #                        commit=True)





def tabular_identify_method(app, parent_task_id, df, table_name, fast_scan, tables_list_status, identify, info_type_list, scan_table_primary_key_column,
                            comment_field_dict, is_desensitize, mask_database_conn_engine_str, df_col_field, anonymizer,
                            is_statistics, stat_database_conn_engine_str, mdt_generator,
                            risk_processor, output_engine, identify_report, JobReport, MdtReport, current_group_ids,
                            BriefReport, identify_info_to_chinese):
    """字段级快筛"""
    field_list = list(df.columns)
    title_column_list = [table_name] + field_list
    field_name_type_dict, person_status = fast_scan(title_column_list)
    print(f"##########{table_name}#############")
    tables_list_status.update({table_name: 1})

    if len(df) > 0:
        # 实际执行
        # try:
        df_out = identify(df, field_name_type_dict, person_status, table_name, info_type_list,
                          key_field=scan_table_primary_key_column)
        if df_out is not None:
            # df_out = metadata_identify(df, df_out, table_name, field_name_type_dict)

            df_out['origin_field_name'] = df_out['origin_field_name'].apply(
                lambda x: x if comment_field_dict.get(x, None) is None else comment_field_dict.get(x, None))
            #     if identify_df_add is not None:
            #         identify_df_add.to_sql(table_name, con=out_engine, if_exists='replace', index=False)
            # if df_out is not None:
            df_out['origin_field_name'] = df_out['origin_field_name'].apply(lambda x: x if comment_field_dict.get(x, None) is None else comment_field_dict.get(x, None))

    else:
        df_out = None


    """统计信息识别结果"""
    if df_out is not None:
        # if is_desensitize:
        #     df_mask = anonymizer.origin_table
        # else:
        #     df_mask = None
        if is_statistics:
            mdt_generator.mdt_stat_report()

        df_out.to_sql(table_name, con=output_engine, if_exists='replace', index=False)
        with app.app_context():
            table_report_list = identify_report.report_result_like_shuxin(df_out,identify_info_to_chinese)
            info_store_dict = {}
            for table_report in table_report_list:
                # 工具中不展示敏感内容
                if table_report[1] in info_store_dict.keys():
                    info_store_dict[table_report[1]] = info_store_dict[table_report[1]] + table_report[3]
                else:
                    info_store_dict[table_report[1]] = table_report[3]

                JobReport.create(task_id=parent_task_id, name=table_name, sensitive_field_name=table_report[0],
                                 sensitive_info_type=table_report[1], standard_type=table_report[2],
                                 sensitive_info_num=table_report[3],
                                 commit=True)
            if is_statistics:
                for mdt_report in mdt_generator.mdt_stat:
                    if mdt_report[1] == 0:
                        continue
                    else:
                        MdtReport.create(task_id=parent_task_id, name=table_name,info_type=mdt_report[0],
                                         pop_num=mdt_report[1],
                                         commit=True)
            brief_report = identify_report.brief_report_result(df, df_out, info_store_dict,
                                                               mdt_generator.microdata,risk_processor.risk_stats)
            print(brief_report)
            BriefReport.create(task_id=parent_task_id,name=table_name,rows_num=brief_report[0],
                               risk_rows_num=brief_report[1],
                               fields_num=brief_report[2],
                               risk_fields_num=brief_report[3],
                               all_info_types=brief_report[4],
                               all_info_num=brief_report[5],related_pop_num=brief_report[6],
                               risk=brief_report[7],mean_risk=brief_report[8],
                               high_risk_counts=brief_report[9],minor_high_risk_counts=brief_report[10],medium_risk_counts=brief_report[11],
                               commit=True)
        """脱敏"""
        if is_desensitize:
            mask_engine = create_engine(mask_database_conn_engine_str)

            df.columns = df_col_field
            if df_out is None:
                df.to_sql(table_name, con=mask_engine, if_exists='replace', index=False)
            else:

                anonymizer.update_need_anonymized_data(new_data=df, new_data_iden_res=df_out)
                anonymizer.all_desensitize()
                anonymizer.origin_table.columns = df_col_field
                anonymizer.origin_table.to_sql(table_name, con=mask_engine, if_exists='replace', index=False)

        """微数据生成"""
        if is_statistics:

            stat_engine = create_engine(stat_database_conn_engine_str)
            cols_order = list(df_col_field)
            if df_out is None:
                print(f"{table_name}无个人信息")

            else:
                mdt = mdt_generator.apply(df_out, cols_order)
                risk_processor.update_feature(mdt)
                final_mdt = risk_processor.apply(mdt)
                if not final_mdt.empty:
                    final_mdt.to_sql(table_name, con=stat_engine, if_exists='replace', index=False)


@my_celery.task
def celery_file_clean(url_list, assets, dry_run=True):
    # 解析URL，生成保留文件集合
    retain_files = set()
    for url in url_list:
        parsed_url = urlparse(url)
        path = parsed_url.path
        assets_root = os.path.join('/', assets)
        if not path.startswith(assets_root):
            print(f"警告：跳过非assets目录的URL {url}")
            continue

        relative_encoded = path[len(assets_root):]
        relative_decoded = unquote(relative_encoded)
        abs_path = os.path.normpath(os.path.join(assets_root, relative_decoded))
        retain_files.add(abs_path)

    # 遍历目录删除文件
    deleted_count = 0
    for root, _, files in os.walk(assets):
        for file in files:
            file_path = os.path.normpath(os.path.join(root, file))
            if file_path not in retain_files:
                if dry_run:
                    print(f"[模拟] 删除：{file_path}")
                else:
                    try:
                        os.remove(file_path)
                        print(f"已删除：{file_path}")
                        deleted_count += 1
                    except Exception as e:
                        print(f"删除失败：{file_path} - {str(e)}")
    print(f"操作完成。共删除 {deleted_count} 个文件。")
    return deleted_count

# @my_celery.task
# def metadata2vec(path):
#     """
#      生成词向量矩阵与映射字典
#      @return:
#      """
#     from app.api.piptool.model.metadata import Metadata
#     from starter import app
#     from text2vec import Word2Vec
#     model = Word2Vec("w2v-light-tencent-chinese")
#
#     # 用于存储词向量的字典
#     # embeddings_dict = {}
#     with app.app_context():
#         metadata_list = Metadata.get(one=False)
#     data = {}
#     for metadata in metadata_list:
#         data[metadata.template_name] = metadata.keywords
#
#     # 初始化词向量和映射关系列表
#     embeddings_list = []
#     info_list = []
#
#     # 遍历JSON数据，计算词向量并更新映射关系列表
#     for key, values in data.items():
#         # 计算词向量
#         emb = model.encode(values, show_progress_bar=False, normalize_embeddings=True)
#
#         embeddings_list.append(emb)  # 取出计算出的词向量
#         info_list.append(key)
#
#     # 将词向量列表转换为NumPy数组
#     embeddings = np.concatenate(embeddings_list, axis=0)
#     # 保存词向量数组到文件
#     np.save(os.path.join(path,'embeddings.npy'), embeddings)
#
#     # 保存映射关系到文件
#     with open(os.path.join(path, 'word_list.pkl'), 'wb') as f:
#         pickle.dump(info_list, f)
#
#     print("词向量和映射关系已保存到文件。")
#
#     # # 保存为pickle文件
#     # with open('word_list.pkl', 'wb') as f:
#     #     pickle.dump(info_list, f)
def split_tables(tables, num_workers=8):
    k, m = divmod(len(tables), num_workers)
    return [tables[i*k + min(i, m):(i+1)*k + min(i+1, m)] for i in range(num_workers) if tables[i*k + min(i, m):(i+1)*k + min(i+1, m)]]


@my_celery.task(bind=True)
def identify_core(self,
                  config,
                  json,
                  save_database_name,
                  scan_database_name,
                  mask_database_name,
                  stat_database_name,
                  current_group_ids,
                  job_name,
                  scan_database_id,
                  data_source_type,
                  scan_database_conn_engine_str,
                  save_database_conn_engine_str,
                  infos,
                  table_selection,
                  is_fast_scan,
                  is_desensitize,
                  is_statistics,
                  mask_database_conn_engine_str=None,
                  stat_database_conn_engine_str=None,
                  rule_template=None,
                  scan_table_primary_key_column=None):

    from starter import app
    from app.api.piptool.model.data_source import FileDataSource, DataSource
    from app.api.piptool.model.job_detail import JobDetail
    from app.api.piptool.model.custom_recognition import CustomRecognition
    # -----------------------
    # 1. 获取表清单
    # -----------------------
    is_select_all = table_selection['is_select_all']
    exclude_ids = table_selection['exclude_ids']
    include_ids = table_selection['include_ids']

    all_info_keys = infos.keys()
    default_info_keys = IDENTIFY_INFO_TO_CHINESE.keys()
    category_identifier_list = list(set(all_info_keys) - set(default_info_keys))

    tables_url_dict = None
    if data_source_type == DATABASE:
        out_engine = create_engine(
            scan_database_conn_engine_str,
            pool_pre_ping=True,
            pool_recycle=3600,
            pool_size=10,
            max_overflow=20,
        )
        inspector = inspect(out_engine)
        tables = inspector.get_table_names()
        if is_select_all:
            tables = list(set(tables) - set(exclude_ids))
        else:
            tables = list(np.intersect1d(include_ids, tables))
    elif data_source_type == API:
        with app.app_context():
            datasource = DataSource.query.filter_by(data_source_id=scan_database_id).first()
        tables = [datasource.data_source_name]
    else:
        with app.app_context():
            tables = FileDataSource.query.filter_by(data_source_id=scan_database_id).all()
        tables_url_dict = {t.file_name: t.url for t in tables}
        tables = [t.file_name for t in tables]
        if is_select_all:
            tables = list(set(tables) - set(exclude_ids))
        else:
            tables = list(np.intersect1d(include_ids, tables))
    custom_content_identify_regex_list = []

    with app.app_context():
        identify_info_to_chinese = copy.copy(IDENTIFY_INFO_TO_CHINESE)
        for table_name in tables:
            JobDetail.create(task_id=self.request.id, table_name=table_name, status=0, commit=True)
            if category_identifier_list:
                for category_identifier in category_identifier_list:
                    if infos[category_identifier]:
                        custom_recognition = CustomRecognition.query.filter_by(category_identifier=category_identifier).first()
                        if custom_recognition is not None:
                            # if custom_recognition.category_type == CONTENT:
                            custom_content_identify_regex_list.append((category_identifier, custom_recognition.regex_template, custom_recognition.category_type))
                            identify_info_to_chinese[custom_recognition.category_identifier] = custom_recognition.category
    # -----------------------
    # 2. 准备子任务
    # -----------------------
    table_groups = split_tables(tables, num_workers=4)
    subtasks = []
    subtask_ids = []
    for group in table_groups:
        task_id = str(uuid.uuid4())
        sig = identify_batch_task.s(
            config=config,
            table_names=group,
            data_source_type=data_source_type,
            scan_database_conn_engine_str=scan_database_conn_engine_str,
            mask_database_conn_engine_str=mask_database_conn_engine_str,
            stat_database_conn_engine_str=stat_database_conn_engine_str,
            infos=infos,
            is_fast_scan=is_fast_scan,
            is_desensitize=is_desensitize,
            is_statistics=is_statistics,
            rule_template=rule_template,
            scan_table_primary_key_column=scan_table_primary_key_column,
            tables_url_dict=tables_url_dict,
            save_engine_str=save_database_conn_engine_str,
            job_name=job_name,
            parent_task_id=self.request.id,
            current_group_ids=current_group_ids,
            identify_info_to_chinese=identify_info_to_chinese,
            custom_content_identify_regex_list=custom_content_identify_regex_list
        ).set(task_id=task_id)
        subtasks.append(sig)
        subtask_ids.append(task_id)
    # 5. 并发执行（固定 4 个任务，取决于num_workers）
    chord(subtasks, finalize_job.s(
        json=json,
        save_database_name=save_database_name,
        scan_database_name=scan_database_name,
        mask_database_name=mask_database_name,
        stat_database_name=stat_database_name,
        job_name=job_name,
        parent_task_id=self.request.id,
    ))()
    return subtask_ids


@my_celery.task(bind=True)
def identify_batch_task(self,
                        config,
                        table_names,
                        data_source_type,
                        scan_database_conn_engine_str,
                        mask_database_conn_engine_str,
                        stat_database_conn_engine_str,
                        infos,
                        is_fast_scan,
                        is_desensitize,
                        is_statistics,
                        rule_template,
                        scan_table_primary_key_column,
                        tables_url_dict,
                        save_engine_str,
                        job_name,
                        parent_task_id,
                        current_group_ids,
                        identify_info_to_chinese,
                        custom_content_identify_regex_list):
    """
    处理单张表的识别任务
    """
    from starter import app
    from app.api.piptool.model.job_report import JobReport, BriefReport
    from app.api.piptool.model.mdt_report import MdtReport
    from app.api.piptool.model.system_logger import SystemLog
    """
    处理一批表，内部循环处理单表。
    """

    tables_list_status_field_num_row_num = {table: [PENDING, 0, 0] for table in table_names}
    self.update_state(state='PROGRESS', meta={'tables': tables_list_status_field_num_row_num})
    for table_name in table_names:
        tables_list_status_field_num_row_num[table_name] = [PROGRESS, 0, 0]
        self.update_state(state='PROGRESS', meta={'tables': tables_list_status_field_num_row_num})
        try:
            engine = None
            inspector = None
            if data_source_type == DATABASE:
                engine = create_engine(scan_database_conn_engine_str,
                                       pool_pre_ping=True,
                                       pool_recycle=3600,
                                       pool_size=10,
                                       max_overflow=20,
                                       )

                inspector = inspect(engine)

            output_engine = create_engine(save_engine_str,
                                          pool_pre_ping=True,
                                          pool_recycle=3600,
                                          pool_size=10,
                                          max_overflow=20
                                          )
            # 数据准备
            if data_source_type == DATABASE:

                data, df_col_field, comment_field_dict, is_tabular = datasource_process(inspector, table_name, engine)

            else:
                tables_url = tables_url_dict[table_name]
                data, df_col_field, comment_field_dict, is_tabular = filedata_process(tables_url)

            # 初始化识别器
            if is_fast_scan:
                fast_scan = get_fast_model(config)
                config['is_fast_scan'] = True
            else:
                fast_scan = DirectOut()
                config['is_fast_scan'] = False
            identify = get_identify_model(config, custom_content_identify_regex_list)
            identify_report = IdentifyReport(config)

            anonymizer = Anonymizer(origin_table=None, identify_table=None,
                                    desensitization_method=rule_template) if is_desensitize else None
            mdt_generator = MdtGenerator(identify_table=None, microdata=pd.DataFrame(), mdt_stat=None)
            risk_processor = RiskProcessor()

            info_type_list = [key for key, value in infos.items() if value]


            # 执行识别
            if is_tabular:
                tabular_identify_method(app, parent_task_id, data, table_name, fast_scan, {}, identify, info_type_list,
                                        scan_table_primary_key_column, comment_field_dict,
                                        is_desensitize, mask_database_conn_engine_str,
                                        df_col_field, anonymizer, is_statistics,
                                        stat_database_conn_engine_str, mdt_generator,
                                        risk_processor, output_engine,
                                        identify_report, JobReport, MdtReport,
                                        current_group_ids, BriefReport, identify_info_to_chinese)

            field_num = len(data.columns)
            row_num = len(data)
            tables_list_status_field_num_row_num[table_name] = [SUCCESS, field_num, row_num]
            self.update_state(state='PROGRESS', meta={'tables': tables_list_status_field_num_row_num})

        except Exception as e:
            with app.app_context():
                SystemLog.create_log(
                    message=f"任务【{job_name}】中【{table_name}】执行失败：{str(e)}",
                    level=WARN,
                    type=TASK,
                    commit=True,
                )
            tables_list_status_field_num_row_num[table_name] = [FAILURE, 0, 0]
            self.update_state(state='PROGRESS', meta={'tables': tables_list_status_field_num_row_num})
    return tables_list_status_field_num_row_num


@my_celery.task
def finalize_job(results, json,
                 save_database_name,
                 scan_database_name,
                 mask_database_name,
                 stat_database_name,
                 job_name,
                 parent_task_id):
    """
    所有表扫描完成后的收尾逻辑
    """
    from starter import app
    from app.api.piptool.model.job import Job
    from app.api.piptool.model.system_logger import SystemLog
    from app.api.piptool.model.job_detail import JobDetail
    from app.util.celery_operation import task_status

    with app.app_context():



        job = Job.get(task=parent_task_id)

        job_detail_list = JobDetail.query.filter_by(task_id=job.task).all()
        response = task_status(job.task)
        tables = response['tables']
        for job_detail in job_detail_list:
            if tables is not None:
                if job_detail.status != SUCCESS:
                    job_detail.update(status=tables[job_detail.table_name][0],
                                      field_num=tables[job_detail.table_name][1],
                                      row_num=tables[job_detail.table_name][2], commit=True)

        job.update(**json,
                   save_database_name=save_database_name,
                   scan_database_name=scan_database_name,
                   mask_database_name=mask_database_name,
                   stat_database_name=stat_database_name,
                   end_time=datetime.utcnow(),
                   status=SUCCESS, progress=100,

                   task=parent_task_id, commit=True)

        SystemLog.create_log(
            message=f"任务{job_name}执行完成",
            level=INFO,
            commit=True,
        )
    return results

