# -- coding: utf-8 --
import re

from app.extension.celery_task.pipt_task.assets.bin_dict import bin_dict


class Desensitize:
    def __init__(self, origin_table, identify_table, desensitize_symbol='*', desensitization_method=None):
        self.origin_table = origin_table
        self.identify_table = identify_table
        self.desensitize_symbol = desensitize_symbol
        self.desensitization_method = desensitization_method

    def mask_email(self, email, desensitize_symbol):
        local, domain = email.split('@')
        if len(local) >= 5:
            masked_local = local[:len(local) - 5] + desensitize_symbol * 5
        else:
            masked_local = '*' * len(local)
        masked_email = masked_local + '@' + domain
        return masked_email

    def mask_car(self, car, desensitize_symbol):
        if len(car) >= 5:
            masked_plate = car[:-5] + desensitize_symbol * 5
            return masked_plate
        else:
            raise ValueError("车牌号长度应至少为5位")

    def mask_id(self, id_number, desensitize_symbol):
        if len(id_number) == 18:
            masked_id = id_number[:3] + desensitize_symbol * 11 + id_number[14:16] + desensitize_symbol * 2
            return masked_id
        else:
            raise ValueError("身份证号码应为18位")

    def mask_phone(self, phone_number, desensitize_symbol):
        masked_phone = phone_number[:-8] + desensitize_symbol * 4 + phone_number[-4:]
        return masked_phone

    def mask_ip(self, ip_address, desensitize_symbol):
        # 分割IP地址为4部分
        parts = ip_address.split('.')

        # 确保IP地址格式正确
        if len(parts) != 4:
            raise ValueError("Invalid IP address format")

        # 保留第一部分，其他部分替换为***
        anonymized_ip = f"{parts[0]}.{desensitize_symbol * 3}.{desensitize_symbol * 3}.{desensitize_symbol * 3}"

        return anonymized_ip

    def mask_name(self, record, desensitize_symbol):
        if len(record) <= 3:
            mask_record = record[0] + desensitize_symbol * len(record[1:])
            return mask_record
        if len(record) == 4:
            mask_record = record[:2] + desensitize_symbol * len(record[2:])
            return mask_record
        else:
            return record[0] + desensitize_symbol * len(record[1:])

    def default_mask(self, record, desensitize_symbol):
        return desensitize_symbol * len(record)

    def mask_bank(self, record, desensitize_symbol):
        # 获取bin码
        bin_code = ''
        for i in range(2, 11):
            sub = record[:i]
            if sub in bin_dict:
                bin_code = sub
                break
        if len(bin_code) > 0:
            record = bin_code + desensitize_symbol * (len(record) - len(bin_code) - 4) + record[-4:]
        else:
            raise ValueError("bin 码获取失败")
        return record

    def all_desensitize(self):
        # 遍历识别结果进行脱敏
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

            if self.desensitization_method is None:
                for record, type_ in zip(sensitive_records, sensitive_type):

                    if type_ == 'addr':
                        # 对于地址，全部脱敏
                        mask_record = self.default_mask(record, self.desensitize_symbol)
                    elif type_ == 'name':
                        mask_record = self.mask_name(record, self.desensitize_symbol)
                    elif type_ == 'gender' or type_ == 'nation' or type_ == 'political_status':
                        mask_record = self.default_mask(record, self.desensitize_symbol)
                    elif type_ == 'ip':
                        mask_record = self.mask_ip(record, self.desensitize_symbol)
                    elif type_ == 'phone':
                        mask_record = self.mask_phone(record, self.desensitize_symbol)
                    elif type_ == 'id_number':
                        mask_record = self.mask_id(record, self.desensitize_symbol)
                    elif type_ == 'car_id':
                        mask_record = self.mask_car(record, self.desensitize_symbol)
                    elif type_ == 'email':
                        mask_record = self.mask_email(record, self.desensitize_symbol)
                    elif type_ == 'bank':
                        mask_record = self.mask_bank(record, self.desensitize_symbol)

                    record = re.escape(record)
                    source_text = re.sub(record, mask_record, source_text)

            else:
                source_text = self.desensitization_method(source_text, sensitive_records)
            self.origin_table.loc[row['origin_table_index'] - 1, row['origin_field_name']] = source_text

        return self.origin_table

    def mask_desensitize(self, desensitization):
        """
        Parameters
        ----------
        origin_table：原表，dataframe
        identify_table：识别结果 dataframe
        desensitization_method；脱敏方法(function,输入原始文本，识别结果，输出替换后的文本)，默认#

        Returns
        -------
        desensitize_table：脱敏后的原表
        """
        # license.license_check()
        handle_type = desensitization['handle_type']
        columns = desensitization['columns']

        # 获取需要 或 不需要脱敏的字段名与信息类型
        column_names = []
        column_types = []
        for column in columns:
            column_names.append(column['column_name'])
            column_types.append(column['sensitive_type'])

        # 遍历识别结果进行脱敏
        for _, row in self.identify_table.iterrows():

            sensitive_field = row['origin_field_name']

            # 该字段不在 需要脱敏的字段列表中，跳过
            if handle_type == "mask" and sensitive_field not in column_names:
                continue

            sensitive_type = row['sensitive_type'].split("; ")[:-1]
            sensitive_records = row['sensitive_records'].split("; ")[:-1]
            combined = list(zip(sensitive_records, sensitive_type))

            if handle_type == "mask":
                for i in range(len(column_names)):
                    column_name = column_names[i]
                    column_type = column_types[i].split(',')
                    if sensitive_field == column_name:
                        if column_type[0] != '*':
                            # 获取该字段中需要脱敏的combined
                            combined = [item for item in combined if item[1] in column_type]

            # 从 combined 中 剔除 不需要脱敏的字段 和 类型
            if handle_type == "not_mask" and sensitive_field in column_names:
                for i in range(len(column_names)):
                    column_name = column_names[i]
                    column_type = column_types[i].split(',')
                    if sensitive_field == column_name:
                        if column_type[0] != "*":
                            # 从combined剔除字段中不需要脱敏的
                            combined = [item for item in combined if item[1] not in column_type]
                        else:  # 全部都不脱敏
                            combined = []
            if len(combined) == 0:
                continue

            # 使用sorted()函数按照list1中元素的字符长度进行排序，逆序排列
            sorted_combined = sorted(combined, key=lambda x: len(str(x[0])), reverse=True)

            # 使用列表解析将排序后的结果拆分成两个列表
            sensitive_records = [x[0] for x in sorted_combined]
            sensitive_type = [x[1] for x in sorted_combined]
            source_text = str(self.origin_table.loc[int(row['origin_table_index']) - 1].loc[row['origin_field_name']])
            source_text = re.sub(r'((?<=[\u4e00-\u9fa5])\s+)|\s+(?=[\u4e00-\u9fa5])', "", source_text)

            if self.desensitization_method is None:
                for record, type_ in zip(sensitive_records, sensitive_type):

                    if type_ == 'addr':
                        # 对于地址，全部脱敏
                        mask_record = self.default_mask(record, self.desensitize_symbol)
                    elif type_ == 'name':
                        mask_record = self.mask_name(record, self.desensitize_symbol)
                    elif type_ == 'gender' or type_ == 'nation' or type_ == 'political_status':
                        mask_record = self.default_mask(record, self.desensitize_symbol)
                    elif type_ == 'ip':
                        mask_record = self.mask_ip(record, self.desensitize_symbol)
                    elif type_ == 'phone':
                        mask_record = self.mask_phone(record, self.desensitize_symbol)
                    elif type_ == 'id_number':
                        mask_record = self.mask_id(record, self.desensitize_symbol)
                    elif type_ == 'car_id':
                        mask_record = self.mask_car(record, self.desensitize_symbol)
                    elif type_ == 'email':
                        mask_record = self.mask_email(record, self.desensitize_symbol)
                    elif type_ == 'bank':
                        mask_record = self.mask_bank(record, self.desensitize_symbol)

                    record = re.escape(record)
                    source_text = re.sub(record, mask_record, source_text)

            else:
                source_text = self.desensitization_method(source_text, sensitive_records)
            self.origin_table.loc[row['origin_table_index'] - 1, row['origin_field_name']] = source_text

        return self.origin_table
