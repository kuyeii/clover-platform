# -- coding: utf-8 --
# @Time : 2025/3/10 15:02
# @Author : Yao Sicheng
# 遍历查询到的数据
import re
from collections import defaultdict

import pandas as pd
import psutil
import requests

from app.extension.celery_task.pipt_task.desensitize.mask.mask_method import keep_tail_masking, target_range_masking
from app.extension.celery_task.pipt_task.desensitize.simple_anonymization import Anonymizer


def get_cpu_usage():
    """获取CPU使用率（百分比）"""
    return psutil.cpu_percent(interval=1)

def get_memory_usage():
    """获取内存使用率（百分比）"""
    mem = psutil.virtual_memory()
    return mem.percent


def check_custom_recognition_identifier(input_str):
    _precompiled = re.compile(r'^[A-Za-z0-9_]+$')
    _blacklist = {'name', 'phone', 'bank', 'car_id', 'ip', 'email', 'addr', 'gender', 'gender', 'political_status',
                  'nation'}
    if _precompiled.fullmatch(input_str) and input_str not in _blacklist:
        return True
    return False

def job_report_query(task_id, job_reports):
    # 初始化数据结构
    task_summary = {
        "task_id": task_id,
        "children": []
    }

    # 用于存储最外层的汇总信息
    summary = defaultdict(int)

    # 用于存储每个表的汇总信息
    table_summary = defaultdict(lambda: defaultdict(int))

    # 处理查询结果
    for result in job_reports:
        table_name, info_type, total_num = result
        summary[f"{info_type}_num"] += total_num
        table_summary[table_name][f"{info_type}_num"] += total_num

    # 将汇总信息添加到任务层级的 JSON 中
    for key, value in summary.items():
        task_summary[key] = value

    # 将每个表的汇总信息添加到 children 中
    for table_name, info in table_summary.items():
        task_summary["children"].append({
            "table_name": table_name,
            **info
        })
    return task_summary

def parse_insert_statement(insert_stmt):
    """解析单个INSERT语句，提取表名、列名和值"""
    # 匹配表名和列名
    table_pattern = r"INSERT\s+INTO\s+([^\s\(]+)\s*(\([^\)]+\))?\s*VALUES\s*"
    table_match = re.search(table_pattern, insert_stmt, re.IGNORECASE)
    if not table_match:
        return None, None, []

    table_name = table_match.group(1).strip('`"')
    columns_str = table_match.group(2).strip('() ') if table_match.group(2) else None
    columns = [col.strip('`" ') for col in columns_str.split(',')] if columns_str else []

    # 提取VALUES部分
    values_start = table_match.end()
    values_str = insert_stmt[values_start:].strip()

    # 移除末尾分号
    if values_str.endswith(';'):
        values_str = values_str[:-1]

    # 使用CSV解析器处理值列表
    rows = []
    current_row = []
    in_quotes = False
    quote_char = None
    current_value = []

    # 预处理：将多行值转换为单行
    values_str = values_str.replace('\n', ' ')

    for char in values_str:
        if not in_quotes and char == '(':
            current_row = []
            continue

        if not in_quotes and char == ')':
            # 完成当前行
            if current_value:
                current_row.append(''.join(current_value).strip())
                current_value = []
            if current_row:
                rows.append(current_row)
            current_row = []
            continue

        if char in ('"', "'") and (not in_quotes or char == quote_char):
            if in_quotes and char == quote_char:
                # 结束引号
                in_quotes = False
                quote_char = None
            else:
                # 开始引号
                in_quotes = True
                quote_char = char
            continue

        if not in_quotes and char == ',':
            # 值分隔符
            if current_value:
                current_row.append(''.join(current_value).strip())
                current_value = []
            continue

        current_value.append(char)

    # 添加最后一个值（如果存在）
    if current_value:
        current_row.append(''.join(current_value).strip())
    if current_row:
        rows.append(current_row)

    return table_name, columns, rows


