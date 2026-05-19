# -- coding: utf-8 --
"""
整合几种简单的，字符串级别的脱敏方法
包括：
遮盖、哈希、对称加密
TODO：FPE
TODO: 更多异常处理，比如输入参数格式不正确、输入脱敏方法不支持等等
TODO： 目前脱敏是直接使用replace完成的。能否用别的记录index位置等方式提升速度？
"""

import os
import re
import hashlib
from base64 import b64encode
from typing import Union, Optional

import pandas
import pandas as pd
from gmssl.sm4 import CryptSM4, SM4_ENCRYPT
from faker import Faker

# from app.extension.celery_task.pipt_task.assets.bin_dict import bin_dict
from app.extension.celery_task.pipt_task.desensitize.mask.mask_method import *
from app.extension.celery_task.pipt_task.desensitize.pseudonymization.faker_provider import PseudoProvider


class Anonymizer:
    def __init__(self, origin_table: Union[None, pandas.DataFrame], identify_table: Union[None, pandas.DataFrame],
                 desensitization_method: Union[list, dict] is None):
        self.origin_table = origin_table
        self.identify_table = identify_table
        self.desensitization_method = desensitization_method
        self.anonymization_method_dict = dict()  # 将传入的desensitization_method转化，存储指定的脱敏方法与参数
        self.get_anonymization_config()
        # self.supported_methods = {
        #     'hash_text':['addr', 'name', 'ip', 'phone', 'phone', 'id_number', 'car_id', 'email', 'bank', 'gender', 'nation', 'political_status'],
        #     'sm4_encrypt_text':['addr', 'name', 'ip', 'phone', 'phone', 'id_number', 'car_id', 'email', 'bank', 'gender', 'nation', 'political_status'],
        #     'pseudonymize':['addr', 'name', 'ip', 'phone', 'phone', 'id_number', 'car_id', 'email', 'bank']
        #     'mask':['addr', 'name', 'ip', 'phone', 'phone', 'id_number', 'car_id', 'email', 'bank', 'gender', 'nation', 'political_status']
        # }

    def hash_text(self, record, record_type, kept_len=22):
        """
        使用sha256对文本进行哈希
        哈希后文本过长（44），默认保留一半输出
        """
        if not (type(kept_len) is int and kept_len > 0):
            raise ValueError('传入的"脱敏后截取长度"参数异常')
        bytes_record = record.encode('utf-8')
        sha256_hash = hashlib.sha256()
        sha256_hash.update(bytes_record)
        b64_hashed_str = b64encode(sha256_hash.digest()).decode("utf-8")
        # 完整的SHA256结果过长，截取前kept_len位输出
        return b64_hashed_str[:kept_len]

    def sm4_encrypt_text(self, record, record_type, key: Union[None, str], kept_len=32):
        """
        使用对称加密算法对文本进行处理，requirements里已经安装了gmssl，这里就用SM4算法进行对称加密
        为了提升速度，可以每一批数据使用同一个key，而不是每次调用都随机生成
        这里限制输出最长为32
        """
        if not (type(kept_len) is int and kept_len > 0):
            raise ValueError('传入的"脱敏后截取长度"参数异常')
        bytes_record = record.encode('utf-8')
        # 128bits的随机密钥
        if key is None:
            key = os.urandom(16)
        # 输入的str形式key，进行校验与使用
        else:
            key = key.encode('utf-8')
            # 过长，报错
            if len(key) > 16:
                key = key[:16]
            else:
                # 对于过短的密钥，进行自动补长
                key = key.ljust(16, b'\x00')

        crypt_sm4 = CryptSM4()
        crypt_sm4.set_key(key, SM4_ENCRYPT)
        encrypt_value = crypt_sm4.crypt_ecb(bytes_record)
        # DEBUG用，校验算法正常与否
        # crypt_sm4.set_key(key, SM4_DECRYPT)
        # decrypt_value = crypt_sm4.crypt_ecb(encrypt_value)
        # assert bytes_record == decrypt_value
        b64_hashed_str = b64encode(encrypt_value).decode("utf-8")
        return b64_hashed_str[:kept_len]

    # 假名化全家桶方法
    # 现有方法完全随机，可能不同的输入得到相同的假名
    # TODO 后续有需要可以把fake对象的初始化放到函数外面，整个数据表的脱敏复用同一个fake
    def pseudonymize(self, record, record_type):
        fake = Faker()
        fake.add_provider(PseudoProvider)

        if record_type == 'addr':
            return fake.random_addr()
        elif record_type == 'name':
            return fake.random_name()
        elif record_type == 'ip':
            return fake.ipv4()
        elif record_type == 'phone':
            return fake.random_phone()
        elif record_type == 'id_number':
            return fake.random_ID_number_with_area_and_gender_kept(record)
        elif record_type == 'car_id':
            return fake.random_car_plate()
        elif record_type == 'email':
            return fake.random_email()
        elif record_type == 'bank':
            return fake.random_bank_card_from_same_bank(record)
        else:
            raise ValueError("不支持对传入的待脱敏数据类型进行假名脱敏")

    def user_mask(self, records, type_, st_index, end_index,  mask_symbol='*'):
        return target_range_masking(records, st_index, end_index, mask_symbol)

    def mask(self, record, record_type, mask_symbol='*'):
        if record_type in ['addr', 'gender', 'nation', 'political_status']:
            return default_mask(record, mask_symbol)
        elif record_type == 'name':
            return mask_name(record, mask_symbol)
        elif record_type == 'ip':
            return mask_ip(record, mask_symbol)
        elif record_type == 'phone':
            return mask_phone(record, mask_symbol)
        elif record_type == 'id_number':
            return mask_id(record, mask_symbol)
        elif record_type == 'car_id':
            return mask_car(record, mask_symbol)
        elif record_type == 'email':
            return mask_email(record, mask_symbol)
        elif record_type == 'bank':
            return mask_bank(record, mask_symbol)
        else:
            mask_len = len(record)
            return mask_len * mask_symbol

    def anonymize_single_string_with_current_config(self, info_type, need_anonymized_string):
        """
        使用目前anonymizer实例配置的脱敏方法，对指定类型的一段文本进行脱敏。
        """
        if self.anonymization_method_dict.get(info_type):
            method = self.anonymization_method_dict[info_type]['method']
            args = self.anonymization_method_dict[info_type]['arguments']
            return method(need_anonymized_string, info_type, **args)
        # 没有配置脱敏方法的，默认使用mask
        else:
            return self.mask(need_anonymized_string, info_type)

    def get_anonymization_config(self):
        # 将先前的脱敏方法配置清空。用于anonymizer实例重复使用的情况。
        self.anonymization_method_dict = dict()
        if not self.desensitization_method:
            self.desensitization_method = dict()

        if type(self.desensitization_method) is list:
            for info_type_config in self.desensitization_method:
                cur_info_type = info_type_config['info_type']
                method_name = info_type_config['method']
                method = getattr(self, method_name, None)
                if not callable(method):
                    raise Exception("不支持使用{}方法进行脱敏".format(method_name))
                arguments = info_type_config['arguments']
                self.anonymization_method_dict[cur_info_type] = {
                    'method': method,
                    'arguments': arguments
                }
        elif type(self.desensitization_method) is dict:
            for cur_info_type in self.desensitization_method:
                method_name = self.desensitization_method[cur_info_type]['method']
                method = getattr(self, method_name, None)
                if not callable(method):
                    raise Exception("不支持使用{}方法进行脱敏".format(method_name))
                arguments = self.desensitization_method[cur_info_type]['arguments']
                self.anonymization_method_dict[cur_info_type] = {
                    'method': method,
                    'arguments': arguments
                }
        else:
            raise ValueError("脱敏方法配置参数格式错误，无法解析")

    def all_desensitize(self):
        """
        根据识别结果，对原始df进行结果修正
        默认所有敏感信息都使用mask
        在self.desensitization_method特别指定了脱敏算法的，使用指定算法脱敏。否则默认使用mask
        """

        for _, row in self.identify_table.iterrows():

            sensitive_type = row['sensitive_type'].split("; ")[:-1]
            sensitive_records = row['sensitive_records'].split("; ")[:-1]
            combined = list(zip(sensitive_records, sensitive_type))
            if len(combined) == 0:
                continue

            # 使用sorted()函数按照list1中元素的字符长度进行排序，逆序排列
            sorted_combined = sorted(combined, key=lambda x: len(str(x[0])), reverse=True)

            # 使用列表解析将排序后的结果拆分成两个列表
            sensitive_records = [x[0] for x in sorted_combined]
            sensitive_type = [x[1] for x in sorted_combined]
            source_text = str(self.origin_table.loc[int(row['origin_table_index']) - 1].loc[row['origin_field_name']])
            source_text = re.sub(r'((?<=[\u4e00-\u9fa5])\s+)|\s+(?=[\u4e00-\u9fa5])', "", source_text)

            # 根据传入的参数，设置对各类信息的脱敏方法和方法参数
            for record, type_ in zip(sensitive_records, sensitive_type):
                if self.anonymization_method_dict.get(type_):
                    method = self.anonymization_method_dict[type_]['method']
                    args = self.anonymization_method_dict[type_]['arguments']
                    mask_record = method(record, type_, **args)
                # 没有配置脱敏方法的，默认使用mask
                else:
                    mask_record = self.mask(record, type_)

                source_text = source_text.replace(record, mask_record)

            self.origin_table.loc[row['origin_table_index'] - 1, row['origin_field_name']] = source_text

        return self.origin_table


    def update_need_anonymized_data(self, new_data: pd.DataFrame, new_data_iden_res: pd.DataFrame):
        self.origin_table = new_data
        self.identify_table = new_data_iden_res

    def update_anonymization_config_and_data(self, new_desensitization_method: Union[list, dict],
                                             new_data: pd.DataFrame, new_data_iden_res: pd.DataFrame):
        self.update_need_anonymized_data(new_data, new_data_iden_res)
        self.desensitization_method = new_desensitization_method
        self.get_anonymization_config()


