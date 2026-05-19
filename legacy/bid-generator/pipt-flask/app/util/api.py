# -- coding: utf-8 --
# @Time : 2025/6/3 16:12
# @Author : Yao Sicheng

import requests
import json
from requests.exceptions import RequestException

from app.util.status_code import GET, POST, PUT


def call_api(api_url, field, method=GET, payload=None, token=None):
    """
    通用API调用函数

    参数:
    api_url -- API端点URL
    method  -- HTTP方法 (GET/POST/PUT/DELETE)
    payload -- 请求数据 (字典)
    token   -- 认证令牌
    """
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json"
    }

    # 添加认证头
    if token:
        headers["Authorization"] = f"Bearer {token}"

    try:
        # 根据请求方法发送请求
        if method == GET:
            response = requests.get(api_url, headers=headers, params=payload)
        elif method == POST:
            response = requests.post(api_url, headers=headers, data=json.dumps(payload))
        elif method == PUT:
            response = requests.put(api_url, headers=headers, data=json.dumps(payload))
        else:
            response = requests.delete(api_url, headers=headers)

        if response.status_code == requests.codes.ok:
            return True, response.json()
        else:
            return False, response.json()
    except RequestException as e:
        return False, {'message': e}
    except ValueError as e:
        return False, {'message': e}


# 使用示例
if __name__ == "__main__":
    # 示例1: GET请求
    _, info = call_api(
        "http://data.zjzwfw.gov.cn/jdop_front/interfaces/cata_4368/get_data.do",
        method=0,
        payload={'pageNum':1, 'pageSize':1, 'appsecret': 'f90846da882549bfa609fcd394fe44fd'},
        field=None
    )
    print(info['message'])

    # 示例2: POST请求
    _, info = call_api(
        "https://api.example.com/users",
        method="POST",
        payload={"name": "张三", "email": "zhangsan@example.com"},
        token="your_access_token"
    )
    print(info['message'])
