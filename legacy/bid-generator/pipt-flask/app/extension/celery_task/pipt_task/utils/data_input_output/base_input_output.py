# -- coding: utf-8 --
# @Time : 2024/3/25 9:10
# @Author : Yao Sicheng
import os
from abc import abstractmethod


class BaseInputOutput:

    @abstractmethod
    def get_all_tables(self):
        pass

    @abstractmethod
    def read_table_to_dataframe(self, table_name, field_list, start, offset):
        pass

    @staticmethod
    def save_to_sql(save_engine, table_name, output, index=None):
        if index is None:
            output.to_sql(table_name, save_engine, index=False, if_exists="replace")
        else:
            output.to_sql(table_name, save_engine, index=False, if_exists="replace" if index == 0 else "append")

    @staticmethod
    def save_to_file(save_path, table_name, output, index=None):
        if index is None:
            output.to_excel(os.path.join(save_path, table_name + ".xlsx"),
                            engine='xlsxwriter', index=False)
        else:
            output.to_excel(os.path.join(save_path, table_name + f"_{index}.xlsx"),
                            engine='xlsxwriter', index=False)
