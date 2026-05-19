# -- coding: utf-8 --
# @Time : 2025/6/10 10:10
# @Author : Yao Sicheng
import re
from functools import wraps

from app.util.status_code import INFO

REG_XP = r"[{](.*?)[}]"
OBJECTS = ["job", "usage"]

class SystemLogger(object):
    """
    用户行为日志记录器
    """

    # message template
    template = None
    level = None

    def __init__(self, template=None, level=None):
        if template:
            self.template: str = template
        elif self.template is None:
            raise Exception("template must not be None!")
        if level:
            self.level = level
        else:
            self.level = INFO
        self.message = ""
        self.response = None
        self.log_allow = True
        self.high_load_state = False

    def __call__(self, func):
        @wraps(func)
        def wrap(*args, **kwargs):
            response = func(*args, **kwargs)
            self.response = response
            self.message, self.log_allow = self._parse_template()
            self.write_log()
            return response

        return wrap

    def write_log(self):
        if self.log_allow:
            from app.api.piptool.model.system_logger import SystemLog
            from starter import app

            with app.app_context():
                SystemLog.create_log(
                    message=self.message,
                    level=self.level,
                    commit=True,
                )

    # 解析自定义模板
    def _parse_template(self):
        message = self.template
        total = re.findall(REG_XP, message)
        for it in total:
            assert it in OBJECTS, "%s只能为job中的一个" % it
            if it == "job":
                item, _ = self.response
            # elif it == "usage":
            #     usage_percent = getattr(self.response, "json", None)
            #     cpu_usage_percent, memory_usage_percent = usage_percent['cpu_usage_percent'], usage_percent['memory_usage_percent']
            #     max_usage = max(cpu_usage_percent, cpu_usage_percent)
            #     # 高占用
            #     if max_usage > 160:
            #         if self.high_load_state:
            #             self.log_allow = False
            #         else:
            #             self.log_allow = True
            #         self.high_load_state = True
            #     # 滞回区间
            #     elif max_usage > 140:
            #         if self.high_load_state:
            #             self.log_allow = False
            #     # 恢复正常占用
            #     else:
            #         self.high_load_state = False
            #         self.log_allow = False
            #
            #     item = f'{cpu_usage_percent:.2f}%/{memory_usage_percent:.2f}%'
            else:
                item = None
            message = message.replace("{%s}" % it, str(item))
        return message, self.log_allow
