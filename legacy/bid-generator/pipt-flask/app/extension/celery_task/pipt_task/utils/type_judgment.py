import re
import string as strg
import time

from app.extension.celery_task.pipt_task.assets import areacode, constant
from app.extension.celery_task.pipt_task.assets.constant import CAR_ALPHA
from app.extension.celery_task.pipt_task.utils import luhn
from app.extension.celery_task.pipt_task.utils.luhn import card_num


def not_validate(num):
    return True

def field_structured(series, sample_type_num, field_type, config):
    logger_info = None
    uni_series = series.drop_duplicates()
    if len(uni_series) >= config['sample_num']:
        sample = uni_series.sample(n=config['sample_num'], random_state=42).fillna(" ").astype(str)
    elif len(uni_series) > 10:
        sample = uni_series.fillna(" ").astype(str)
    else:
        return logger_info, None
    sample = [re.sub(constant.html_sub_regex_, '', item) for item in sample.to_list()]
    field_type, num_ratio = sample_type_num(sample, series.name, field_type)
    series_len = series.dropna().apply(lambda x: len(str(x)))
    series_mean_len = series_len.mean()
    series_std_len = series_len.std()
    # 结构化检测
    # identify_done = False
    if field_type == "PERSON":
        if num_ratio > config['structured_person_num_ratio'] and 2 <= series_mean_len <= 4:
            logger_info = "字段【{}】样例：{},人名识别率：{:.2f}，平均长度：{:.2f}，长度标准差：{:.2f}，命中规则：结构化人名".format(
                    series.name, sample[0], num_ratio, series_mean_len, series_std_len)
    elif field_type == "ORG":
        if num_ratio > config['structured_org_num_ratio']:
            logger_info = "字段【{}】样例：{}，机构识别率：{:.2f}，平均长度：{:.2f}，长度标准差：{:.2f}，命中规则：结构化机构名".format(
                series.name, sample[0], num_ratio, series_mean_len, series_std_len)
    elif field_type == "ADDR":
        # 是否满足阈值要求，不满足则进行常规识别
        if num_ratio > config['structured_location_num_ratio']:
            logger_info = "字段【{}】样例：{}，地址识别率：{:.2f}，平均长度：{:.2f}，长度标准差：{:.2f}，命中规则：结构化地址".format(
                    series.name, sample[0], num_ratio, series_mean_len, series_std_len)

    return logger_info, field_type


def validate_car(car):
    """汽车车牌校验"""
    car = re.sub(r'\.', '', car)
    car_len = len(car)
    # 非新能源车牌，其中英文字母数量不多于3个
    if car_len == 7:
        alpha_num = sum(1 for char in car[2:] if 'A' <= char <= 'Z')
        if alpha_num <= 2:
            return True
    # 新能源车牌，第3位或最后一位为[A-HJK]
    elif car_len == 8:
        # 最后一位为[A-HJK]，其余都是数字
        if car[-1] in CAR_ALPHA:
            return car[2:7].isdigit()
        # 第三位为[A-HJK]，最后4位是数字
        elif car[2] in CAR_ALPHA:
            return car[4:].isdigit()
    return False
def validate_email(email):
    if re.search(r'\*', email) is not None:
        return False
    return True

def validate_ID(ID):
    coeff = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2]
    check = [1, 0, 'X', 9, 8, 7, 6, 5, 4, 3, 2]
    val_ID_test = False
    if int(ID[6:10]) in range(1900, 2100):
        try:
            time.strptime(ID[6:14], "%Y%m%d")
        except:
            return val_ID_test
        tmp = 0
        for i in range(0, 17):
            tmp = tmp + int(ID[i]) * coeff[i]
        mod = tmp % 11
        if str(check[mod]) == ID[-1] or mod == 2 and ID[-1] == 'x':
            val_ID_test = True
    return val_ID_test and ID[:6] in areacode.areacode_dict


def validate_bank(bank, number_len_check=True):
    """

    @param bank:
    @param number_len_check: 是否需要进行号码长度校验
    @return:
    """
    card_num_result = card_num(bank)
    if card_num_result is not None:
        if number_len_check:
            return card_num_result == len(bank) and luhn.is_valid(bank)
        return luhn.is_valid(bank)

    return False


def is_chinese(char):
    if u'\u4e00' < char < u'\u9fff':
        return True
    return False


def is_chinese2(string):
    """
    输入文本值，检测是否为中文字符。
    """
    for chart in string:
        if chart < u'\u4e00' or chart > u'\u9fff':
            return False
    return True


# 列表中中文字符的情况
def list_seg_condition(str_ls):
    test_res = False
    for element in str_ls:
        for char in element:
            if is_chinese2(char):
                test_res = True
                break
    return test_res


def is_english(char):
    if char in strg.ascii_lowercase + strg.ascii_uppercase:
        return True
    return False


def is_digit(char):
    if char.isdigit():
        return True
    return False


def is_deid(char):
    if char == '*':
        return True
    return False


def contain_test(string, chichar_test, engchar_test, numchar_test, otherchar_test, deidchar_test):
    chichar = False
    engchar = False
    numchar = False
    deidchar = False
    otherchar = False

    for char in string:
        if is_chinese(char):
            chichar = True
        if is_english(char):
            engchar = True
        if is_digit(char):
            numchar = True
        if is_deid(char):
            deidchar = True
        if not is_chinese(char) and not is_english(char) and not is_digit(char) and not is_deid(char):
            otherchar = True
    if chichar:
        chichar_test += 1
    if engchar:
        engchar_test += 1
    if numchar:
        numchar_test += 1
    if otherchar:
        otherchar_test += 1
    if deidchar:
        deidchar_test += 1

    return chichar_test, engchar_test, numchar_test, otherchar_test, deidchar_test
