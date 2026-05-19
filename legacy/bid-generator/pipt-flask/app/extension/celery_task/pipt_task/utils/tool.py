import logging
import os
import re
from datetime import datetime
from logging import handlers

from time import time

import pandas as pd

from app.extension.celery_task.pipt_task.assets.constant import IDENTIFY_INFO_TO_METADATA, no_mean_regex


def show_time(func):
    def wrapper(*args, **kwargs):
        star = time()
        result = func(*args, **kwargs)
        end = time()
        print('总耗时:{}秒'.format(round(end - star, 2)))
        return result

    return wrapper


def get_logger(base_dir, level=logging.INFO):
    # 指定日志文件保存的目录结构
    today = datetime.today()
    log_dir = os.path.join(base_dir, today.strftime("%Y-%m"))
    if not os.path.exists(log_dir):
        os.makedirs(log_dir)

    # 组合日志文件路径
    filename = os.path.join(log_dir, 'running_log')

    log = logging.getLogger(filename)
    if not log.handlers:
        log.setLevel(level)
        fmt = logging.Formatter('%(asctime)s %(filename)s[line:%(lineno)d] - %(levelname)s: %(message)s')

        file_handler = handlers.TimedRotatingFileHandler(filename=filename, when='D', backupCount=100, encoding='utf-8')
        file_handler.setFormatter(fmt)

        # log.addHandler(console_handler)
        log.addHandler(file_handler)

    return log
def to_input(items_input=None):
    items_input = input().replace('\'', '').replace('，', ',').replace("[", "").replace("]", "")
    if items_input == "":
        return []
    items_to_drop = []
    try:
        if ' ' in items_input:
            items_to_drop = items_input.replace(',', ' ').split(' ')
            items_to_drop = list(filter(None, items_to_drop))
        elif ',' in items_input:
            items_to_drop = items_input.replace(' ', ',').split(',')
            items_to_drop = list(filter(None, items_to_drop))
        else:
            items_to_drop.append(items_input)
    except:
        items_to_drop = []
    return items_to_drop


def mkdir(path):
    # os.path.exists 函数判断文件夹是否存在
    folder = os.path.exists(path)

    # 判断是否存在文件夹如果不存在则创建为文件夹
    if not folder:
        # os.makedirs 传入一个path路径，生成一个递归的文件夹；如果文件夹存在，就会报错,因此创建文件夹之前，需要使用os.path.exists(path)函数判断文件夹是否存在；
        os.makedirs(path)  # makedirs 创建文件时如果路径不存在会创建这个路径
        print('文件夹创建成功：', path)

    else:
        print('文件夹已经存在：', path)


def getFlist(file_dir):
    """
    获取文件夹中所有文件的路径
    """
    for root, dirs, files in os.walk(file_dir):
        return files


def walkFile(file):
    f_list = []
    for root, dirs, files in os.walk(file):

        # root 表示当前正在访问的文件夹路径
        # dirs 表示该文件夹下的子目录名list
        # files 表示该文件夹下的文件list

        # 遍历文件

        for f in files:
            f_list.append(f)
    return f_list


def contain_chinese(string):
    """
    输入文本值，检测是否为中文字符。
    """
    for chart in string:
        if u'\u4e00'<chart <u'\u9fff':
            return True
    return False

def personal_data_resource_directory(origin_df, df_out, field_dict):
    """
    将识别结果表映射成个人信息资源目录
    :param origin_df: 原始表
    :param df_out: 识别结果表
    :param field_dict: 标准元数据生成算法生成的字段名-标准元数据字典
    :return:
    """
    # 初始化结果列表
    result = []

    # 按 origin_table_index 分组
    grouped = df_out.groupby('origin_table_index')

    # 遍历每个分组
    for index, group in grouped:
        # 初始化信息集合和数据位置
        ident_info_dict = {}
        location_dict = {}

        # 遍历分组中的每一行
        for _, row in group.iterrows():
            # 拆分 sensitive_records 和 sensitive_type
            records = [r.strip() for r in row['sensitive_records'].split(';') if r.strip()]
            types = [t.strip() for t in row['sensitive_type'].split(';') if t.strip()]

            # 确保 records 和 types 长度一致
            if len(records) != len(types):
                continue

            # 将 sensitive_type 映射为中文描述
            mapped_types = [IDENTIFY_INFO_TO_METADATA.get(t, t) for t in types]

            # 将信息添加到 info_dict 和 location_dict
            for record, mapped_type in zip(records, mapped_types):
                ident_info_dict[mapped_type] = record
                location_dict[mapped_type] = (
                row['origin_table_name'], row['origin_table_index'], row['origin_field_name'])

        # 为了避免在标准化化元数据生成中生成了相同的标准元数据，需要对相同的字段名进行区分
        multi_info_ident = 1
        additional_info_dict = {}
        # 补充缺失的字段信息
        for field, field_type in field_dict.items():
            if field_type  in additional_info_dict:
                update_field_type = f'{field_type}_{multi_info_ident}'
                multi_info_ident += 1
            else:
                update_field_type = field_type
            if update_field_type not in ident_info_dict:  # 如果字段类型未在 info_dict 中
                if update_field_type == 'no_sensitive':
                    continue
                # 从 all_info 表中读取对应行的数据
                row_index = index - 1  # 转换为 all_info 的行索引
                value = origin_df.loc[row_index, field]
                if value != '':
                    if re.match(no_mean_regex, value) is None:
                        ident_info_dict[update_field_type] = value
                        location_dict[update_field_type] = (row['origin_table_name'], row['origin_table_index'], field)
                        additional_info_dict[update_field_type] = True

        # 将结果添加到结果列表
        result.append({'信息集合': ident_info_dict, '数据位置': location_dict})

    # 将结果转换为DataFrame
    result_df = pd.DataFrame(result)
    return result_df
