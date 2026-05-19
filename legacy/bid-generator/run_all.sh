#!/bin/bash
set -e
echo '启动 pipt-flask 服务...'
cd pipt-flask
pkill -f main_lite.py || true
python3 main_lite.py > ../logs/api.log 2>&1 &
API_PID=
sleep 5 # 等待服务启动
cd ..
echo '开始执行全链路编排...'
python3 orchestrator.py --input data/tender_documents/test_bid.md --tier 2 --session-name test_kb_session
echo '编排结束，关闭服务'
kill -9  || true