def parse_value(value):
    """解析单个值并转换为适当类型"""
    if not value:
        return None

    # 处理NULL值
    if value.upper() == 'NULL':
        return None

    # 处理布尔值
    if value.upper() == 'TRUE':
        return True
    if value.upper() == 'FALSE':
        return False

    # 处理引号包裹的字符串
    if re.match(r"^['\"].*?['\"]$", value):
        unquoted = value[1:-1]
        # 处理转义引号
        unquoted = unquoted.replace("''", "'").replace('""', '"')
        return unquoted

    # 处理数字
    try:
        if '.' in value:
            return float(value)
        return int(value)
    except ValueError:
        pass

    return value

def get_sql_from_url(url):
    """从URL获取SQL内容"""
    try:
        response = requests.get(url)
        response.raise_for_status()  # 检查请求是否成功
        return response.text
    except requests.exceptions.RequestException as e:
        return None


def sql_to_dataframe(sql_file_path):
    """将SQL文件中的INSERT语句转换为DataFrame"""
    sql_content = get_sql_from_url(sql_file_path)

    # 分割SQL语句
    statements = re.split(r';\s*\n', sql_content)

    # 解析所有INSERT语句
    data = {}
    for stmt in statements:
        stmt = stmt.strip()
        if not stmt.upper().startswith('INSERT'):
            continue

        table_name, columns, rows = parse_insert_statement(stmt)
        if not table_name or not rows:
            continue

        # 按表名分组数据
        if table_name not in data:
            data[table_name] = {'columns': columns, 'rows': []}

        # 处理每行数据
        for row in rows:
            # 跳过空行
            if not row:
                continue

            # 确保行长度与列数匹配
            if columns and len(row) != len(columns):
                # 尝试重新解析值较少的行
                if len(row) < len(columns):
                    # 合并最后几个值（可能包含逗号）
                    combined_row = row[:len(columns) - 1]
                    combined_row.append(','.join(row[len(columns) - 1:]))
                    row = combined_row
                elif len(row) > len(columns):
                    # 截断多余的值
                    row = row[:len(columns)]

            parsed_row = []
            for val in row:
                parsed_val = parse_value(val)
                parsed_row.append(parsed_val)

            data[table_name]['rows'].append(parsed_row)

    # 创建DataFrame
    dfs = {}
    for table, content in data.items():
        # 如果列名为空，创建默认列名
        if not content['columns']:
            content['columns'] = [f'col_{i}' for i in range(len(content['rows'][0]))]

        df = pd.DataFrame(content['rows'], columns=content['columns'])
        dfs[table] = df

    # 如果只有一个表，直接返回DataFrame
    if len(dfs) == 1:
        return list(dfs.values())[0]
    return dfs


def mask_demo_func(rule_template, all_identify_info_type):
    anonymizer = Anonymizer(origin_table=None, identify_table=None, desensitization_method=rule_template)

    demo = {'name': '王小明',
            'phone': '13511112222',
            "id_number": "340101199003077777",
            'bank': '6222020100123456789',
            "car_id": "京A12345",
            "ip": "192.168.1.1",
            "email": "wangxm@163.com",
            "addr": "北京市东城区富贵路123号",
            "gender": "男",
            "political_status": "中共党员",
            "nation": "汉"}
    result = {}
    for identify_info in all_identify_info_type:
        original_text = demo.get(identify_info)
        if original_text is None:
            original_text = "<暂无示例>"
        if anonymizer.anonymization_method_dict.get(identify_info):
            method = anonymizer.anonymization_method_dict[identify_info]['method']
            args = anonymizer.anonymization_method_dict[identify_info]['arguments']
            mask_record = method(original_text, identify_info, **args)
        else:
            # mask_record = anonymizer.mask(original_text, identify_info)
            mask_record = "******"
        result[identify_info] = (original_text, mask_record)
    return result