if __name__ == "__main__":
    df = pd.DataFrame()
    param1 = [
        {
            'info_type': 'name',
            'method': 'mask',
            'arguments': {
                'mask_symbol': '#'
            }
        }
    ]
    param2 = {
        "car_id": {
            'method': 'pseudonymize',
            'arguments': {}
        }
    }

    anonymizer = Anonymizer(df, df, desensitization_method=param1)
    anonymizer.get_anonymization_config()
    print(anonymizer.anonymization_method_dict)

    anonymizer.desensitization_method = param2
    anonymizer.get_anonymization_config()
    print(anonymizer.anonymization_method_dict)

    print('--' * 50)
    print("使用当前anonymizer实例的配置，对单独一段文本进行脱敏")
    print(anonymizer.anonymize_single_string_with_current_config("car_id", "浙F88K7L"))
    print(anonymizer.anonymize_single_string_with_current_config("email", "88888zz@qq.com"))

    # 传入str格式key时，使用sm4进行对称加密
    print('--' * 50)
    param3 = {
        "name": {
            'method': 'sm4_encrypt_text',
            'arguments': {
                'key': '1234567890QAZWSX',  # 正好16bytes
                # 'key': 'Hello',     # 过短，自动补长
                # 'key': 'HelloHelloHelloHelloHelloHelloHelloHello',      # 过长，报错
                'kept_len': 4
            }
        }
    }
    # 对新数据进行脱敏时要在此传入数据与新方法是有原因的，并不冗余。这里仅作一个功能演示
    anonymizer.update_anonymization_config_and_data(param3, df, df)
    print(anonymizer.anonymize_single_string_with_current_config("name", "张三丰"))
