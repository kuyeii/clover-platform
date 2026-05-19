# -- coding: utf-8 --
# @Time : 2024/3/1 16:03
# @Author : Yao Sicheng
import pandas as pd
from sqlalchemy import create_engine


def get_all_field_comments(inspector, database_source_conn_engine_str, database_source_table_name):
    """
    获取数据库所有字段注释
    """
    # 使用create_engine建立到MySQL数据库的连接
    engine = create_engine(database_source_conn_engine_str)

    # 构建查询语句
    query = f"SHOW FULL COLUMNS FROM `{database_source_table_name}`"

    # 执行查询并读取数据到DataFrame
    df = pd.read_sql(query, con=engine)

    # 将DataFrame转换为字典，键为字段名，值为字段的注释（comment）
    field_comment_dict = {}
    for index, row in df.iterrows():
        field_comment_dict[row['Field']] = row['Comment'] if row['Comment'] else None

    comment_field_dict = {}
    for index, row in df.iterrows():
        if row['Comment']:
            comment_field_dict[row['Comment']] = row['Field']
    return field_comment_dict, comment_field_dict


#
# class MysqlInputOutput(BaseInputOutput):
#     """MySQL的输入类"""
#     def __init__(self, connection):
#         self.engine = create_engine(connection)
#         """存储表的元数据信息以及读取情况记录"""
#         self.metadata_information = {'table_name': None,
#                                      'field': [],
#                                      'col': [],
#                                      'key_field_or_comment': None,
#                                      'key_field': None,
#                                      'last_id': 0}
#
#     def get_all_tables(self, need_col=True):
#         """
#         返回连接凭证数据库中所有的表名与字段名
#         :param need_col: 是否需要字段信息
#         :param connection: 连接凭证
#         :return: [[table_name,field1,field2], [table_name2,field1,field2]]
#         """
#         table_columns_list = []
#
#         inspector = inspect(self.engine)
#
#         all_tables = inspector.get_table_names()
#         if not need_col:
#             return all_tables
#         for table in all_tables:
#             columns = inspector.get_columns(table)
#             table_columns_list.append(
#                 [table] + [col["comment"] if col["comment"] is not None else col["name"] for col in columns])
#         return table_columns_list
#
#     def read_table_to_dataframe(self, table_name, field_list=None, start=0, offset=0):
#         # TODO 修改表格切分格式
#         """
#         读取一张数据库表的指定行
#         :param field_list:
#         :param table_name: 数据库中表的名称
#         :param start: 开始的行数
#         :param offset: 偏移量
#         :return: 指定行数的pd.DataFrame，若不存在，返回空的表
#         """
#         """判断已保存的元数据是否是当前表的元信息，如果是直接读取，否则进行处理"""
#         if self.metadata_information['table_name'] == table_name:
#             col = self.metadata_information['col']
#             field = self.metadata_information['field']
#             key_field_or_comment = self.metadata_information['key_field_or_comment']
#             key_field = self.metadata_information['key_field']
#
#         else:
#             key_field = None
#             key_field_or_comment = None
#             query_field_name = "SHOW FULL COLUMNS FROM `{}`".format(table_name)
#             field_name_df = pd.read_sql_query(query_field_name, self.engine)
#             key_record = field_name_df[(field_name_df["Key"] == "PRI") & (field_name_df["Extra"] == "auto_increment")]
#             # 若有自增主键，读取主键的字段名与字段注释名
#             if len(key_record) > 0:
#                 key_field = key_record.iloc[0]["Field"]
#                 key_field_or_comment = key_record.iloc[0]["Comment"] if key_record.iloc[0]["Comment"] != "" else key_record.iloc[0]["Field"]
#             # 若给定了字段集合，有自增主键，且不在给定的字段集合中，则在字段集合中添加自增主键，并对表进行删改
#             if field_list is not None:
#                 if len(key_record) > 0 and key_field not in field_list:
#                     field_list.append(key_field)
#                 field_name_df = field_name_df[field_name_df['Field'].isin(field_list)]
#
#             comment = field_name_df["Comment"].to_list()
#             field = field_name_df["Field"].to_list()
#             # key_record = field_name_df[(field_name_df["Key"] == "PRI") & (field_name_df["Extra"] == "auto_increment")]
#             # if len(key_record) > 0:
#             #     key_field = key_record.iloc[0]["Comment"] if key_record.iloc[0]["Comment"] != "" else key_record.iloc[0]["Field"]
#             col = [comment[i] if comment[i] != '' else field[i] for i in range(len(field))]
#             """将新的元数据信息记录"""
#             self.metadata_information['table_name'] = table_name
#             self.metadata_information['col'] = col
#             self.metadata_information['field'] = field
#             self.metadata_information['key_field_or_comment'] = key_field_or_comment
#             self.metadata_information['key_field'] = key_field
#             self.metadata_information['last_id'] = 0
#         if offset != 0:
#             if key_field is not None:
#                 last_id = self.metadata_information['last_id']
#                 if field_list is not None:
#                     query = "SELECT `{}` FROM `{}` WHERE `{}` > {} LIMIT {}".format("`,`".join(field), table_name,
#                                                                                     key_field, last_id, offset)
#                 else:
#                     query = "SELECT * FROM `{}` WHERE `{}` > {} LIMIT {}".format(table_name, key_field, last_id,
#                                                                                  offset)
#             else:
#                 if field_list is not None:
#                     query = "SELECT `{}` FROM `{}` LIMIT {},{}".format("`,`".join(field), table_name, start, offset)
#                 else:
#                     query = "SELECT * FROM `{}` LIMIT {},{}".format(table_name, start, offset)
#         else:
#             if field_list is not None:
#                 query = "SELECT `{}` FROM `{}`".format("`,`".join(field), table_name)
#             else:
#                 query = f"SELECT * FROM `{table_name}`"
#         try:
#             df = pd.read_sql_query(query, self.engine)
#         except:
#             return None, "error", None
#         if len(df) == 0:
#             return None, None, None
#         df.columns = col
#         if key_field_or_comment is not None:
#             self.metadata_information['last_id'] = df.iloc[-1][key_field_or_comment]
#         mapping = {k: v for k, v in zip(col, field)}
#         return df, key_field_or_comment, mapping
#         # return df, key_field_or_comment
#
#     def drop_table(self, table_name):
#         """
#         如果表存在，则删除表。
#         """
#         if self.engine is None:
#             print("No valid engine provided.")
#             return
#
#         try:
#             with self.engine.connect() as connection:
#                 drop_table_query = text(f"DROP TABLE IF EXISTS `{table_name}`")
#                 connection.execute(drop_table_query)
#                 print(f"Table '{table_name}' has been dropped (if it existed).")
#         except SQLAlchemyError as e:
#             print(f"Error dropping table '{table_name}': {e}")
