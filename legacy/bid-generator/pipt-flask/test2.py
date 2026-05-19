import httpx
import time
import subprocess
import os

os.system('pkill -f main_lite.py || true')
time.sleep(1)

proc = subprocess.Popen(['python3', 'main_lite.py'], stdout=open('server.log', 'w'), stderr=subprocess.STDOUT)
time.sleep(5)  # 等待启动

try:
    resp = httpx.post(
        "http://127.0.0.1:5000/api/desensitize",
        json={"text": "测试文本张三13811112222", "session_id": "test1234"},
        timeout=10.0
    )
    print("STATUS:", resp.status_code)
    print("BODY:", resp.text)
finally:
    proc.terminate()
