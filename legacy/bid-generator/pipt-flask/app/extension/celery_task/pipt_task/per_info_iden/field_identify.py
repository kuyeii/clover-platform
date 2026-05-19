# -- coding: utf-8 --
# @Time : 2024/3/29 14:35
# @Author : Yao Sicheng
import time
import pandas as pd

from app.extension.celery_task.pipt_task.assets.constant import PHONE_LEN, BANK_LEN, ID_LEN
from app.extension.celery_task.pipt_task.utils.type_judgment import field_structured
from app.extension.celery_task.pipt_task.per_info_iden.result_handle import ResultHandle
from app.extension.celery_task.pipt_task.per_info_iden.identify_model import PersonIdentify
from app.extension.celery_task.pipt_task.utils import data_conversion as dc, type_judgment as tj, data_processing as dp
from app.util.status_code import CONTENT


def query_all_fields(df: pd.DataFrame, field_name_type_dict, person_status, table_name, info_type_list, person_identify: PersonIdentify, logger, config):
    """
    字段级识别方法，调用person_identify（HanPersonIdentify）中的方法对一个字段中的个人信息进行识别

    :param df:待识别表
    :param person_identify:基础识别类
    :param logger:
    :param config:
    :return:
    """
    # 整个表中的记录列表
    all_global_records = []
    seriesList = dp.dataset_to_series(df)
    test_records_list = []
    column_names = dc.dataset_get_columns(df)
    """ 此处是根据字段名进行类别初分 """

    """
    *******************************************************************************************
    """
    # 剔除全为空值的Series
    for index in range(len(seriesList)):
        if seriesList[index].isnull().all():
            # 忽略为空的序列

            test_records_list.append(None)
            # 在识别的索引记录表中加入空列表
            all_global_records.append([])
            continue
        column_name = column_names[index]
        temp_dict_2, global_records = field_handler(
            index,
            field_name_type_dict,
            seriesList,
            logger,
            config,
            column_name,
            table_name,
            info_type_list,
            person_status,
            person_identify)


        test_records_list.append(temp_dict_2)
        all_global_records.append(global_records)

    return test_records_list, column_names, all_global_records


