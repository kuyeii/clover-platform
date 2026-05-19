# -- coding: utf-8 --
# @Time : 2025/2/17 14:17
# @Author : Yao Sicheng
from urllib import parse

import pandas as pd
import pymysql
import pytz
from flask import current_app
from sqlalchemy import create_engine

from app.util.encrypt_decrypt import decrypt_password
from app.util.status_code import MYSQL


def database_connection_test(host, port, user, password, database, database_type=MYSQL):
    if database_type == MYSQL:
        _conn_engine_str = create_engine(f"mysql+pymysql://{user}:{password}@{host}:{port}/{database}")
    else:
        _conn_engine_str = create_engine(f"postgresql://{user}:{password}@{host}:{port}/{database}")

    try:
        with _conn_engine_str.connect() as conn:
            return True
    except Exception as e:
        return False
def get_database_source_conn_engine_str(data_source, database_type=MYSQL):
    """
    获取数据库源连接引擎字符串
    """
    # 数据库连接配置
    db_host = data_source.host
    db_port = data_source.port
    db_user = data_source.user
    db_password = decrypt_password(data_source.password)
    db_database = data_source.database_name
    if database_type == MYSQL:
        _conn_engine_str = f"mysql+pymysql://{db_user}:{parse.quote_plus(db_password)}@{db_host}:{db_port}/{db_database}"
    else:
        _conn_engine_str = f"postgresql://{db_user}:{parse.quote_plus(db_password)}@{db_host}:{db_port}/{db_database}"
    return _conn_engine_str


def utc_to_local(utc_dt):
    """
    将UTC时间转换为配置的本地时区时间
    :param utc_dt: UTC时间的datetime对象（无时区信息或UTC时区）
    :return: 本地时区的datetime对象（带时区信息）
    """
    # 获取配置的时区
    local_tz = pytz.timezone(current_app.config['APP_TIMEZONE'])

    # 如果传入的时间没有时区信息，视为UTC时间
    if utc_dt.tzinfo is None:
        utc_dt = pytz.utc.localize(utc_dt)

    # 转换为本地时区
    return utc_dt.astimezone(local_tz)



if __name__ == '__main__':
    flag = database_connection_test("localhost", 5432, "postgres", "1qaz2wsx", "postgres", 1)
    print(flag)
