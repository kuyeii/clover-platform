# -- coding: utf-8 --
# @Time : 2023/11/27 11:34
# @Author : Yao Sicheng
import re

import torch
from transformers import AutoTokenizer, AutoModelForSequenceClassification

from app.extension.celery_task.pipt_task.assets.constant import regex_pattern, SENSITIVE_MODEL


class DirectOut:

    def judge(self, table_columns_list):
        field_name_type_dict = {key: "semi_structured_regex" for key in table_columns_list[1:]}
        return field_name_type_dict, True

    def __call__(self, *args, **kwargs):
        return self.judge(*args, **kwargs)


class FastScan(object):
    """敏感信息到个人信息判断"""

    def __init__(self, config):
        self.config = config
        self.type_dict = {4: 'semi_structured_regex',
                          3: 'org_like_columns_regex',
                          2: 'no_sensitive',
                          1: 'names_like_columns_regex',
                          0: 'addr_like_columns_regex'}

        self.tokenizer = AutoTokenizer.from_pretrained(SENSITIVE_MODEL)
        self.device = torch.device("cuda") if torch.cuda.is_available() else torch.device("cpu")
        self.model = AutoModelForSequenceClassification.from_pretrained(SENSITIVE_MODEL,
                                                                        num_labels=5)
        self.model.to(self.device)

    """当前使用的预测方法"""

    def predict_single(self, title, field_list):
        predictions_list = []

        for field in field_list:
            inputs = self.tokenizer(title, field, padding="max_length", truncation=True,
                                    max_length=310, return_tensors="pt")
            inputs = inputs.to(self.device)
            outputs = self.model(**inputs)
            logits = outputs.logits
            predictions = torch.argmax(logits, dim=-1)
            predictions_list.append(predictions.cpu().numpy()[0])
        return predictions_list


    def judge_batch(self, table_columns_list_batch):
        all_result = []
        for table_columns_list in table_columns_list_batch:
            all_result.append(self.judge(table_columns_list))
        return all_result

    def judge(self, table_columns_list):
        """
        判断字段类型
        @param table_columns_list:
        @return:
        """
        field_list, field_type_list = self.judge_layer(table_columns_list)
        field_name_type_dict, person_status = self.field_analysis(field_list, field_type_list)
        return field_name_type_dict, person_status
    def judge_layer(self, table_columns_list):
        """
        判别字段的情况,返回需要NER识别的字段名 字段类型
        @param table_columns_list: [企业人员信息表, 姓名, 企业名称, 主键]
        @return: field_name, field_type:[姓名, 企业名称], [name, org]
        """
        title = table_columns_list[0]
        field_list = table_columns_list[1:]
        regex_judge = self._regex_judge(field_list)
        field_type_list = self._deep_learning_judge(title, field_list, regex_judge)
        return field_list, field_type_list

    def field_analysis(self, field_list, field_type_list):
        """
        根据字段分布情况,排除一些企业地址\企业联系方式的情况
        @param field_list:
        @param field_type_list:
        @return:
        """
        # 是否含有个人主体的状态
        person_status = False
        field_name_type_dict = {}
        # 第一次循环判断是否有个人信息字段
        for field, type_ in zip(field_list, field_type_list):
            if type_ == 'names_like_columns_regex' or \
                type_ == 'political_status_like_columns_regx' or \
                type_ == 'nation_like_columns_regx' or \
                type_ == 'id_like_columns_regex' or \
                type_ == 'person_org_columns_regex' or \
                type_ == 'gender_like_columns_regex':
                person_status = True
            field_name_type_dict[field] = type_

        # if need_addr_field_flag:
        #     for field, type_ in zip(field_list, field_type_list):
        #         field_name_type_dict[field] = type_
        # else:
        #     for field, type_ in zip(field_list, field_type_list):
        #         field_name_type_dict[field] = type_
        #         if type_ == 'addr_like_columns_regex':
        #             field_name_type_dict[field] = 'no_sensitive'
        #         else:
        #             field_name_type_dict[field] = type_

        return field_name_type_dict, person_status

    def field_judge(self, table_columns):
        title = table_columns[0]
        field_list = table_columns[1:]
        regex_judge = self._regex_judge(field_list)
        field_type_list = self._deep_learning_judge(title, field_list, regex_judge)
        field2type_dict = {k: v for k, v in zip(field_list, field_type_list)}
        return field2type_dict

    def _regex_judge(self, field_list: list):
        field_type_list = []
        for field in field_list:
            if field is None:
                field_type_list.append('no_sensitive')
                continue
            field_type = None
            for key, regex in regex_pattern.items():
                if re.search(regex, field) is not None:
                    field_type = key
                    break
            if field_type is None:
                field_type = 'unknown'
            field_type_list.append(field_type)
        return field_type_list

    def _deep_learning_judge(self, title, field_list: list, field_type_list):
        i = 0
        need_judge_list = []
        new_field_type_list = []
        for field_type, field in zip(field_type_list, field_list):
            if field_type == 'unknown':
                need_judge_list.append(field)
        deep_learning_type_list = self.predict_single(title, need_judge_list)
        for field in field_type_list:
            if field != 'unknown':
                new_field_type_list.append(field)
            else:
                field_type_deep = self.type_dict[deep_learning_type_list[i]]
                new_field_type_list.append(field_type_deep)
                i = i + 1
        return new_field_type_list

    def __call__(self, *args, **kwargs):
        return self.judge(*args, **kwargs)
