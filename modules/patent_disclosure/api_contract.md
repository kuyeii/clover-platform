# API Contract

所有接口挂载到：

```text
/api/v1/patent-disclosure/api
```

## Health

`GET /health`

返回 skill、LLM、CNIPA、DOCX 和 SSE 可用性。

## Cases

- `POST /cases` 创建案件
- `GET /cases?limit=30&offset=0` 案件列表
- `GET /cases/{case_id}` 案件详情

## Materials

- `POST /cases/{case_id}/materials` 上传材料，multipart 字段为 `files` 和 `materialType`
- `DELETE /materials/{material_id}` 删除材料

允许材料类型：`source`、`reference`、`existing`。

## Generation

- `POST /cases/{case_id}/generate` 启动生成
- `GET /jobs/{job_id}` 获取任务详情
- `GET /jobs/{job_id}/stream` SSE 任务进度

SSE 仅发送 `progress`、`done`、`error` 事件，不发送正文内容。

## Artifacts

- `GET /cases/{case_id}/artifacts` 产物列表
- `GET /artifacts/{artifact_id}/download` 下载产物

不提供 preview、iterate、cancel API。

