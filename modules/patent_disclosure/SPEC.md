# 专利交底书模块规范

本模块对应 Stage 10-G：专利交底书生成模块集成。模块以 Clover Platform 原生前后端方式接入，不使用 iframe、独立微服务、Dify workflow 或前端轮询。

## 范围

- 前端页面：`apps/web/src/modules/patent-disclosure`
- 后端接口：`apps/api/app/api/patent_disclosure.py`
- 后端服务：`apps/api/app/services/patent_disclosure_service.py`
- 数据契约：`patent_disclosure` schema
- 上游 skill：`packages/patent_disclosure_skill/upstream`
- Clover 适配层：`packages/patent_disclosure_skill/adapter`

## 核心流程

```text
新建案件
→ 上传项目材料
→ 配置生成参数
→ 启动生成
→ SSE 查看实时进度
→ 国知局查新
→ 生成 Markdown + Word 技术交底书
→ 下载产物
```

## 明确不做

- iframe 或 legacy 应用托管
- 独立服务、Celery/RQ、Redis 队列
- Dify workflow
- 前端轮询任务进度
- 任务取消
- 产物在线预览
- 迭代修订

## 接入方式

LLM 仅支持 OpenAI-compatible Chat Completions：

```text
PATENT_DISCLOSURE_LLM_BASE_URL
PATENT_DISCLOSURE_LLM_API_KEY
PATENT_DISCLOSURE_LLM_MODEL
```

查新是主流程必做能力。系统优先使用国知局公布公告查新；CNIPA 工具不可用、超时、返回空结果或查新失败时，自动降级到容器内可执行的公开来源检索（优先 Google Patents）。只有国知局与所有降级检索均失败或无可用结果时，任务才进入 `failed` 状态。
