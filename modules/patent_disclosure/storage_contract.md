# Storage Contract

默认根目录：

```text
data/patent_disclosure
```

生产环境建议：

```text
PATENT_DISCLOSURE_DATA_DIR=/app/data/patent_disclosure
```

案件目录：

```text
cases/{case_id}/
├── materials/
│   ├── original/
│   └── parsed/
├── outputs/
│   ├── v1/
│   └── latest -> v1
├── tmp/
└── logs/
```

上传限制：

- 单文件默认 50MB
- 单案件累计默认 300MB
- 默认扩展名：`.md`、`.txt`、`.docx`、`.pptx`、`.pdf`、`.zip`

安全规则：

- 不直接使用用户文件名作为真实路径
- 所有路径必须限制在 `PATENT_DISCLOSURE_DATA_DIR` 下
- ZIP 解压必须防止 Zip Slip、绝对路径和软链接逃逸
- 下载接口不暴露真实磁盘路径
- 外部工具必须使用白名单和 `shell=False`

