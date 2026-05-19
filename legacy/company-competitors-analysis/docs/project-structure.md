# 当前项目结构（Python 后端版）

```text
.
├── backend/
│   ├── data/                 # 本地历史记录存储
│   │   ├── index.json
│   │   └── history/
│   ├── schemas/              # 历史记录 schema
│   ├── README.md
│   ├── requirements.txt      # Python 后端依赖说明；当前仅用标准库
│   └── server.py             # Python API + 工作流编排
├── docs/
├── public/
├── scripts/
│   └── dev.js                # 同时启动前端和 Python 后端
├── src/
│   ├── services/
│   │   └── analysisApi.js    # 前端只调用自己的后端 API
│   ├── App.jsx
│   └── main.jsx
├── .env.example
├── package.json
└── vite.config.js
```

## 已从 JS 后端迁到 Python 后端的内容

- Dify Workflow API Key 与 URL 读取
- Dify 请求发起逻辑
- Workflow 输出解析与错误处理
- 对比报告子工作流的并行调用与汇总调用
- 评分工作流重试与 JSON 解析
- 完整分析流程编排
- 历史结果持久化
- `result_id` 查询接口

## 前端保留的职责

- 表单输入和页面交互
- 展示分析结果、历史列表和报告导出
- 根据 URL 中的 `{result_id}` 拉取并渲染历史结果
