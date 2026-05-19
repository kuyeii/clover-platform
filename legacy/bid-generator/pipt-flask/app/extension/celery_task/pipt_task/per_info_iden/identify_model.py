# -- coding: utf-8 --
# @Time : 2023/6/19 14:43
# @Author : Yao Sicheng
# 基础识别模块
import collections

import hanlp
import re
import torch
from tqdm import tqdm

from app.extension.celery_task.pipt_task.assets import constant
from app.extension.celery_task.pipt_task.assets.constant import NEED_FIELD_LEN, free_text_name_judge, \
    free_text_name_judge2, TOK_MODEL_DIR, NER_MODEL_DIR, NER_MODEL, NER_BLACK_DICT, chinese_pattern, no_mean_regex
from app.extension.celery_task.pipt_task.per_info_iden.result_handle import ResultHandle
from app.extension.celery_task.pipt_task.utils.data_processing import BatchIterator, tok_process
from app.extension.celery_task.pipt_task.utils.type_judgment import validate_bank, validate_ID, validate_car, validate_email, not_validate
from app.util.status_code import CONTENT


class PersonIdentify:
    def __init__(self, config):
        self.identify_type_dict = {
            'phone': constant.phone_regex,
            'email': constant.email_regex,
            'ip': constant.ip_regex,
            'ip_plus': constant.ip_plus_regex,
            'car_id': constant.car_id_regex,
            'id_number': constant.id_number_regex,
            'bank': constant.bank_regex,
            'gender': constant.gender_regex_,
            'nation': constant.nation_regex_,
            'political_status': constant.political_status_regex_
        }
        self.metadata_identify_type_dict = {}
        self.ner_func = None
        self.config = config
        self.custom_identify_type_list = []
        # self.custom_metadata_identify_type_list = []

    def add_custom_rule_content(self, info_name, pattern, category_type):
        """
        添加自定义敏感信息内容识别规则
        @param info_name: 敏感信息名称
        @param pattern: 敏感信息正则表达式
        @param category_type: 自定义类型
        @return:
        """

        #TODO 禁止和已有的信息名称冲突
        self.custom_identify_type_list.append((info_name, category_type))
        if category_type == CONTENT:
            self.identify_type_dict[info_name] = pattern
        else:
            self.metadata_identify_type_dict[info_name] = pattern


    def naive_identify(self, uni_ls=None, series=None, info_type_list=None):
        """
        用于检测性别等简单的内容
        """
        this_records = {'gender_records': {}, 'nation_records': {}, 'political_status_records': {}}
        # records_list = []
        records_list = []
        series_content2_idx = collections.defaultdict(list)
        for index, value in series.items():
            series_content2_idx[value].append(index)
        column_type_list  = ['gender', 'nation', 'political_status']
        for column_type in column_type_list:
            dict_res = collections.defaultdict(list)
            if column_type == 'gender':
                if column_type not in info_type_list:
                    continue
                # GB/T 2261-1980性别代码 0未知 1男性 2女性 9未说明性别
                r = constant.gender_regex
                information_class = 'gender'

            elif column_type == 'nation':
                if column_type not in info_type_list:
                    continue
                # 民族、民族码GB 3304－91
                r = constant.nation_regex
                information_class = 'nation'

            else:
                if column_type not in info_type_list:
                    continue
                # 政治面貌代码GBT4762-1984
                r = constant.political_status_regex
                information_class = 'political_status'

            for i in uni_ls:
                naive_infos = [match.group() for match in re.finditer(r, i)]
                for naive_info in naive_infos:
                    # dict_value_index = dc.index_map_list(series, i)
                    dict_value_index = series_content2_idx[i]
                    for item in dict_value_index:
                        dict_res[item].append(naive_info)
                    records_list.extend(dict_value_index)
                this_records[information_class + '_records'] = dict_res
            # if len(records_list) > 0:
            #     return this_records, records_list
        return this_records, records_list



    def metadata_identify(self, custom_info, series):
        records_list = []
        dict_res = collections.defaultdict(list)
        if series is None:
            return {}, []
        regex = self.metadata_identify_type_dict[custom_info]
        if re.search(regex, str(series.name)) is not None:
            for i, lattice in series.items():
                if re.search(no_mean_regex, lattice) is None:
                    dict_res[i].append(lattice)
                    records_list.append(i)

            return dict_res, records_list
        return {}, []

    def regex_identify(self, identify_type=None, series=None, field_name_judge=False):
        """

        @param identify_type: 需要识别的种类
        @param series: 数据列
        @param field_name_judge: 是否已经经过字段名校验
        @return:
        """

        if series is None:
            return {}, []
        # 用于统计类似银行卡、身份证号的数量，即满足正则要求的记录数量
        regex_nums = []

        regex = self.identify_type_dict.get(identify_type)
        if identify_type == 'bank':
            validate = validate_bank
        elif identify_type == 'id_number':
            validate = validate_ID
        elif identify_type == 'car_id':
            validate = validate_car
        elif identify_type == 'email':
            validate = validate_email
        else:
            validate = not_validate
        records_list = []
        memory_dict = collections.defaultdict(list)
        dict_res = collections.defaultdict(list)
        if series is not None:
            for i, lattice in series.items():
                val_flag = False
                if lattice not in memory_dict:
                    nums = [match.group() for match in re.finditer(regex, lattice)]
                    # 只有当前的检测对象为身份证号或身份证号、同时字段名又不满足相关要求时生效
                    if (identify_type == 'id_number' or identify_type == 'bank') and not field_name_judge:
                        regex_nums.extend(nums)

                    for num in nums:
                        if validate(num):
                            val_flag = True
                            memory_dict[lattice].append(num)
                            dict_res[i].append(num)
                    if val_flag:
                        records_list.append(i)

                else:
                    if (identify_type == 'id_number' or identify_type == 'bank') and not field_name_judge:
                        regex_nums.extend(memory_dict[lattice])
                    records_list.append(i)
                    for num in memory_dict[lattice]:
                        dict_res[i].append(num)
        # 如果实际匹配的身份证号点到正则到的准身份证号比例小于50%，说明大部分校验位、区域校验都没通过，则这些身份证号可能是项目编号
        if len(regex_nums) > 0:
            if len(records_list) / len(regex_nums) < 0.5:
                return {}, []
        return dict_res, records_list

    def _name_judgment_for_num(self, text):
        """
        人名数量统计核验，返回是或否
        :return: bool
        """
        pattern = re.compile(r'[\u4e00-\u9fa5]{2,4}')
        match = re.search(pattern, text)
        return match is not None

    def _name_judgment_result(self, text, field_name=None, table_name=None, semi_text=False):
        """
        简单人名核验，返回人名列表
        结构化字段与长文本字段的校验有所区别，长文本是经过NER的，需要避免NER易错的人名，例如 杨氏，
        长文本未经过NER，但能确实该字段是姓名，要避免在姓名字段中会出现的非姓名情况，例如 暂无，未知
        :param text:
        :param field_name:
        :return:
        """
        # 结构人名字段中的校验
        if not semi_text:
            if len(text) < 2:
                return None
            if field_name is not None:
                if text in field_name:
                    return None
            if table_name is not None:
                if text in table_name:
                    return None
            pattern = re.compile(r'(不详)|(未知)|(暂无)|(\*+)')
            match = re.search(pattern, text)
            # 当文本是2到4个字符时，要满足出现连续的2到4个中文字符，且前后不包含“*”，否则说明为王*宏，欧阳*明的情况
            if 2 <= len(text) <= 4:
                if match is not None:
                    return None
                else:
                    text = re.sub(r'(先生)|(女士)|(小姐)|(老师)|(经理)|(师傅)', '', text)
                    pattern = re.compile(r'[\u4e00-\u9fa5]{2,4}')
                    match = re.search(pattern, text)
                    if match is not None:
                        return match.group()
                    else:
                        return None
            return None
        # 长文本字段中的校验
        else:
            if len(text) < 2 or len(text) > 3:
                return None
            if field_name is not None:
                if text in field_name:
                    return None
            if len(text) == 2 and text[0] == text[1]:
                return None
            if len(text) == 3 and text[0] == text[1] and text[1] == text[2]:
                return None
            text = re.sub(free_text_name_judge, '', text)
            text = re.sub(free_text_name_judge2, '', text)
            pattern = re.compile(r'^[\u4e00-\u9fa5]{2,4}$')
            match = re.search(pattern, text)
            # 当文本是2到4个字符时，要满足出现连续的2到4个中文字符，且前后不包含“*”，否则说明为王*宏，欧阳*明的情况
            if match is not None:
                return match.group()
            else:
                return None

    def addr_judgment_condition(self, text):
        """筛选出错误的情况，返回True"""
        if re.search(r'(全\s?[省市])|([总共合]\s?计)|(市\s?区)|(所有)', text) is not None:
            return True
        else:
            return re.search(r'^[\u4e00-\u9fa5]{2,}\*+[\u4e00-\u9fa5]*', text) is not None



