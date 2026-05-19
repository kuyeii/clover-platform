# -- coding: utf-8 --
# @Time : 2023/7/25 10:04
# 表层级识别流程模块
import collections
import copy
from typing import Union

import pandas as pd

from app.extension.celery_task.pipt_task.assets.constant import RECORDS_KEYS, LOG_LOCATION
from app.extension.celery_task.pipt_task.utils.tool import get_logger
from .field_identify import query_all_fields
from .identify_model import HanPersonIdentify
from ..assets.area_levels import area_dict


class IdentifyAnalytics:

    def __init__(self, config):
        self.config = config
        self.logger = get_logger(LOG_LOCATION)
        self.person_identify = HanPersonIdentify(self.logger, config)

    def identify_naive_func(self, lines, info_list):
        all_identify_list = []
        # 如果姓名地址都需要识别时，合并两个识别项
        if 'name' in info_list and 'addr' in info_list:
            info_list.remove('name')
            info_list.remove('addr')
            info_list.append('name_addr')
        for index, line in enumerate(lines):
            identify_list_line = []
            for info in info_list:
                identify_list = self.person_identify.naive_regex_identify(info, line)
                if identify_list:
                    identify_list = self.merge_continuous_addresses(identify_list)
                    identify_list_line.extend(identify_list)
            # 所有信息识别完后将临时保存的ner识别结果置空
            if identify_list_line:
                identify_list_line = sorted(identify_list_line, key=lambda x: x[2])
                all_identify_list.append((index, identify_list_line))
        return all_identify_list

    def merge_continuous_addresses(self, entities):
        """
        仅合并连续的addr类型实体，并确保结果按起始位置排序
        :param entities: 实体列表，格式为[(类型, 内容, 开始位置, 结束位置), ...]
        :return: 合并后的实体列表（按起始位置排序）
        """
        if not entities:
            return []

        # 按开始位置排序（确保处理顺序正确）
        entities = sorted(entities, key=lambda x: x[2])

        merged = []
        current_group = []  # 当前addr合并组

        for entity in entities:
            etype, text, start, end = entity

            # 仅处理addr类型
            if etype == 'addr':
                if not current_group:
                    # 开始新的addr组
                    current_group = [entity]
                else:
                    # 检查是否连续：当前实体起始位置 = 上一实体结束位置
                    last_entity = current_group[-1]
                    if start == last_entity[3]:
                        # 连续addr，加入当前组
                        current_group.append(entity)
                    else:
                        # 不连续，合并当前组并开始新组
                        entities_merged = self.merge_entities(current_group)
                        if entities_merged is not None:
                            merged.append(entities_merged)
                            current_group = [entity]
            else:
                # 遇到非addr实体
                if current_group:
                    # 先合并已有的addr组
                    entities_merged = self.merge_entities(current_group)
                    if entities_merged is not None:
                        merged.append(entities_merged)
                        current_group = []
                # 直接添加非addr实体
                merged.append(entity)

        # 处理最后剩余的addr组
        if current_group:
            entities_merged = self.merge_entities(current_group)
            if entities_merged is not None:
                merged.append(entities_merged)

        # 最终结果按起始位置排序
        return sorted(merged, key=lambda x: x[2])

    def merge_entities(self, entity_group):
        """
        合并实体组内的所有实体
        :param entity_group: 同类型连续实体列表
        :return: 合并后的单个实体
        """
        if not entity_group:
            return None

        # 获取组内所有实体内容
        merged_text = ''.join(e[1] for e in entity_group)
        if area_dict.get(merged_text) in [0, 1, 2]:
            return None
        # 第一个实体的类型和起始位置
        etype = entity_group[0][0]
        start = entity_group[0][2]

        # 最后一个实体的结束位置
        end = entity_group[-1][3]
        return (etype, merged_text, start, end)

    def identify_core_func(self, data, field_name_type_dict, person_status, table_name, info_type_list,
                           key_field: Union[str, None]=None,
                           index_from=0) -> Union[pd.DataFrame, None]:
        """
        表层级识别核心方法，调用字段级识别方法进行识别，并将每个字段的识别结果进行整合并最终输出

        :param data: 待识别表
        :param table_name: 待识别表名
        :param key_field: 待识别字段
        :param person_identify: 基础识别类
        :param logger: 日志，_get_logger生成的对象
        :param config: 配置字典，从config.yaml读入
        :param index_from: 待识别表的子表索引
        :return: 识别结果
        """
        output_dataframe_list = []
        records_keys = copy.deepcopy(RECORDS_KEYS)
        for custom_info, _ in self.person_identify.custom_identify_type_list:
            records_keys.append(f'{custom_info}_records')
        """字段级快筛"""
        # field_list = data.columns.to_list()
        # title_column_list = [table_name] + field_list
        # # field_name_type_dict, person_status = self.sen2per(title_column_list)
        """进行逐字段扫描"""
        tempo_records_list, tempo_column_list, global_records_list = query_all_fields(data, field_name_type_dict, person_status, table_name,info_type_list, self.person_identify,
                                                                                      self.logger, self.config)

        """进行识别结果汇总"""
        for record_index, (tempo_records, field_name, global_records)\
                in enumerate(zip(tempo_records_list, tempo_column_list, global_records_list)):
            # 字段识别结果为空
            if tempo_records is None or not global_records:
                continue
            # 识别结果整合字典
            sensitive_records_dict = collections.defaultdict(str)
            sensitive_type_dict = collections.defaultdict(str)

            # 表名、字段名、原始内容首先填入结果表
            raw_data = data.iloc[global_records, record_index]
            result_table_dict = {
                'origin_table_name': table_name,
                'origin_field_name': field_name,
                'origin_content': raw_data,
                'sensitive_records': '',
                'sensitive_type': ''
            }
            # 若存在自增主键，添加主键列
            if key_field is not None:
                origin_id = data[key_field].iloc[global_records]
                result_table_dict[key_field] = origin_id

            output_dataframe = pd.DataFrame(result_table_dict).fillna('')

            for key in records_keys:
                for index, values in list(tempo_records[key].items()):

                    sensitive_records_dict[index] += "; ".join(values) + "; "

                    sensitive_type_dict[index] += (key[:-8] + "; ") * len(values)

            output_dataframe['sensitive_records'] = [sensitive_records_dict[key]
                                                     for key in sorted(sensitive_records_dict.keys())]
            output_dataframe['sensitive_type'] = [sensitive_type_dict[key]
                                                  for key in sorted(sensitive_type_dict.keys())]
            output_dataframe_list.append(output_dataframe)

        if not output_dataframe_list:
            return None
        # 拼接所有字段的识别结果表
        identify_result = pd.concat(output_dataframe_list, axis=0).dropna(how='all', axis=1).sort_index()
        identify_result.index += (1 + index_from)
        identify_result.index.name = 'origin_table_index'
        identify_result['origin_table_name'] = table_name

        return identify_result.reset_index()

    def __call__(self, *args, **kwargs):
        return self.identify_core_func(*args, **kwargs)
