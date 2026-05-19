"""
基于Faker的BaseProvider自定义的一个用于进行假名化的Provider
后续所有假名方法都提供两种，random_XX, pseudo_random_XX
random_XX：纯随机
pseudo_random_XX：根据固定的seed进行随机生成。目前似乎没有pseudo_random_XX的需求，先不写了
小贴士：后续更新假名库的时候，不要提供set，提供list。python的set底层是一个哈希表，不保证存储元素的顺序。每次读取一个set过来再手动转换成list，很可能每次得到的list顺序都不一样
"""

import random
import string
import exrex
from datetime import datetime
from faker.providers import BaseProvider
from app.extension.celery_task.pipt_task.assets import areacode
from app.extension.celery_task.pipt_task.assets import bin_dict, bin_lists
from app.extension.celery_task.pipt_task.assets.name_alphabet import *
from app.extension.celery_task.pipt_task.assets.pesudo_addr_database import *


class PseudoProvider(BaseProvider):

    def random_phone(self):
        # 不包括+86
        simplified_phone_regex = '1(?:(?:[38]\\d{2})|(?:9[0-35-9]\\d)|(?:619)|(?:74[019])|(?:(?:5[0-35-9]|4[5-9]|6[25-7]|7[0-35-8])\\d))\\d{7}'
        return exrex.getone(simplified_phone_regex)

    def random_car_plate_head(self):
        # 生成车牌前2位
        car_plate_pre_regex = r'(京[A-HJ-Z])|(津[A-HJ-NQR])|(冀[A-HJRTN])|(晋[A-HJ-O])|(蒙[A-HJ-LO])|(辽[A-HJ-NPV])|(吉[A-HJK])|(黑[A-HJ-NPR])|(沪[A-HJ-N])|(苏[A-HJ-NU])|(浙[A-HJ-L])|(皖[A-HJ-NP-S])|(闽[A-HJKOZ])|(赣[A-HJ-M])|(鲁[A-HJ-SU-WY])|(豫[A-HJ-NPSUV])|(鄂[A-HJ-SW])|(湘[A-HJ-NSU])|(粤[A-HJ-Z])|(桂[A-HJ-PR])|(琼[A-FO])|(渝[A-H])|(川[A-HJ-Z])|(贵[A-HJ])|(云[A-HJ-S])|(藏[A-HJ])|(陕[A-HJKVU])|(甘[A-HJ-NP])|(青[A-HO])|(宁[A-E])|(新[A-HJ-S])'
        return exrex.getone(car_plate_pre_regex)

    def random_car_plate_tail_icev(self):
        # 非新能源汽车（燃油汽车）的后5位
        letters_choices = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
        # 第一步：从[0,1,2,3]中随机选取一个数值，作为大写字母的数量
        num_letters = random.choice([0, 1, 2])
        # 第二步：生成随机的大写字母
        letters = ''.join(random.choices(letters_choices, k=num_letters))
        # 第三步：根据大写字母的数量确定阿拉伯数字的数量
        num_digits = 5 - num_letters  # 总长度为7，剩余部分是数字
        # 第四步：生成随机的阿拉伯数字
        digits = ''.join(random.choices(string.digits, k=num_digits))
        # 第五步：将字母随机插入到数字中，形成最终的车牌号
        # 将字母和数字合并
        plate = list(letters + digits)
        random.shuffle(plate)  # 随机打乱字母和数字的顺序
        # 输出最终的车牌号
        return ''.join(plate)

    def random_car_plate_tail_new_energy(self):
        letters_choices = 'ABCDEFGHJK'
        plate_number = ''
        # 第一步：等概率从两种格式中选取一种
        format_type = random.choice([1, 2])  # 1代表格式1，2代表格式2
        if format_type == 1:
            # 第一种格式：最后一位为大写字母，其余各位均为阿拉伯数字
            digits = ''.join(random.choices(string.digits, k=5))  # 前5位是数字
            letter = random.choice(letters_choices)  # 最后一位字母
            plate_number = digits + letter
        elif format_type == 2:
            # 第二种格式：第一位为大写字母，后四位为阿拉伯数字，其余位无要求
            letter = random.choice(letters_choices)  # 第一位字母
            digits = ''.join(random.choices(string.digits, k=4))  # 后四位是数字
            plate_number = letter + digits + random.choice(string.digits + letters_choices)
        # 输出生成的车牌号后6位
        return plate_number

    # 生成车牌目前不考虑[挂学警港澳]这几种特殊车种
    def random_car_plate(self, generate_head=True):
        if generate_head:
            car_plate_head = self.random_car_plate_head()
        else:
            car_plate_head = ''
        # 等概率生成一般油车与新能源汽车车牌
        car_type = random.choice([1, 2])
        if car_type == 1:
            car_plate_tail = self.random_car_plate_tail_icev()
        else:
            car_plate_tail = self.random_car_plate_tail_new_energy()

        return car_plate_head + car_plate_tail

    def random_ID_number_area(self):
        area_info = areacode.areacode_dict
        return random.choice(list(area_info.keys()))

    def random_ID_number_without_area_generation(self, area_digits, gender=None):
        coeff = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2]
        check = [1, 0, 'X', 9, 8, 7, 6, 5, 4, 3, 2]
        # 生成出生日期。限制出生年在1930 - 2010
        year = random.randint(1930, 2010)
        month = random.randint(1, 12)
        if month == 2:
            # 判断是否为闰年，闰年2月有29天，平年2月有28天
            if (year % 4 == 0 and year % 100 != 0) or (year % 400 == 0):
                max_day = 29
            else:
                max_day = 28
        elif month in [4, 6, 9, 11]:
            max_day = 30  # 4, 6, 9, 11月有30天
        else:
            max_day = 31  # 其他月份有31天
        day = random.randint(1, max_day)
        birth_digits = datetime(year, month, day).strftime('%Y%m%d')

        # 随机生成生日后两位
        random_digits = ''.join(random.choices(string.digits, k=2))

        # 性别位

        if gender:
            # 男性
            if gender == 1:
                gender_digit = random.choice('13579')
            # 女性
            elif gender == 0:
                gender_digit = random.choice('02468')
            else:
                raise ValueError("无效的性别信息，无法生成身份证号码")
        else:
            gender_digit = random.choice(string.digits)

        # 校验位
        pre_digits = area_digits + birth_digits + random_digits + gender_digit
        check_sum = 0
        for index, digit in enumerate(pre_digits):
            digit = int(digit)
            check_sum += digit * coeff[index]
        check_mod = check_sum % 11
        check_digit = str(check[check_mod])

        return pre_digits + check_digit

    def random_ID_number_with_area_and_gender_kept(self, origin_ID_number):
        area_digits = origin_ID_number[:6]
        gender = None
        if origin_ID_number[-2] in '13579':
            gender = 1
        else:
            gender = 0
        return self.random_ID_number_without_area_generation(area_digits, gender)

    # 根据luhn校验规则生成最后一位校验位
    def luhn_generate_check_digit(self, card_number: str) -> str:
        """基于 Luhn 算法生成校验位"""
        digits = [int(d) for d in card_number if d.isdigit()]
        digits.append(0)  # 先假设校验位为0

        checksum = 0
        odd = True
        for i, d in enumerate(reversed(digits)):
            if not odd:
                d *= 2
                if d > 9:
                    d -= 9
            checksum += d
            odd = not odd

        check_digit = (10 - (checksum % 10)) % 10
        return card_number + str(check_digit)

    def generate_bank_card_with_luhn(self, bin_code, len_expecting):
        # 随机生成len_expecting - len(bin_code) -  1 位
        tail_without_check_digit = ''.join(random.choices(string.digits, k=(len_expecting - len(bin_code) - 1)))
        return self.luhn_generate_check_digit(bin_code + tail_without_check_digit)

    def random_bank_card(self):
        bin_code = random.choice(bin_lists.len_six_prefix_list)
        return self.generate_bank_card_with_luhn(bin_code, bin_dict.bin_dict[bin_code])

    # 生成与原银行卡相同银行的银行卡
    def random_bank_card_from_same_bank(self, origin_bank_card):
        origin_bin_code = None
        for prefix in bin_lists.sorted_prefix_list:
            if origin_bank_card[:len(prefix)] == prefix:
                origin_bin_code = prefix
                break
        if not origin_bin_code:
            raise ValueError('输入银行卡号的bin_code有误')
        return self.generate_bank_card_with_luhn(origin_bin_code, bin_dict.bin_dict[origin_bin_code])

    # 邮箱。单纯随机字符串作为@前部分
    def random_email(self):
        email_types = ['163.com', 'qq.com', 'sina.com', 'sohu.com', 'outlook.com.cn', '126.com', 'yeah.net']

        len_pre_letters = random.choice(range(3, 10))
        pre_letters = ''.join(random.choices(string.ascii_letters, k=len_pre_letters))
        pre_numbers = str(random.choice(range(100)))
        if pre_numbers == '0':
            pre_numbers = ''
        elif len(pre_numbers) == 1:
            pre_numbers = '0' + pre_numbers

        return pre_letters + pre_numbers + '@' + random.choice(email_types)

    # 姓名。为了效率，不保存过大的名字库，名字用汉字概率拼接得到
    def random_name(self, gender=None):
        if gender is None:
            gender = random.choice([0, 1])
        if gender == 0:
            given_name_alphabet = common_female_alphabet
        else:
            given_name_alphabet = common_male_alphabet

        surname = random.choices(common_surnames, weights=common_surnames_prob, k=1)[0]
        given_name = ''.join(random.choices(given_name_alphabet, k=2))

        return surname + given_name

    def random_addr(self):
        addr_name = random.choice(addr_street_name)
        suffix = random.choice(addr_suffix)
        addr_num = random.choice(range(1, 1200))

        return addr_name + suffix + str(addr_num) + '号'


if __name__ == "__main__":
    from faker import Faker

    fake = Faker()
    fake.add_provider(PseudoProvider)

    # 手机号
    print(fake.random_phone())

    # 车牌
    print(fake.random_car_plate())

    # 身份证
    area_digits = fake.random_ID_number_area()
    print(fake.random_ID_number_without_area_generation(area_digits=area_digits))
    print(fake.random_ID_number_without_area_generation(area_digits='330411', gender=1))
    print(fake.random_ID_number_with_area_and_gender_kept('330411199807084611'))

    # 银行卡
    print(fake.random_bank_card())
    print(fake.random_bank_card_from_same_bank(origin_bank_card='622421198709273274'))

    # 邮箱
    print(fake.random_email())

    # 姓名
    print("随机姓名", fake.random_name())
    print("男性姓名", fake.random_name(1))
    print("女性姓名", fake.random_name(0))

    # 地址
    print(fake.random_addr())