class HanPersonIdentify(PersonIdentify):

    def __init__(self, logger, config):
        super(HanPersonIdentify, self).__init__(config)
        self.logger = logger
        self.han_tok = hanlp.load(TOK_MODEL_DIR)
        # 单任务流水线模式msra标准
        with open(NER_BLACK_DICT, encoding='utf-8') as f:
            ner_blacklist = f.read().splitlines()
        # with open(config['tok_black_dict'], encoding='utf-8') as f:
        #     tok_blacklist = f.read().splitlines()
        if NER_MODEL == "han2-msra-fine":
            han_ner = hanlp.load(NER_MODEL_DIR)
            han_ner.dict_blacklist = {item for item in ner_blacklist}
            self.tok_output_key = 'tok/fine'
            self.ner_output_key = 'ner/msra'
            self.ner_func = hanlp.pipeline().append(self.han_tok, output_key=self.tok_output_key).append(han_ner, output_key=self.ner_output_key)
            self.ner_func[0].component.config.sampler_builder.batch_size = config["batch_size_max"]
            self.ner_func[1].component.config.sampler_builder.batch_size = config["batch_size_max"]
            self.person_tag = 'PERSON'
            self.addr_tag = 'LOCATION'
            self.org_tag = 'ORGANIZATION'
        # 多任务模型PKU标准
        elif config['ner_model'] == "han2-pku-fine":
            self.ner_output_key = 'ner/pku'
            self.tok_output_key = 'tok/fine'
            self.ner_func = hanlp.load(hanlp.pretrained.mtl.CLOSE_TOK_POS_NER_SRL_UDEP_SDP_CON_ELECTRA_SMALL_ZH)
            self.ner_func.tasks[self.ner_output_key].dict_blacklist = {item for item in ner_blacklist}
            # self.ner_func.tasks[self.tok_output_key].dict_force = {item for item in tok_blacklist}
            self.ner_func.tasks[self.ner_output_key].config.sampler_builder['batch_size'] = config["batch_size_max"]
            self.ner_func.tasks[self.tok_output_key].config.sampler_builder['batch_size'] = config["batch_size_max"]
            tasks = list(self.ner_func.tasks.keys())
            for task in tasks:
                if task not in (self.ner_output_key, self.tok_output_key):
                    del self.ner_func[task]
            self.person_tag = 'nr'
            self.addr_tag = 'ns'
            self.org_tag = 'nt'
        # ernie多任务模型PKU标准
        else:
            self.tok_output_key = 'tok/fine'
            self.ner_output_key = 'ner/msra'
            self.ner_func = hanlp.load(hanlp.pretrained.mtl.CLOSE_TOK_POS_NER_SRL_DEP_SDP_CON_ERNIE_GRAM_ZH)
            self.ner_func.tasks[self.ner_output_key].dict_blacklist = {item for item in ner_blacklist}
            self.ner_func.tasks[self.ner_output_key].config.sampler_builder['batch_size'] = config["batch_size_max"]
            self.ner_func.tasks[self.tok_output_key].config.sampler_builder['batch_size'] = config["batch_size_max"]
            tasks = list(self.ner_func.tasks.keys())
            for task in tasks:
                if task not in (self.ner_output_key, self.tok_output_key):
                    del self.ner_func[task]
            self.person_tag = 'PERSON'
            self.addr_tag = 'LOCATION'
            self.org_tag = 'ORGANIZATION'
        self.tmp = None

    def free_name_judgment_result(self, text, field_name=None, table_name=None, semi_text=False):
        """
        简单人名核验，返回人名列表
        结构化字段与长文本字段的校验有所区别，长文本是经过NER的，需要避免NER易错的人名，例如 杨氏，
        长文本未经过NER，但能确实该字段是姓名，要避免在姓名字段中会出现的非姓名情况，例如 暂无，未知
        :param text:
        :param field_name:
        :return:
        """
        # 结构人名字段中的校验
        if not semi_text:
            if len(text) < 2:
                return None
            if field_name is not None:
                if text in field_name:
                    return None
            if table_name is not None:
                if text in table_name:
                    return None
            pattern = re.compile(r'(不详)|(未知)|(暂无)|(\*+)')
            match = re.search(pattern, text)
            # 当文本是2到4个字符时，要满足出现连续的2到4个中文字符，且前后不包含“*”，否则说明为王*宏，欧阳*明的情况
            if 2 <= len(text) <= 4:
                if match is not None:
                    return None
                else:
                    text = re.sub(r'(先生)|(女士)|(小姐)|(老师)|(经理)|(师傅)', '', text)
                    text = re.sub(free_text_name_judge, '', text)
                    text = re.sub(free_text_name_judge2, '', text)
                    pattern = re.compile(r'[\u4e00-\u9fa5]{2,4}')
                    match = re.search(pattern, text)
                    if match is not None:
                        return match.group()
                    else:
                        return None
            return None
        # 长文本字段中的校验
        else:
            if len(text) < 2 or len(text) > 3:
                return None
            if field_name is not None:
                if text in field_name:
                    return None
            if len(text) == 2 and text[0] == text[1]:
                return None
            if len(text) == 3 and text[0] == text[1] and text[1] == text[2]:
                return None
            text = re.sub(free_text_name_judge, '', text)
            text = re.sub(free_text_name_judge2, '', text)
            pattern = re.compile(r'^[\u4e00-\u9fa5]{2,4}$')
            match = re.search(pattern, text)
            # 当文本是2到4个字符时，要满足出现连续的2到4个中文字符，且前后不包含“*”，否则说明为王*宏，欧阳*明的情况
            if match is not None:
                return match.group()
            else:
                return None

    def naive_regex_identify(self, identify_type, text):
        records_list = []
        ner_flag = False
        if identify_type == 'name_addr':
            chinese_flag = bool(chinese_pattern.search(text))
            if not chinese_flag:
                return records_list
            result = self.ner_func(text)

            tokens = result[self.tok_output_key]
            ner_result = result[self.ner_output_key]
            for item in ner_result:
                if item[1] == self.person_tag or item[1] == self.addr_tag:
                    ner_flag = True
                    break
            if not ner_flag:
                return records_list
            # 1. 构建字符位置映射表
            char_pos_map = []
            current_idx = 0
            for token in tokens:
                start = current_idx
                end = current_idx + len(token)
                char_pos_map.append((start, end))
                current_idx = end
            # 2. 转换NER位置
            for entity, etype, start_token, end_token in ner_result:
                if etype != self.person_tag and etype != self.addr_tag:
                    continue
                # 获取实体对应的字符位置
                char_start = char_pos_map[start_token][0]
                char_end = char_pos_map[end_token - 1][1]

                if etype == self.person_tag:
                    if self.free_name_judgment_result(entity):
                        records_list.append(('name', entity, char_start, char_end))
                elif etype == self.addr_tag:
                    records_list.append(('addr', entity, char_start, char_end))
        elif identify_type == 'name':
            chinese_flag = bool(chinese_pattern.search(text))
            if not chinese_flag:
                return records_list
            result = self.ner_func(text)

            tokens = result[self.tok_output_key]
            ner_result = result[self.ner_output_key]
            for item in ner_result:
                if item[1] == self.person_tag:
                    ner_flag = True
                    break
            if not ner_flag:
                return records_list
            # 1. 构建字符位置映射表
            char_pos_map = []
            current_idx = 0
            for token in tokens:
                start = current_idx
                end = current_idx + len(token)
                char_pos_map.append((start, end))
                current_idx = end
            # 2. 转换NER位置
            for entity, etype, start_token, end_token in ner_result:
                if etype != self.person_tag:
                    continue
                # 获取实体对应的字符位置
                char_start = char_pos_map[start_token][0]
                char_end = char_pos_map[end_token - 1][1]

                if etype == self.person_tag:
                    if self.free_name_judgment_result(entity):
                        records_list.append(('name', entity, char_start, char_end))
        elif identify_type == 'addr':
            chinese_flag = bool(chinese_pattern.search(text))
            if not chinese_flag:
                return records_list
            result = self.ner_func(text)

            tokens = result[self.tok_output_key]
            ner_result = result[self.ner_output_key]
            for item in ner_result:
                if item[1] == self.addr_tag:
                    ner_flag = True
                    break
            if not ner_flag:
                return records_list
            # 1. 构建字符位置映射表
            char_pos_map = []
            current_idx = 0
            for token in tokens:
                start = current_idx
                end = current_idx + len(token)
                char_pos_map.append((start, end))
                current_idx = end
            # 2. 转换NER位置
            for entity, etype, start_token, end_token in ner_result:
                if etype != self.addr_tag:
                    continue
                # 获取实体对应的字符位置
                char_start = char_pos_map[start_token][0]
                char_end = char_pos_map[end_token - 1][1]

                if etype == self.addr_tag:
                    records_list.append(('addr', entity, char_start, char_end))
        else:
            regex = self.identify_type_dict.get(identify_type)
            if identify_type == 'bank':
                validate = validate_bank
            elif identify_type == 'ID':
                validate = validate_ID
            elif identify_type == 'car':
                validate = validate_car
            elif identify_type == 'email':
                validate = validate_email
            else:
                validate = not_validate
            records = [match for match in re.finditer(regex, text)]
            for record in records:
                content = record.group()
                coordinate = record.span()
                if validate(content):
                    records_list.append((identify_type, content, *coordinate))

        return records_list
    def _structured_name_judgment_result(self, text):
        """
        根据字数情况进行人名核验，返回人名列表
        :param text:
        :param field_name:
        :return: 核验成功的人名列表
        """
        # 4个字以内的情况直接调用人名二次核验排查
        if len(text) <= 4:
            return self._name_judgment_result(text)

        # 大于4个字的情况，考虑是自由文本，需要NER检测
        double_check_list = self.ner_func(text)[self.ner_output_key]
        # 二次核查
        double_check_name_list = [sublist[0] for sublist in double_check_list if
                                  sublist[1] == self.person_tag and self._name_judgment_result(sublist[0], semi_text=True) is not None]
        return double_check_name_list


    def structured_name_identify(self, series):
        """
        结构化人名识别
        :param series:
        :return: 识别结果列表
        """
        records_list = []
        dict_res = collections.defaultdict(list)
        for index, name in series.items():

            result = self._structured_name_judgment_result(name)
            if result:
                if isinstance(result, str):
                    if result not in dict_res:
                        dict_res[index].append(result)
                    records_list.append(index)
                if isinstance(result, list):
                    dict_res[index].extend(result)
                    records_list.append(index)

        return dict_res, records_list

    def structured_addr_identify(self, series):
        """
        结构化地址识别
        :param series:
        :return: 识别结果列表
        """
        series_dict = series.to_dict()
        content = list(series_dict.values())
        content_index = list(series_dict.keys())
        han_res = self.safe_tok_func(content, series.name)
        records_list = []
        dict_res = collections.defaultdict(list)
        for index, addr_list in zip(content_index, han_res):
            tok_str = "".join([tok for tok in addr_list if ResultHandle.addr_black_func(tok)])
            # 如果去除了省市后，剩下的字符不包含两个以上连续中文字符，考虑是  嘉兴北、嘉兴101101或者已经是空字符串的情况
            if re.search(r'[\u4e00-\u9fa5]{2,}', tok_str) is None:
            # if tok_str == '':
                continue
            if tok_str not in dict_res:
                dict_res[index].append(tok_str)
            records_list.append(index)
        return dict_res, records_list

    def safe_ner_func(self, content, field_name, table_name=None, tok_result=False, person_status=True):
        """
        减少显存不足导致的运行错误，通过异常捕捉忽略此类情况
        :param field_name:
        :param content:
        :param tok_result: 是否需要分词的结果
        :param person_status: 表中是否包含个人字段主体

        :return:
        """
        ner_error_flag = False
        is_flag = False
        # 对识别内容中加入字段名辅助，加入字段名后可忽略hanlp空字符串问题
        uni_ls_and_field_name = []
        for text in content:
            if self.config['is_fast_scan']:
                if person_status:
                    if len(text) < NEED_FIELD_LEN:
                        # uni_ls_and_field_name.append(text)
                        uni_ls_and_field_name.append(field_name + '是' + text)

                    else:
                        uni_ls_and_field_name.append(text)
                else:
                    uni_ls_and_field_name.append(table_name + '中' + field_name + '是' + text)
            else:
                uni_ls_and_field_name.append(text)

        try:
            if tok_result:
                all_output = self.ner_func(uni_ls_and_field_name)
            else:
                all_output = self.ner_func(uni_ls_and_field_name)[self.ner_output_key]
        except Exception as e:
            # 如果不要tok结果，输出的是列表，否则是一个字典
            if tok_result:
                all_output = {self.tok_output_key: [], self.ner_output_key: []}
            else:
                all_output = []
            if 'out of memory' in str(e):  # GPU显存不足时
                torch.cuda.empty_cache()  # 使用pytorch的方法释放内存，并调整batch size 重新进行识别
                content_batch = BatchIterator(uni_ls_and_field_name, self.config["batch_size_min"])
                # if tok_result:
                #     all_output = {self.tok_output_key: [], self.ner_output_key: []}
                # else:
                #     all_output = []
                for batch in tqdm(content_batch):
                    try:
                        if tok_result:
                            output = self.ner_func(batch)
                        else:
                            output = self.ner_func(batch)[self.ner_output_key]
                    except RuntimeError as e:
                        output = [[] for _ in range(self.config["batch_size_min"])]
                        if 'out of memory' in str(e):
                            torch.cuda.empty_cache()
                            ner_error_flag = True
                    if tok_result:
                        all_output[self.tok_output_key].extend(output)
                        all_output[self.ner_output_key].extend(output)
                    else:
                        all_output.extend(output)
                torch.cuda.empty_cache()
            elif "can't allocate memory" in str(e):  # CPU内存不足时，设置一个 is_flag 标志位
                is_flag = True
            else:
                all_output = []
                ner_error_flag = True
        if is_flag:  # CPU 内存被解释器自动释放，并且 is_flag = True 时，并整 batch size 重新进行识别
            if tok_result:
                all_output = {self.tok_output_key: [], self.ner_output_key: []}
            else:
                all_output = []
            content_batch = BatchIterator(uni_ls_and_field_name, self.config["batch_size_min"])
            for batch in tqdm(content_batch):
                try:
                    if tok_result:
                        output = self.ner_func(batch)
                    else:
                        output = self.ner_func(batch)[self.ner_output_key]
                except Exception as m:
                    if tok_result:
                        output = {self.tok_output_key: [[] for _ in range(self.config["batch_size_min"])],
                                  self.ner_output_key: [[] for _ in range(self.config["batch_size_min"])]}
                    else:
                        output = [[] for _ in range(self.config["batch_size_min"])]
                    if "can't allocate memory" in str(m):
                        ner_error_flag = True
                if tok_result:
                    all_output[self.tok_output_key].extend(output[self.tok_output_key])
                    all_output[self.ner_output_key].extend(output[self.ner_output_key])
                else:
                    all_output.extend(output)

        if ner_error_flag:
            self.logger.error(f'NER模块运行资源不足,{field_name}中部分记录行已跳过')

        return all_output
    def safe_tok_func(self, content, field_name):
        """
        减少显存不足导致的运行错误，通过异常捕捉忽略此类情况
        :param field_name:
        :param content:
        :param tok_result: 是否需要分词的结果

        :return:
        """
        ner_error_flag = False
        is_flag = False

        try:
            all_output = self.han_tok(content)
        except Exception as e:
            all_output = []
            if 'out of memory' in str(e):  # GPU显存不足时
                torch.cuda.empty_cache()  # 使用pytorch的方法释放内存，并调整batch size 重新进行识别
                content_batch = BatchIterator(content, self.config["batch_size_min"])
                # if tok_result:
                #     all_output = {self.tok_output_key: [], self.ner_output_key: []}
                # else:
                #     all_output = []
                for batch in tqdm(content_batch):
                    try:
                        output = self.han_tok(batch)
                    except RuntimeError as e:
                        if 'out of memory' in str(e):
                            torch.cuda.empty_cache()
                            output = [[] for _ in range(self.config["batch_size_min"])]
                            ner_error_flag = True
                        else:
                            output = [[] for _ in range(self.config["batch_size_min"])]

                    all_output.extend(output)
                torch.cuda.empty_cache()
            elif "can't allocate memory" in str(e):  # CPU内存不足时，设置一个 is_flag 标志位
                is_flag = True
            else:
                all_output = []
                ner_error_flag = True
        if is_flag:  # CPU 内存被解释器自动释放，并且 is_flag = True 时，并整 batch size 重新进行识别

            all_output = []
            content_batch = BatchIterator(content, self.config["batch_size_min"])
            for batch in tqdm(content_batch):
                try:

                    output = self.han_tok(batch)
                except Exception as m:
                    output = [[] for _ in range(self.config["batch_size_min"])]
                    if "can't allocate memory" in str(m):
                        ner_error_flag = True
                all_output.extend(output)

        if ner_error_flag:
            self.logger.error(f'NER模块运行资源不足,{field_name}中部分记录行已跳过')

        return all_output


    def sample_type_num(self, sample, field_name, field_type):
        """
        抽样检测是哪种类型数量最多
        :param sample:
        :return:
        """
        sample = [x for x in sample if x != '' and "*" not in x]
        if len(sample) < 10:
            return None, 0
        res = self.safe_ner_func(sample, field_name)
        person_ratio = len([element for sublist in res for element in sublist if
                            element[1] == self.person_tag and sublist[0][0] not in field_name and self._name_judgment_for_num(element[0])]) / len(sample) * 100
        # addr_ratio = len([sublist for sublist in res
        #                   if ((len(sublist) > 1 and sublist[0][1] == 'LOCATION' and sublist[-1][1] != 'ORGANIZATION')
        #                   or (len(sublist) == 1 and sublist[0][1] == 'LOCATION')) and sublist[0][0] not in field_name]) / len(sample)
        addr_sum = 0
        for index, sublist in enumerate(res):
            # 识别结果为空跳过，否则会出错
            if not sublist:
                continue
            #计算一个格子里识别到的地址的长度，同时识别到的地址不能是字段名中的内容
            han_addr_len = sum([len(item[0]) for item in sublist if item[1] == self.addr_tag and item[0] not in field_name])
            # 识别到的长度符合要求或字段名符合要求
            # 如果字段名是地址类，只要满足该行中NER识别地址的地址字符长度大于1
            if field_type == 'addr_like_columns_regex':
                if han_addr_len > 1:
                    addr_sum += 1
            # 如果字段名不是地址类，要满足该行中NER识别地址的地址字符长度为原文长度的70%，且不能是以机构结尾的情（避免机构被识别成地址，例如浙江省嘉兴市图书馆）
            else:
                if han_addr_len / len(sample[index]) > 0.7 and sublist[-1][1] != self.org_tag:
                    addr_sum += 1
        addr_ratio = addr_sum / len(sample) * 100
        org_ratio = len([sublist for sublist in res if len(sublist) > 0 and sublist[-1][1] == self.org_tag and sublist[0][0] not in field_name]) / len(sample) * 100
        ratio_list = [person_ratio, addr_ratio, org_ratio]
        if max(ratio_list) == person_ratio:
            return "PERSON", person_ratio
        else:
            # 地址或机构最多，且机构的识别率也不高
            if org_ratio < 30:
                return "ADDR", addr_ratio
            else:
                # 地址或机构最多，机构识别率高
                return "ORG", org_ratio


    def sample_addr_num(self, sample):
        """
        抽样检测地址数量,”*“数据作为已脱敏数据忽略
        例如：
        res={
        000 = {list: 1} [('杭州祺凯锻造有限公司', 'ORGANIZATION', 0, 5)]
        001 = {list: 2} [('杭州', 'LOCATION', 0, 1), ('萧山杰威鞋业有限公司', 'ORGANIZATION', 1, 6)]
        002 = {list: 1} [('杭州市', 'LOCATION', 0, 1), ('萧山区', 'LOCATION', 1, 2)]
        003 = {list: 1} [('杭州市', 'LOCATION', 0, 1)]
        }

        [element for sublist in res for element in sublist] 将其处理成一维list
        if (len(sublist) > 1 and sublist[0][1] == 'LOCATION' and sublist[-1][1] != 'ORGANIZATION') 挑出 sublist中有两个list的list,同时要满足第一个识别到的标签是地址，最后一个识别到的标签不是机构，（002）
        or (len(sublist) == 1 and sublist[0][1] == 'LOCATION') 或者 这个sublist只有一个识别到的地址标签 （003）
        :param sample:
        :return:
        """
        sample = [x for x in sample if x != '' and "*" not in x]
        if len(sample) == 0:
            return 0
        res = self.safe_ner_func(sample, "")
        ratio = len([sublist for sublist in res
                     if (len(sublist) > 1 and sublist[0][1] == self.addr_tag and sublist[-1][1] != 'ORGANIZATION')
                     or (len(sublist) == 1 and sublist[0][1] == self.addr_tag)]) / len(sample)
        return ratio

    def sample_org_num(self, sample):
        """
        抽样检测机构数量
        :param sample:
        :return:
        """
        sample = [x for x in sample if x != '' and x.strip() != '']
        if len(sample) == 0:
            return 0
        res = self.ner_func(sample)
        ratio = len([sublist for sublist in res if len(sublist) > 0 and sublist[-1][1] == 'ORGANIZATION']) / len(sample)
        return ratio

    def addrs(self, han_result_list=None, uni_ls=None, content_index=None, field_name=None, table_name=None):
        """
        ner_res, content, content_index, field_name
        对于判定为文本的字段，均进行姓名检测，输入词性标注和主体识别结果，返还包括披露数量、检测结果和采样值的字典集。
            for sublist in han_result:
                temp_addr = []
                for index in range(len(sublist)-1):
                    if sublist[index][1] == 'LOCATION' and sublist[index+1][1] != 'LOCATION' and sublist[index+1][1] != 'ORGANIZATION':
                        result_temp.append(''.join(temp_addr))
                    elif sublist[index][1] == 'LOCATION' and sublist[index+1][1] == 'LOCATION':
                        temp_addr.append(sublist[index][1])
                    if index == len(sublist) - 2:
                        if sublist[index+1]

        """
        if han_result_list is None:
            return {}, []
        ner_result_list = han_result_list[self.ner_output_key]
        tok_result_list = han_result_list[self.tok_output_key]

        records_list = []
        dict_res = collections.defaultdict(list)
        if ner_result_list is not None:
            addr_regex = re.compile(constant.addr_regex)
            for index, ner_result in enumerate(ner_result_list):
                if not ner_result:
                    continue
                if field_name is not None and ner_result[0][0] in field_name:
                    continue
                if table_name is not None and ner_result[0][0] in table_name:
                    continue
                temp_addr = []
                raw = uni_ls[index]
                # 过滤 浙江省*******镇佳源广场 的已脱敏情况
                if self.addr_judgment_condition(raw):
                    continue
                # 一个记录行中识别到的地址长度
                han_addr_len = sum([len(item[0]) for item in ner_result if item[1] == self.addr_tag])
                han_org_len = sum([len(item[0]) for item in ner_result if item[1] == self.org_tag])
                if han_addr_len <= 1:
                    continue
                matches = list(re.finditer(addr_regex, raw))
                # 遍历所有匹配项
                if matches:
                    for match in matches:
                        temp_addr.append(match.group())  # 输出匹配到的单词
                regex_addr_len = sum([len(x) for x in temp_addr])
                """如果正则匹配到的地址已经占到了原始内容一半以上，则认为这里全部是地址"""
                if regex_addr_len > len(raw) * 0.7:
                    dict_value_index = content_index[index]
                    for item in dict_value_index:
                        """确认全部内容是地址，分词后过滤掉大地址后全部保存"""
                        tok_raw = tok_process(raw, tok_result_list[index])
                        tok_str = "".join([tok for tok in tok_raw if ResultHandle.addr_black_func(tok)])
                        dict_res[item].append(tok_str)
                    records_list.extend(dict_value_index)

                elif han_org_len > len(raw) * 0.6:
                    continue
                else:
                    """否则就按常规的地址进行处理"""
                    addr_save = []
                    addr_stack = []
                    for subtext in ner_result:
                        if subtext[1] == self.addr_tag:
                            if re.search(r'[\u4e00-\u9fa5]{2,}', subtext[0]) is None:
                                continue
                            if not addr_stack:
                                addr_stack.append([subtext[0], subtext[3]])
                            elif addr_stack[-1][-1] == subtext[2]:
                                # 拼接的处理
                                # addr_stack[-1][0] = addr_stack[-1][0] + subtext[0]
                                # addr_stack[-1][-1] = subtext[3]
                                # 不拼接的处理

                                addr_stack.append([subtext[0], subtext[3]])

                            else:
                                addr_save.extend([x[0] for x in addr_stack])
                                addr_stack = [[subtext[0], subtext[3]]]
                        elif subtext[1] == self.org_tag:
                            if addr_stack and addr_stack[-1][-1] == subtext[2]:
                                addr_stack = []
                            elif addr_stack and addr_stack[-1][-1] != subtext[2]:
                                addr_save.extend([x[0] for x in addr_stack])
                        elif addr_stack:
                            addr_save.extend([x[0] for x in addr_stack])
                            addr_stack = []
                    if addr_stack:
                        addr_save.extend([x[0] for x in addr_stack])
                    if addr_save:
                        dict_value_index = content_index[index]
                        for item in dict_value_index:
                            addr_save = list(set(addr_save))
                            dict_res[item].extend(addr_save)
                        records_list.extend(dict_value_index)

        return dict_res, records_list


    def names(self, han_result=None, uni_ls=None, content_index=None, field_name=None, semi_text=False, table_name=None):
        """
        对于判定为文本的字段，均进行姓名检测，输入词性标注和主体识别结果，返还包括披露数量、检测结果和采样值的字典集。
        """
        if han_result is None:
            return {}, []
        records_list = []
        dict_res = collections.defaultdict(list)

        for index, text in enumerate(han_result):
            # 这里用set,已经给姓名去重了
            target_text = list(set([item[0] for item in text if item[1] == self.person_tag]))
            if len(target_text) > 0:
                # target_text_str = " ".join(target_text)
                for temp in target_text:
                    if self._name_judgment_result(temp, field_name, table_name, semi_text):
                        # TODO 目前只考虑 * 作为遮盖符，且最多4个字的中国人名情况,根据unls长度采用合适的方法
                        raw = uni_ls[index]
                        # TODO 测试
                        if not ('*' in raw and len(raw) <= 4):
                            dict_value_index = content_index[index]
                            for item in dict_value_index:
                                dict_res[item].append(temp)
                            records_list.extend(dict_value_index)
        return dict_res, records_list

    def have_addr_with_field_name(self, series=None):
        """
        对识别内容中加入字段名辅助
        :param uni_ls:
        :param series:
        :return:
        """
        if series is None:
            return {}, []
        field_name = series.name
        index_dict = {}
        chinese_pattern = re.compile(r'[\u4e00-\u9fa5]')
        for index, value in series.items():
            """如果整个字符串有中文，则进行html标记预处理，否则直接返回空字符串"""
            if bool(chinese_pattern.search(value)):
                chinese_char = re.sub(constant.html_sub_regex_, '', value)
            else:
                chinese_char = ""
            if chinese_char in index_dict:
                index_dict[chinese_char].append(index)
            else:
                index_dict[chinese_char] = [index]
        content = list(index_dict.keys())
        content_index = list(index_dict.values())
        ner_res = self.safe_ner_func(content, field_name, tok_result=True)

        addr_records, addr_records_list = self.addrs(ner_res, content, content_index, field_name)

        return addr_records, addr_records_list

    def have_names_with_field_name(self, series=None):
        """
        对识别内容中加入字段名辅助
        :param uni_ls:
        :param series:
        :return:
        """
        if series is None:
            return {}, []
        field_name = series.name
        index_dict = {}
        chinese_pattern = re.compile(r'[\u4e00-\u9fa5]')
        for index, value in series.items():
            """如果整个字符串有中文，则进行html标记预处理，否则直接返回空字符串"""
            if bool(chinese_pattern.search(value)):
                chinese_char = re.sub(constant.html_sub_regex_, '', value)
            else:
                chinese_char = ""
            if chinese_char in index_dict:
                index_dict[chinese_char].append(index)
            else:
                index_dict[chinese_char] = [index]
        content = list(index_dict.keys())
        content_index = list(index_dict.values())
        ner_res = self.safe_ner_func(content, field_name)

        name_records, name_records_list = self.names(ner_res, content, content_index, field_name)

        return name_records, name_records_list

    def have_names_addr_with_field_name(self, series=None, table_name=None, person_status=True, info_type_list=None):
        """
        自由文本中
        对识别内容中加入字段名辅助，长文本字段TDDO 人名校验加强
        :param uni_ls:
        :param series:
        :return:
        """
        if series is None:
            return {}, []
        field_name = series.name
        index_dict = {}
        chinese_pattern = re.compile(r'[\u4e00-\u9fa5]')
        for index, value in series.items():
            """如果整个字符串有中文，则进行html标记预处理，否则直接返回空字符串"""
            if bool(chinese_pattern.search(value)):
                chinese_char = re.sub(constant.html_sub_regex_, '', value)
                if 'addr' not in info_type_list:
                    chinese_char = re.sub(constant.not_chinese_regex, '', value)
            else:
                chinese_char = ""
            if chinese_char in index_dict:
                index_dict[chinese_char].append(index)
            else:
                index_dict[chinese_char] = [index]
        content = list(index_dict.keys())
        content_index = list(index_dict.values())
        han_res = self.safe_ner_func(content, field_name, table_name, tok_result=True, person_status=person_status)
        if info_type_list is not None:
            if 'name' in info_type_list:
                name_records, name_records_list = self.names(han_res[self.ner_output_key], content, content_index,
                                                             field_name, semi_text=True, table_name=table_name)
            else:
                name_records, name_records_list = {}, []
            if 'addr' in info_type_list:
                addr_records, addr_records_list = self.addrs(han_res, content, content_index, field_name, table_name)
            else:
                addr_records, addr_records_list = {}, []
        else:
            name_records, name_records_list = self.names(han_res[self.ner_output_key], content, content_index, field_name, semi_text=True, table_name=table_name)
            addr_records, addr_records_list = self.addrs(han_res, content, content_index, field_name, table_name)

        return name_records, name_records_list, addr_records, addr_records_list