def field_handler(index,
                  field_name_type_dict,
                  seriesList,
                  logger,
                  config,
                  column_name,
                  table_name,
                  info_type_list,
                  person_status,
                  person_identify):
    """
    字段级处理
    #################################### 遍历全部的字段###############################
    """

    start = time.time()

    # 进行Series纯数字检测并将Series字符串化。
    # 只对数字类型查看长度
    series_len = len(seriesList[index])

    digitest, series, num_max = dc.digit_test(seriesList[index])

    # 取Series的唯一值并进行去标识化程度检测
    uni_ls = series.dropna().unique().tolist()
    de_id_ratio = dc.de_id_test(uni_ls)
    de_status = dc.de_status_func(de_id_ratio, num_max)
    # naive_records_list = []
    # for column_index, column_iter in enumerate([[],[],[]]):
    #     if index in column_iter:

    # # 检索是否满足自定义元数据的要求
    # for




    this_records, naive_records_list = person_identify.naive_identify(uni_ls, series, info_type_list)

    # if digitest == 1:
    #     # 数字检测，若字符串为纯数字则不进行分词，直接进行手机号、身份证号和银行卡号的检测
    #     # 若为非纯数字，则进行分词和所有检测
    # if num_max < config["PHONE_LEN"] or field_name_type_dict[column_name] == 'no_sensitive':
    if 'phone' not in info_type_list or num_max < PHONE_LEN:
        phone_records, phone_records_list = person_identify.regex_identify()
    else:
        phone_records, phone_records_list = person_identify.regex_identify('phone', series)

    # 最大长度小于身份证位数，不进行身份证号检测
    if 'id_number' not in info_type_list or num_max < ID_LEN:
        ID_records, ID_records_list = person_identify.regex_identify()
    else:
        if field_name_type_dict[column_name] == 'id_like_columns_regex':
            field_name_judge = True
        else:
            field_name_judge = False
        ID_records, ID_records_list = person_identify.regex_identify('id_number', series, field_name_judge)
        identify_rate = len(ID_records_list) / series_len
        if identify_rate < 0.01:
            identify_rate = '小于0.01'
        else:
            identify_rate = '{:.2f}'.format(identify_rate)

        if 0 < len(ID_records_list) < 0.2 * series_len:
            logger.info("字段[{}]身份证号识别率{}，总共{}个，已保存，请确认".format(column_name,
                                                                                 identify_rate,
                                                                                 len(ID_records_list)))

    # 最大长度小于最小银行卡号位数，不进行银行卡号检测
    if 'bank' not in info_type_list or num_max < BANK_LEN:
        bank_records, bank_records_list = person_identify.regex_identify()
    else:
        if field_name_type_dict[column_name] == 'bank_like_columns_regex':
            field_name_judge = True
        else:
            field_name_judge = False
        bank_records, bank_records_list = person_identify.regex_identify('bank', series, field_name_judge)

    # 不是纯数字
    if digitest != 1:
        if 'ip' in info_type_list:
            if field_name_type_dict[column_name] == 'ip_columns_regex':
                ip_records, ip_records_list = person_identify.regex_identify('ip_plus', series)
            else:
                ip_records, ip_records_list = person_identify.regex_identify('ip', series)
        else:
            ip_records, ip_records_list = person_identify.regex_identify()
        if 'email' in info_type_list:
            email_records, email_records_list = person_identify.regex_identify('email', series)
        else:
            email_records, email_records_list = person_identify.regex_identify()
        seg_condition_test = tj.list_seg_condition(uni_ls)

        if 'car_id' in info_type_list and seg_condition_test:
            car_id_records, car_id_records_list = person_identify.regex_identify('car_id', series)
        else:
            car_id_records, car_id_records_list = person_identify.regex_identify()

        if ('name' in info_type_list or 'addr' in info_type_list) and seg_condition_test and not de_status and num_max > 1:
            """
            ****************NER模块进入的条件：识别配置里至少有姓名或地址中的一项， 有中文、非全部脱敏、长度最大值大于1（排除性别等字段）*********************************
            此处是对各个字段进行字段类别初分后进行抽样验证的部分
            当前的规则有：
            1. 结构化地址字段检测
            2. 结构化人名字段检测
            3. 结构化公司名检测
            """



            if config['is_fast_scan']:

                """先进行结构化字段检测，若满足识别率阈值，整个字段进行提取"""
                logger_info, field_type = field_structured(seriesList[index], person_identify.sample_type_num, field_name_type_dict[column_name], config)
                # 满足识别率的情况
                if logger_info:
                    logger.info(logger_info)
                    if 'name' in info_type_list and field_type == "PERSON":
                        # 结构化人名，仅进行人名识别
                        name_records, name_records_list = person_identify.structured_name_identify(series)
                        addr_records, addr_records_list = person_identify.addrs()
                    elif 'addr' in info_type_list and field_type == "ADDR":
                        name_records, name_records_list = person_identify.have_names_with_field_name()
                        # 结构化地址，进行结构化地址识别与人名的识别
                        addr_records, addr_records_list = person_identify.structured_addr_identify(series)

                        # name_records, name_records_list = person_identify.have_names_with_field_name(uni_ls, series)
                    else:
                        # 如果是 字段是XX人名称（例如行政相对人名称、纳税人名称），则是混合企业个人字段。
                        if 'name' in info_type_list and field_name_type_dict[column_name] == 'person_org_columns_regex':
                            filtered_data = ResultHandle.org_handel(series)
                            addr_records, addr_records_list = person_identify.have_addr_with_field_name()
                            name_records, name_records_list = person_identify.have_names_with_field_name(filtered_data)
                            if len(name_records) < len(filtered_data) * config['structured_person_num_ratio'] / 100:
                                name_records, name_records_list = {}, []
                        else:
                            name_records, name_records_list = person_identify.have_names_with_field_name()
                            addr_records, addr_records_list = person_identify.addrs()
                else:
                    """识别率不符合要求，对字段进行判断，若非目标字段，不使用NER进行识别"""
                    # 判断是否需要召回的长文本字段:平均长度大于30，且已识别到其他个人信息
                    if field_name_type_dict[column_name] == 'no_sensitive':
                        average_length = seriesList[index].str.len().mean()
                        if average_length > 30:
                            other_personal_info = car_id_records_list + bank_records_list + ID_records_list + phone_records_list + email_records_list
                            if other_personal_info:
                                field_name_type_dict[column_name] = 'semi_structured_regex'


                    if field_name_type_dict[column_name] == 'no_sensitive' or \
                            field_name_type_dict[column_name] == 'nation_like_columns_regx' or \
                            field_name_type_dict[column_name] == 'political_status_like_columns_regx':
                        addr_records, addr_records_list = person_identify.addrs()
                        name_records, name_records_list = person_identify.have_names_with_field_name()
                    elif 'name' in info_type_list and field_name_type_dict[column_name] == 'names_like_columns_regex':
                        name_records, name_records_list = person_identify.have_names_with_field_name(series)
                        addr_records, addr_records_list = person_identify.addrs()
                    elif 'addr' in info_type_list and field_name_type_dict[column_name] == 'addr_like_columns_regex':
                        addr_records, addr_records_list = person_identify.have_addr_with_field_name(series)
                        name_records, name_records_list = person_identify.have_names_with_field_name()
                    elif field_name_type_dict[column_name] == 'org_like_columns_regex':
                        addr_records, addr_records_list = person_identify.have_addr_with_field_name()
                        name_records, name_records_list = person_identify.have_names_with_field_name()
                    elif 'name' in info_type_list and field_name_type_dict[column_name] == 'person_org_columns_regex':
                        filtered_data = ResultHandle.org_handel(series)
                        addr_records, addr_records_list = person_identify.have_addr_with_field_name()
                        name_records, name_records_list = person_identify.have_names_with_field_name(filtered_data)
                        if len(name_records) < len(filtered_data) * config['structured_person_num_ratio']:
                            name_records, name_records_list = {}, []
                    else:
                        name_records, name_records_list, addr_records, addr_records_list = \
                            person_identify.have_names_addr_with_field_name(series, table_name, person_status, info_type_list)
            # 关闭快筛时
            else:
                name_records, name_records_list, addr_records, addr_records_list = \
                    person_identify.have_names_addr_with_field_name(series, table_name, person_status, info_type_list)
            # 无中文
        else:
            name_records, name_records_list = person_identify.have_names_with_field_name()
            addr_records, addr_records_list = person_identify.addrs()
        """
        *************************************************
        """
    else:
        # 纯数字，不进行下面的检测
        ip_records, ip_records_list = person_identify.regex_identify()
        email_records, email_records_list = person_identify.regex_identify()
        car_id_records, car_id_records_list = person_identify.regex_identify()
        name_records, name_records_list = person_identify.names()
        addr_records, addr_records_list = person_identify.addrs()
    # 这里记录的是各类信息的内容
    temp_dict_2 = {
        'name_records': name_records,
        'phone_records': phone_records,
        'id_number_records': ID_records,
        'car_id_records': car_id_records,
        'bank_records': bank_records,
        'email_records': email_records,
        'ip_records': ip_records,
        'addr_records': addr_records
    }

    # 这里把性别民族政治面貌的识别结果合并
    temp_dict_2.update(this_records)
    # 这里是记录不同信息所在的所有记录行位置，之后用于提取相应的原始记录
    global_records_dict = {
        'name_records': name_records_list,
        'phone_records': phone_records_list,
        'id_number_records': ID_records_list,
        'car_id_records': car_id_records_list,
        'bank_records': bank_records_list,
        'email_records': email_records_list,
        'ip_records': ip_records_list,
        'naive_records': naive_records_list,
        'addr_records': addr_records_list
    }
    global_records_list = []

    for records in global_records_dict.keys():
        global_records_list += global_records_dict[records]

    # 把用户自定义的识别内容补充上去
    custom_info_list = person_identify.custom_identify_type_list
    for custom_info, category_type in custom_info_list:
        if category_type == CONTENT:
            custom_info_records, custom_info_records_list = person_identify.regex_identify(custom_info, series)
        else:
            custom_info_records, custom_info_records_list = person_identify.metadata_identify(custom_info, series)

        temp_dict_2[f'{custom_info}_records'] = custom_info_records
        global_records_dict[f'{custom_info}_records'] = custom_info_records
        global_records_list += custom_info_records_list

    print("耗时{:.2f}秒".format(time.time() - start), column_name)
    return temp_dict_2, sorted(set(global_records_list))
