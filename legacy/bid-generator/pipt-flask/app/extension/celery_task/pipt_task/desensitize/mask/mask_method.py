from app.extension.celery_task.pipt_task.assets.bin_dict import bin_dict


def mask_email(email, desensitize_symbol):
    local, domain = email.split('@')
    if len(local) >= 5:
        masked_local = local[:len(local) - 5] + desensitize_symbol * 5
    else:
        masked_local = '*' * len(local)
    masked_email = masked_local + '@' + domain
    return masked_email


def mask_car(car, desensitize_symbol):
    if len(car) >= 5:
        masked_plate = car[:-5] + desensitize_symbol * 5
        return masked_plate
    else:
        raise ValueError("车牌号长度应至少为5位")


def mask_id(id_number, desensitize_symbol):
    if len(id_number) == 18:
        masked_id = id_number[:3] + desensitize_symbol * 11 + id_number[14:16] + desensitize_symbol * 2
        return masked_id
    else:
        raise ValueError("身份证号码应为18位")


def mask_phone(phone_number, desensitize_symbol):
    masked_phone = phone_number[:-8] + desensitize_symbol * 4 + phone_number[-4:]
    return masked_phone


def mask_ip(ip_address, desensitize_symbol):
    # 分割IP地址为4部分
    parts = ip_address.split('.')

    # 确保IP地址格式正确
    if len(parts) != 4:
        raise ValueError("Invalid IP address format")

    # 保留第一部分，其他部分替换为***
    anonymized_ip = f"{parts[0]}.{desensitize_symbol * 3}.{desensitize_symbol * 3}.{desensitize_symbol * 3}"

    return anonymized_ip


def mask_name(record, desensitize_symbol):
    if len(record) <= 3:
        mask_record = record[0] + desensitize_symbol * len(record[1:])
        return mask_record
    if len(record) == 4:
        mask_record = record[:2] + desensitize_symbol * len(record[2:])
        return mask_record
    else:
        return record[0] + desensitize_symbol * len(record[1:])


def default_mask(record, desensitize_symbol):
    return desensitize_symbol * len(record)


def mask_bank(record, desensitize_symbol):
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


'''
----------------------------------------------------------------------------------------------------------------
以下为提供一定自定义能力的mask方法
'''

def keep_head_masking(origin_text, keep_len, masking_len=-1, masking_character="*"):
    '''
    :param origin_text: 待脱敏原文本
    :param keep_len: 脱敏后保留原文的长度
    :param masking_len: 脱敏操作后，mask字符串长度。输入负数则将非keep_len部分全部遮盖
    :param masking_character: mask使用的字符
    :return:
    '''
    if keep_len > len(origin_text):
        raise ValueError('keep_len > 待脱敏文本长度，无法执行mask脱敏')
    keeping_part = origin_text[:keep_len]
    if masking_len > 0:
        masking_part = masking_character * masking_len
    else:
        masking_part = masking_character * (len(origin_text) - keep_len)

    return keeping_part + masking_part


def keep_tail_masking(origin_text, keep_len, masking_len=-1, masking_character="*"):
    if keep_len > len(origin_text):
        raise ValueError('keep_len > 待脱敏文本长度，无法执行mask脱敏')
    keeping_part = origin_text[-keep_len:]
    if masking_len > 0:
        masking_part = masking_character * masking_len
    else:
        masking_part = masking_character * (len(origin_text) - keep_len)

    return masking_part + keeping_part


# 遮蔽[st_index, end_index) 区间
def target_range_masking(origin_text, st_index, end_index, masking_character="*"):
    if not (0 <= st_index < end_index <= len(origin_text)):
        st_index = max(0, st_index)
        end_index = min(len(origin_text), end_index)
    masking_part = masking_character * (end_index - st_index)
    return origin_text[:st_index] + masking_part + origin_text[end_index:]


if __name__ == "__main__":
    test_string = "王小二"
    print(keep_head_masking(test_string, 1))
    print(keep_head_masking(test_string, 1, 5, "$"))

    test_string2 = "15381212717"
    print(keep_tail_masking(test_string2, 4))
    print(keep_tail_masking(test_string2, 4, 3))

    test_string3 = "12345"
    print(target_range_masking(test_string3, 1, 3))
    print(target_range_masking(test_string3, 1, 5))
