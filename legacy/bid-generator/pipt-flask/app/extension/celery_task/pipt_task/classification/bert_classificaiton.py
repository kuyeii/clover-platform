# -- coding: utf-8 --
# @Time : 2023/11/28 16:18
# @Author : Yao Sicheng

import torch
from transformers import AutoModelForSequenceClassification
from transformers import AutoTokenizer

from app.extension.celery_task.pipt_task.assets.constant import SENSITIVE_MODEL


class Instruction(object):

    def __init__(self, config):
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
