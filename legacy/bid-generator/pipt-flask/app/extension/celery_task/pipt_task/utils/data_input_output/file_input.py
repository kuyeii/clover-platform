# -- coding: utf-8 --
# @Time : 2024/3/1 16:13
# @Author : Yao Sicheng
import os

import pandas as pd

from app.api.piptool.biz.data_input_output.base_input_output import BaseInputOutput


class FileInputOutput(BaseInputOutput):
    def __init__(self, file_path):
        self.file_path = file_path
        self.first_row = None

    def get_all_tables(self, need_col=True):

        """
        读取所有表的字段信息，生成一个列表，列表中的元素为 (表名, 字段列表）
        :return: [[table1_name, table1_field1,table1_filed2], [table2_name, table2_field1,table2_filed2]]
        """
        if not need_col:
            return os.listdir(self.file_path)
        tables_fields = []
        for file_name in os.listdir(self.file_path):
            if file_name.endswith(('.xls', '.xlsx', '.csv')):
                file_full_path = os.path.join(self.file_path, file_name)
                if file_name.endswith('.csv'):
                    df = pd.read_csv(file_full_path, header=0, nrows=0)
                else:
                    df = pd.read_excel(file_full_path, header=0, nrows=0)
                # 将第一行转换为列表并返回
                fields = df.columns.tolist()
                tables_fields.append([file_name] + fields)
        return tables_fields

    def read_table_to_dataframe(self, table_name, field_list=None, start=None, offset=None):
        """
        读取一张csv/xlsx/xls表的指定行

        :param field_list: 要读取的列
        :param table_name: 表名
        :param start: 开始的行数
        :param offset: 偏移量

        :return: 指定行数的pd.DataFrame，若不存在，返回空list
        """
        # 计算要跳过的行数
        # skip_rows = start
        # 计算要读取的行数
        table_full_path_name = os.path.join(self.file_path, table_name)
        # 使用 pandas 的 read_excel() 函数读取指定的行，当指定行已经超过该表的总行数时，捕捉pd.errors.EmptyDataError，返回None
        try:
            if start is None and offset is None:
                if table_name.endswith('.csv'):
                    specific_rows_data = pd.read_csv(table_full_path_name)
                else:
                    specific_rows_data = pd.read_excel(table_full_path_name)
                    if len(specific_rows_data) == 0:
                        return None, None, None
            elif start == 0:
                if table_name.endswith('.csv'):
                    specific_rows_data = pd.read_csv(table_full_path_name, skiprows=start, nrows=offset)
                else:
                    specific_rows_data = pd.read_excel(table_full_path_name, skiprows=start, nrows=offset)
                    if len(specific_rows_data) == 0:
                        return None, None, None
                self.first_row = specific_rows_data.columns.to_list()
            else:
                if table_name.endswith('.csv'):
                    # 需要跳过完整表的第一行字段名，所以skiprows要+1
                    specific_rows_data = pd.read_csv(table_full_path_name, skiprows=start + 1, nrows=offset,
                                                     header=None)
                else:
                    specific_rows_data = pd.read_excel(table_full_path_name, skiprows=start + 1, nrows=offset,
                                                       header=None)
                    if len(specific_rows_data) == 0:
                        return None, None, None
                # self.first_row为None说明这是从子表开始执行的情况，需要将完整表的第一行读取作为字段名，f.readline()方法会保留双引号，因此需要去除
                if self.first_row is None:
                    with open(table_full_path_name, 'r') as f:
                        self.first_row = f.readline().strip().replace('"', '').split(',')
                specific_rows_data.columns = self.first_row
            if field_list is not None:
                specific_rows_data = specific_rows_data.loc[:, field_list]
            return specific_rows_data, None, None
        except pd.errors.EmptyDataError:
            return None, None, None
