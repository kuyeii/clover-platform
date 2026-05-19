# -- coding: utf-8 --
# @Time : 2025/9/24 11:12
# @Author : Yao Sicheng
# global_model.py
from app.extension.celery_task.pipt_task.classification.judge import FastScan
from app.extension.celery_task.pipt_task.per_info_iden.table_identify import IdentifyAnalytics

_model_instance = None
_fast_model_instance = None
def get_identify_model(config, custom_content_identify_regex_list):
    global _model_instance
    if _model_instance is None:
        # 第一次调用才加载，后面直接返回
        _model_instance = IdentifyAnalytics(config)
        for custom_recognition_identifier_and_regex in custom_content_identify_regex_list:
            _model_instance.person_identify.add_custom_rule_content(*custom_recognition_identifier_and_regex)
    return _model_instance

def get_fast_model(config):
    global _fast_model_instance
    if _fast_model_instance is None:
        # 第一次调用才加载，后面直接返回
        _fast_model_instance = FastScan(config)

    return _fast_model_instance
