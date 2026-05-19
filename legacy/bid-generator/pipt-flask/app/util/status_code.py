#-- coding: utf-8 --
# @Time : 2025/5/26 17:16
# @Author : Yao Sicheng
import logging

# 任务/数据表执行状态码
PENDING = 0
PROGRESS = 1
SUCCESS = 2
FAILURE = 3
OTHER = 4

# 数据源类型
DATABASE = 0
API = 1
FILE = 2

# 是否开启
NO = 0
YES = 1

# 数据源使用类型
SCAN_DATASOURCE = 0
SAVE_DATASOURCE = 1

# request code
GET = 0
POST = 1
PUT = 2
DELETE = 3

# 数据库类型
MYSQL = 0
POSTGRES = 1

# log code
INFO = 0
WARN = 1
ERROR = 2

# log_type
TASK = 0
USAGE = 1

# 自定义识别类型
CONTENT = 0
METADATA = 1

