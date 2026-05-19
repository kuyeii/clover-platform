import os
import xml.etree.ElementTree as ET
from io import BytesIO

import numpy as np
import pandas as pd
import requests
# import textract
# from docx import Document
from tempfile import NamedTemporaryFile

from app.util.tool import sql_to_dataframe


def dataset_get_columns(df):
    """
    输入数据表返还数据列名，去除换行符，以匹配的重置数据集目录中的字段名。
    """
    df.columns = df.columns.map(lambda x: str(x).replace('\n', '').replace('\r', ''))
    columnsList = df.columns.tolist()
    return columnsList


def index_map_list(str_se, value):
    index_list = str_se[str_se == value].index.tolist()
    return index_list


# def test(number, requirement, tag):
#     """
#     输入变量阈值检测，输入变量number与阈值进行大小比较，返还输入变量tag。
#     """
#     test = 0
#     if number >= requirement:
#         test = tag
#     else:
#         test = 0
#     return test

def digit_test(se):
    """
    Series取值特征纯数字检测，返还包含检测结果和字符串转化的序列的元组。
    出于后续正则表达式和NLP的目的，需要将Series的数据类型进行字符串转换。
    """
    test_res = 0
    if se.dtype == 'int64' or se.dtype == 'float64':
        test_res = 1
        if se.dtype == 'float64':
            se = se.astype(np.int64)
    str_se = se.astype(str).str.replace(r'(?<=[\u4e00-\u9fff])\s+(?=[\u4e00-\u9fff])', '', regex=True)
    str_se.name = str(str_se.name)
    num_len = str_se.apply(len).max()

    return test_res, str_se, num_len
def de_id_test(str_se):
    """
    序列去标识化检测，输入文本化转化的Series，返还'*'在Series取值中出现的比例。
    """
    counts = 0
    len_str_se = len(str_se)
    for value in str_se:
        if '*' in value:
            counts += 1
    try:
        ratio = counts / len_str_se
    except:
        ratio = None
    return ratio


# def deid_split(text):
#     pattern = re.compile(r'[*]+')
#     p = pattern.split(text)
#     split_text = str(list(filter(None, p)))
#
#     return split_text

def de_status_func(de_ratio, num_max):
    if de_ratio == 1 and num_max < 4:
        return True
    return False

def get_sql_from_url(url):
    """从URL获取SQL内容"""
    try:
        response = requests.get(url)
        response.raise_for_status()  # 检查请求是否成功
        return response.content
    except requests.exceptions.RequestException as e:
        print(f"从URL获取SQL内容失败: {e}")
        return None


def read_text(url, file_type):
    # 统一使用requests获取文件内容
    try:
        response = requests.get(url)
        response.raise_for_status()  # 检查HTTP状态码
        content = response.content  # 获取二进制内容
    except requests.exceptions.RequestException as e:
        print(f"从URL获取文件内容失败: {e}")
        return None

    # 根据文件类型处理内容
    if file_type in ['.txt', '.sql', '.dump']:
        # 尝试不同编码读取文本文件
        encodings = ['utf-8', 'gbk', 'latin-1', 'iso-8859-1']
        for encoding in encodings:
            try:
                # 将二进制内容解码为文本
                text_content = content.decode(encoding)
                # 返回按行分割的文本
                return text_content.splitlines()
            except UnicodeDecodeError:
                continue
        raise ValueError(f"无法解码文件: {url}")

    # elif file_type == '.docx':
    #     try:
    #         # 使用BytesIO将二进制内容转为文件流
    #         docx_file = BytesIO(content)
    #         doc = Document(docx_file)
    #         lines = []
    #         for para in doc.paragraphs:
    #             if para.text.strip():  # 跳过空段落
    #                 # 将段落文本分割为行
    #                 lines.extend(para.text.splitlines())
    #         return lines
    #     except Exception as e:
    #         raise RuntimeError(f"解析DOCX文件失败: {str(e)}")
    #
    # elif file_type == '.doc':
    #     try:
    #         # 创建临时文件处理.doc格式
    #         with NamedTemporaryFile(delete=True, suffix='.doc') as temp_file:
    #             temp_file.write(content)
    #             temp_file.flush()  # 确保内容写入磁盘
    #
    #             # 使用textract处理临时文件
    #             text = textract.process(temp_file.name).decode('utf-8')
    #             return text.splitlines()
    #     except Exception as e:
    #         raise RuntimeError(f"读取.doc文件失败: {str(e)}")

    else:
        raise ValueError(f"不支持的文件类型: {file_type}")

def file_to_dataframe(file_path, file_type):
    if file_type == '.xml':
        try:
            # 下载并解析 XML
            response = requests.get(file_path, timeout=10)
            response.raise_for_status()
            root = ET.fromstring(response.text)

            # 提取数据
            data = []
            for child in root:
                data.append({subchild.tag: subchild.text for subchild in child})

            return pd.DataFrame(data)
        except Exception as e:
            print(f"Error processing XML: {e}")
            return pd.DataFrame()  # 失败时返回空 DataFrame
    elif file_type == '.json':
        try:
            # 1. 获取 JSON 数据
            response = requests.get(file_path, timeout=10)
            response.raise_for_status()  # 确保请求成功
            data = response.json()

            # 2. 检查数据格式是否符合预期
            if not isinstance(data, list) or len(data) < 2:
                raise ValueError("JSON 格式不符合要求：应为列表且至少包含字段名和数据行")

            # 3. 提取字段名（第一行）和数据（第二行开始）
            columns = data[0]
            rows = data[1:]

            # 4. 构建 DataFrame（确保数据行数与列数匹配）
            if len(rows) > 0 and len(rows[0]) != len(columns):
                raise ValueError("数据列数与字段名数量不匹配")
            data = pd.DataFrame(rows, columns=columns)
            data_clean = data.loc[:, data.columns.notna()]
            return data_clean

        except Exception as e:
            print(f"处理 JSON 失败: {e}")
            return pd.DataFrame()  # 返回空 DataFrame 或重新抛出异常
    elif file_type == '.csv':
        df = pd.read_csv(file_path)
        return df
    elif file_type == '.sql':
        df = sql_to_dataframe(file_path)
        return df
    else:
        df = pd.read_excel(file_path)
        return df

