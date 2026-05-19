# -- coding: utf-8 --
# @Time : 2024/7/1 10:43
# @Author : Yao Sicheng
import re

import pandas as pd

from app.extension.celery_task.pipt_task.assets.area_levels import area_dict
from app.extension.celery_task.pipt_task.assets.constant import individual_merchants_regex, book_regex, COUNTRY


class ResultHandle:
    """对输出结果进行配置，用于对需求进行调整"""

    def __init__(self, config):
        """初始化敏感信息识别模块"""
        self.config = config

    # def result_type_statistics(self, result_df, field):
    #     """统计给定的识别结果表指定字段的类型信息字典"""
    #     result_df_process = result_df[result_df['origin_field_name'] == field]
    #     if len(result_df_process) == 0:
    #         return {}
    #     # 拆分type列并展开成一个Series
    #     types = result_df_process["sensitive_type"].str.split('; ').apply(pd.Series).stack().str.strip()
    #
    #     # 过滤掉空字符串
    #     types = types[types != '']
    #
    #     # 统计每种类型的频次
    #     type_counts_dict = types.value_counts().to_dict()
    #     return type_counts_dict
    #
    # def remove_type_info(self, target_type, record, type_):
    #
    #     """
    #     用于去除指定的信息类型
    #     target_field: 要作用于删除的目标字段
    #
    #     field: 字段
    #     record: 记录
    #     type:
    #     """
    #     # if target_field != field:
    #     #     return record, type_
    #     record_parts = record.split('; ')[:-1]
    #     type_parts = type_.split('; ')[:-1]
    #     filtered_content = []
    #     filtered_type = []
    #     for part, t in zip(record_parts, type_parts):
    #         if t != target_type:
    #             filtered_content.append(part)
    #             filtered_type.append(t)
    #     if not filtered_type:
    #         return "", ""
    #     return '; '.join(filtered_content) + "; ", ';'.join(filtered_type) + "; "

    @staticmethod
    def org_handel(series):
        # 正则表达式匹配2到3个中文字符的内容
        pattern = r'^[\u4e00-\u9fa5]{2,3}$'

        # 抽取符合条件的内容
        filtered_data = series[series.str.contains(pattern, regex=True)]

        return filtered_data

    # def identify_result_analytics(self, result_df, field2type_dict):
    #     """用于根据一个字段中识别情况去除误识别的信息"""
    #     if len(result_df) == 0:
    #         return result_df
    #     for field, field_type in field2type_dict.items():
    #         if 'addr_like_columns_regex' == field_type:
    #             type_dict = self.result_type_statistics(result_df, field)
    #             # 如果人名在这个字典中被统计到了，且这个
    #             if "name" in type_dict and "addr" in type_dict:
    #                 # 识别处理模块，当一个地址字段中 识别到的地址/识别到的人名 小于ADDR_MULTIPLIER时，说明这些人名是误识别的
    #                 if ADDR_MULTIPLIER * type_dict["name"] < type_dict["addr"]:
    #                     result_df[['content', 'type_']] = result_df.apply(lambda row: pd.Series(
    #                         self.remove_type_info(field, "name", row["origin_field_name"], row["sensitive_records"],
    #                                               row['sensitive_type'])), axis=1)
    #                     result_df = self.post_handle(result_df)
    #     return result_df

    # def id_result_analytics(self, result_df, field_name_type_dict):
    #     """用于根据一个字段中识别情况去除误识别的信息"""
    #     if len(result_df) == 0:
    #         return result_df
    #     id_df = result_df[result_df['sensitive_type'] == 'ID; ']
    #     if len(id_df) == 0:
    #         return result_df
    #     else:
    #         remove_id_col_list = []
    #         id_col_list = list(id_df['origin_field_name'].unique())
    #         for id_col in id_col_list:
    #             """
    #             # 字段类型为id_like_columns_regex，跳出
    #             样本数小于20
    #                 包含XX许可证，删
    #                 不包含XX许可证,跳出
    #             样本数大于20
    #                 没有X，删
    #                 有X，跳出
    #             """
    #             if field_name_type_dict[id_col] == "id_like_columns_regex":
    #                 return result_df
    #             temp_df = id_df[id_df['origin_field_name'] == id_col]
    #             if len(temp_df['sensitive_records'].unique()) < 20 :
    #                 match = re.search(r".+许可证", id_col)
    #                 if match is not None:
    #                     remove_id_col_list.append(id_col)
    #             else:
    #                 contains_x = temp_df['sensitive_records'].str.endswith('X; ')
    #                 result = contains_x.any()
    #                 if not result:
    #                     remove_id_col_list.append(id_col)
    #         if remove_id_col_list:
    #             result_df = result_df[~((result_df['origin_field_name'].isin(remove_id_col_list)) & (
    #                         result_df['sensitive_type'] == 'ID; '))]
    #     return result_df
    #
    #
    #
    # def phone_result_analytics(self, result_df, field_name_type_dict):
    #     """
    #     用于根据一个字段中识别情况去除误识别的信息
    #     过滤情况
    #     1.如果字段名符合要求，不过滤，如果整个表没有个人，过滤。
    #     2.如果没有个人或非重复的记录行大于3，且超过一半有多个0，过滤
    #     3.当该字段非重复手机号不到10个，且(字段快筛结果不是非敏感字段或识别到个人)，直接放行
    #     4.如果有个人非重复记录行大于10，前三位组合的占比出现某一个超过20%，过滤
    #     """
    #
    #     if len(result_df) == 0:
    #         return result_df
    #     phone_df = result_df[result_df['sensitive_type'] == 'phone; ']
    #     if len(phone_df) == 0:
    #         return result_df
    #     else:
    #         remove_phone_col_list = []
    #         phone_col_list = list(phone_df['origin_field_name'].unique())
    #         for phone_col in phone_col_list:
    #             if field_name_type_dict[phone_col] == 'phone_like_columns_regex':
    #                 continue
    #             # 如果快筛没有个人，看识别结果里是否有个人
    #             if not self.config['personal_handle']:
    #                 contains_person = result_df['sensitive_type'].str.contains('name|political|ID|gender|nation',
    #                                                                            case=False, na=False).any()
    #             else:
    #                 contains_person = True
    #             # 如果没有任何个人信息，直接删除
    #             if not contains_person:
    #                 remove_phone_col_list.append(phone_col)
    #                 continue
    #             # 如果没有有个人信息，进行排查
    #             temp_df = phone_df[phone_df['origin_field_name'] == phone_col]
    #             if len(temp_df['sensitive_records'].unique()) > 3:
    #                 # 计算手机号里有2个0以上的记录占比
    #                 contains_two_or_more_zeros = temp_df['sensitive_records'].str.count('0').ge(2)
    #                 # 计算符合条件的记录数量
    #                 num_records_with_two_or_more_zeros = contains_two_or_more_zeros.sum()
    #                 # 计算总记录数
    #                 total_records = len(temp_df)
    #                 # 计算占比
    #                 percentage = (num_records_with_two_or_more_zeros / total_records)
    #                 # 占到一半以上，删除
    #                 if percentage > 0.5:
    #                     remove_phone_col_list.append(phone_col)
    #                     continue
    #                 # 当该字段非重复手机号不到10个，且(字段快筛结果不是非敏感字段或识别到个人)，直接放行
    #             if len(temp_df['sensitive_records'].unique()) < 10 and field_name_type_dict[phone_col] != 'no_sensitive':
    #                 continue
    #             else:
    #                 temp_df['phone_prefix'] = temp_df['sensitive_records'].str[:3]
    #                 freq = temp_df['phone_prefix'].value_counts()
    #                 max_freq = freq.max()
    #                 # 5. 计算最大频率
    #                 max_freq_rate = max_freq / len(temp_df)
    #                 if max_freq_rate > 0.2:
    #                     remove_phone_col_list.append(phone_col)
    #         if remove_phone_col_list:
    #             result_df = result_df[~((result_df['origin_field_name'].isin(remove_phone_col_list)) & (result_df['sensitive_type'] == 'phone; '))]
    #     return result_df
    # def addr_result_analytics(self, result_df):
    #     """根据快筛模块与识别模块中是否包含个人主体，从而排除掉非个人地址"""
    #     if len(result_df) == 0:
    #         return result_df
    #     # 检查表中是否识别到姓名
    #     if not self.config['personal_handle']:
    #         # Find rows where 'name' or 'ID' is in sensitive_type
    #         condition = result_df['sensitive_type'].str.contains('name|political|ID|gender|nation', case=False,
    #                                                                    na=False)
    #         condition_list = result_df.loc[condition, 'origin_table_index'].unique()
    #
    #         # For rows not in A, remove 'addr' from sensitive_type
    #         def remove_addr(row):
    #             if row['origin_table_index'] not in condition_list:
    #                 records = row['sensitive_records'].split("; ")
    #                 types = row['sensitive_type'].split("; ")
    #
    #                 # Only keep addr if there's also 'name' or 'ID'
    #                 filtered_records = [rec for rec, typ in zip(records, types) if typ != 'addr']
    #                 filtered_types = [typ for typ in types if typ != 'addr']
    #
    #                 row['sensitive_records'] = "; ".join(filtered_records)
    #                 row['sensitive_type'] = "; ".join(filtered_types)
    #
    #             return row[['sensitive_records', 'sensitive_type']]
    #
    #         result_df[['content', 'type_']] = result_df.apply(remove_addr, axis=1)
    #         result_df = self.post_handle(result_df)
    #     return result_df
    #
    @staticmethod
    def addr_black_func(addr):
        """去除 浙江省、杭州市、浙江、杭州的情况"""
        if addr in area_dict:
            # if area_dict[addr] == PROVINCE or area_dict[addr] == CITY or area_dict[addr] == COUNTRY:
            if area_dict[addr] == COUNTRY:
                return False
        return True
    # @staticmethod
    # def person_black_func(origin_content, name):
    #     """去除不正确的人名"""
    #     if origin_content == name:
    #         return True
    #     return False
    # def book_process_row(self, content, record, type_):
    #     """ 文书号检测"""
    #     book_match = list(re.finditer(book_regex, str(content)))
    #     # 检测到了文书号
    #     if book_match:
    #
    #         record_parts = record.split('; ')[:-1]
    #         type_parts = type_.split('; ')[:-1]
    #
    #         if len(record_parts) != len(type_parts):
    #             raise ValueError("识别内容和识别类型的长度不匹配")
    #
    #         filtered_content = []
    #         filtered_type = []
    #
    #         for part, t in zip(record_parts, type_parts):
    #             # 识别内容属于文书号一部分的flag
    #             target_flag = False
    #             if t == 'addr' or t == 'name':
    #                 for match in book_match:
    #                     if part in match.group():
    #                         target_flag = True
    #                         break
    #                 if not target_flag:
    #                     filtered_content.append(part)
    #                     filtered_type.append(t)
    #
    #             else:
    #                 filtered_content.append(part)
    #                 filtered_type.append(t)
    #         if not filtered_type:
    #             return "", ""
    #         return '; '.join(filtered_content) + "; ", '; '.join(filtered_type) + "; "
    #     return record, type_
    #
    # def addr_process_row(self, record, type_):
    #     content_parts = record.split('; ')[:-1]
    #     type_parts = type_.split('; ')[:-1]
    #
    #     if len(content_parts) != len(type_parts):
    #         raise ValueError("content 和 type 的长度不匹配")
    #
    #     filtered_content = []
    #     filtered_type = []
    #
    #     for part, t in zip(content_parts, type_parts):
    #         if t == 'addr':
    #             if self.addr_black_func(part):
    #                 filtered_content.append(part)
    #                 filtered_type.append(t)
    #         else:
    #             filtered_content.append(part)
    #             filtered_type.append(t)
    #     if not filtered_type:
    #         return "", ""
    #     return '; '.join(filtered_content) + "; ", '; '.join(filtered_type) + "; "
    #
    # def person_addr_process_row(self, origin_content, content, type_, field_type):
    #     """
    #     去除异常的人名与地址
    #     """
    #     if field_type == "org_like_columns_regex" or field_type ==  "person_org_columns_regex":
    #         # 如果内容中包含的是某某店，且识别结果只有addr,去除其中的所有的地址
    #         individual_merchants_match = list(re.finditer(individual_merchants_regex, origin_content))
    #         if individual_merchants_match:
    #             type_set_list = list(set(type_.split('; ')[:-1]))
    #             if len(type_set_list) == 1 and type_set_list[0] == "addr":
    #                 return "", ""
    #         content_parts = content.split('; ')[:-1]
    #         type_parts = type_.split('; ')[:-1]
    #         if len(content_parts) != len(type_parts):
    #             raise ValueError("content 和 type 的长度不匹配")
    #         filtered_content = []
    #         filtered_type = []
    #
    #         for part, t in zip(content_parts, type_parts):
    #             if t == 'name':
    #                 if self.person_black_func(origin_content, part):
    #                     filtered_content.append(part)
    #                     filtered_type.append(t)
    #             elif t == 'addr':
    #                 continue
    #             else:
    #                 filtered_content.append(part)
    #                 filtered_type.append(t)
    #
    #         if not filtered_type:
    #             return "", ""
    #         return '; '.join(filtered_content) + "; ", '; '.join(filtered_type) + "; "
    #     elif field_type == "addr_like_columns_regex":
    #         pass
    #     return content, type_
    #
    # def rough_addr_handle(self, result_df):
    #     """对粗略地址的拦截处理"""
    #     if len(result_df) == 0:
    #         return result_df
    #     result_df[['content', 'type_']] = result_df.apply(lambda row: pd.Series(
    #         self.addr_process_row(row['sensitive_records'], row['sensitive_type'])), axis=1)
    #     post_handle_result = self.post_handle(result_df)
    #     return post_handle_result
    #
    # def book_person_addr_handle(self, result_df):
    #     """对文书号中的人名地址拦截处理"""
    #     if len(result_df) == 0:
    #         return result_df
    #     result_df[['content', 'type_']] = result_df.apply(lambda row: pd.Series(
    #         self.book_process_row(row['origin_content'], row['sensitive_records'], row['sensitive_type'])), axis=1)
    #     post_handle_result = self.post_handle(result_df)
    #     return post_handle_result
    #
    # # def addr_person_handle(self, result_df):
    # #     """对地址中的人名的拦截处理"""
    #
    # def org_person_addr_handle(self, result_df, field_name_type_dict):
    #     """对机构名中的人名、地址的拦截请求"""
    #     if len(result_df) == 0:
    #         return result_df
    #     result_df[['content', 'type_']] = result_df.apply(lambda row: pd.Series(
    #         self.person_addr_process_row(row['origin_content'], row['sensitive_records'], row['sensitive_type'],
    #                                      field_name_type_dict.get(row['origin_field_name'], None))), axis=1)
    #     post_handle_result = self.post_handle(result_df)
    #     return post_handle_result
    # def post_handle(self, result_df):
    #     """拦截处理后，替换掉原来的字段"""
    #     result_df = result_df[result_df['content'] != '']
    #     result_df = result_df.drop(columns=['sensitive_records'], inplace=False)
    #     result_df = result_df.drop(columns=['sensitive_type'], inplace=False)
    #     result_df.rename(columns={'content': 'sensitive_records'}, inplace=True)
    #     result_df.rename(columns={'type_': 'sensitive_type'}, inplace=True)
    #     cols = result_df.columns.tolist()
    #     # 正常情况下应该有6个字段，7个说明里面有个主键字段，需要调整位次
    #     if len(cols) == 7:
    #         cols = cols[:4] + cols[-2:] + [cols[4]]
    #         result_df = result_df[cols]
    #     return result_df
    #
    # # def field_type_analytics(self, result_df):
    # #     """分析表中的字段名情况"""
    # #     if len(result_df) == 0:
    # #         return {}
    # #     field_list = list(result_df['origin_field_name'].unique())
    # #     result_df_title = result_df["origin_table_name"].iloc[0]
    # #     table_columns = [result_df_title] + field_list
    # #     field2type_dict = self.field_predict.field_judge(table_columns)
    # #     return field2type_dict
    # def result_handle_core(self, result_df, field_name_type_dict, handle_type_list=None):
    #     all_handle_list = self.config["handle_type"]
    #     if result_df is not None:
    #         if handle_type_list is None:
    #             handle_type_list = all_handle_list
    #         for handel in handle_type_list:
    #             if handel == "ORG":
    #                 result_df = self.org_person_addr_handle(result_df, field_name_type_dict)
    #             elif handel == "BOOK":
    #                 result_df = self.book_person_addr_handle(result_df)
    #             elif handel == 'ADDR':
    #                 result_df = self.addr_result_analytics(result_df)
    #             elif handel == "ROUGH_ADDR":
    #                 result_df = self.rough_addr_handle(result_df)
    #             elif handel == 'PHONE':
    #                 result_df = self.phone_result_analytics(result_df, field_name_type_dict)
    #             elif handel == 'id_number':
    #                 result_df = self.id_result_analytics(result_df, field_name_type_dict)
    #             else:
    #                 raise ValueError(f"输入的处理项不正确，请从{all_handle_list}中选择")
    #         return result_df
    #     return None
    #
    # def __call__(self, *args, **kwargs):
    #     return self.result_handle_core(*args, **kwargs)
    #
