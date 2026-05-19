import httpx
import time
import subprocess
import os

print('启动服务...')
os.system('pkill -f main_lite.py || true')
time.sleep(1)

proc = subprocess.Popen(['python3', 'main_lite.py'], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
time.sleep(5)  # 等待启动并创建 DB

try:
    print('1. 测试脱敏并入库...')
    url = 'http://127.0.0.1:5000/api/desensitize'
    payload = {
        'text': '我的名字是张三，电话 13812345678',
        'session_id': 'test_session_123'
    }
    with httpx.Client() as client:
        r = client.post(url, json=payload, timeout=10.0)
        print('脱敏响应代码:', r.status_code)
        print('脱敏原始响应:', r.text)
        resp = r.json()
        print('脱敏结果:', resp.get('desensitized_text'))
        print('实体映射表:', resp.get('mapping_table'))

        print('\n2. 测试基于 session_id 的还原...')
        url_restore = 'http://127.0.0.1:5000/api/restore'
        payload_restore = {
            'text': resp.get('desensitized_text'),
            'session_id': 'test_session_123'
        }
        r2 = client.post(url_restore, json=payload_restore)
        print('还原响应代码:', r2.status_code)
        print('还原结果:', r2.json())
        
        # 模拟错误的 session_id
        print('\n3. 测试错误的 session_id...')
        payload_err = {
            'text': resp.get('desensitized_text'),
            'session_id': 'wrong_session'
        }
        r3 = client.post(url_restore, json=payload_err)
        print('还原结果 (错误ID):', r3.json())

finally:
    proc.terminate()
    print('服务已关闭。')
