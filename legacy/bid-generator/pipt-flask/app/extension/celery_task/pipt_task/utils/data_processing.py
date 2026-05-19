import re

import pandas as pd

from app.extension.celery_task.pipt_task.assets.constant import NEED_FIELD_LEN


class BatchIterator:
    def __init__(self, data, batch_size):
        self.data = data
        self.batch_size = batch_size
        self.current_index = 0

    def __iter__(self):
        return self

    def __next__(self):
        if self.current_index >= len(self.data):
            raise StopIteration
        else:
            batch = self.data[self.current_index:self.current_index + self.batch_size]
            self.current_index += self.batch_size
            return batch


def sort_file_list(tempo_file_list):
    sort_dict = {}
    for i in tempo_file_list:
        index = int(re.findall(r"[0-9]+.*(?=\.)", i)[0])
        sort_dict[index] = i
    tempo_sort_res = sorted(sort_dict.items())
    sort_res = []
    for tup in tempo_sort_res:
        key, value = tup
        sort_res.append(value)
    return sort_res


def dataset_to_series(df):
    """
    输入数据表返还Series列表集合,即将数据表拆分为column为元素单位的列表。
    """
    # df = df.replace(['无数据'], [None]).replace(['无'], [None]).replace(['空'], [None])
    se_list = []
    for c, ls in df.items():
        se = pd.Series(ls)
        se = se.dropna()
        se_list.append(se)
    return se_list

def tok_process(raw, raw_tok):
    """用于处理拼接字段名后，返回实际的字段内容"""
    if len(raw) >= NEED_FIELD_LEN:
        return raw_tok
    raw_len = len(raw)
    current_num = 0
    new_raw_tok = []
    raw_tok_reversed = list(reversed(raw_tok))
    for tok in raw_tok_reversed:
        current_num += len(tok)
        if current_num <= raw_len:
            new_raw_tok.append(tok)
        else:
            return list(reversed(new_raw_tok))

if __name__ == '__main__':
    tok_process("李明", ["名称", "是", "李明"])
