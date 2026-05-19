# pipt-flask (pipt-lite 分支) — ProEngine 后端 API 服务

> FastAPI · NER 识别 · 文本脱敏 · 项目级 Dify 工作流代理

> 当前 `dify/manifest.yml` 纳管的 DSL 已收敛到 7 条；本 README 若提到 `requirement_extractor` 等旧链路，表示代码侧仍保留兼容调用，不代表它们仍在当前清理后的 `dify/workflows/` 中。

## 职责

1. **NER 识别 + 脱敏**：招标文件上传时自动脱敏，保护供应商/人员隐私
2. **需求提取**：当前代码仍兼容调用 Dify `requirement_extractor` 历史工作流，从招标文件中提取结构化需求
3. **大纲生成**：调用 Dify `structure_generator` 工作流，生成含一级+二级标题和 `writingHint` 的大纲
4. **系统配置**：读写 `config.yaml` · 工作流状态查询

## API 接口

### 通用

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/health` | 健康检查 |
| GET | `/api/recognize` | NER 识别 |
| POST | `/api/desensitize` | 文本脱敏（mask/hash/placeholder） |
| POST | `/api/desensitize/batch` | 批量脱敏 |

### 项目流程

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/projects/extract` | 上传招标文件 → 脱敏 → 调 Dify 提取结构化需求 |
| POST | `/api/projects/generate-outline` | 需求列表 → 调 Dify 生成一级+二级大纲 |

### 配置

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/config/template` | 读取 `config.yaml` + 模板 YAML |
| PUT | `/api/config/global` | 写入 `config.yaml` |
| GET | `/api/config/workflow-status` | 查询工作流密钥配置状态 |

## `/api/projects/extract` 接口说明

```
POST /api/projects/extract
Content-Type: multipart/form-data

字段：
  file                — 招标文件（PDF / DOCX / TXT / MD）
  project_name        — 项目名（可选，默认取文件名）
  enable_desensitize  — true/false（默认 true）
  desensitize_profile — "tender"（轻度）/ "default"（严格）
```

**脱敏流程**：提取文本 → pipt 脱敏引擎（mask 模式）→ 脱敏文本发给 Dify → 返回 `requirements[]` + `bid_type` + `project_summary`

## `/api/projects/generate-outline` 接口说明

```
POST /api/projects/generate-outline
Content-Type: application/json

{
  "requirements": [...],   // 核对后的需求列表
  "bid_type": "tech"       // tech / business
}
```

返回：`{sections: [{id, title, wordCount, writingHint, children: [{id, title, wordCount}]}]}`

## Dify 工作流密钥管理

当前已纳入 `dify/manifest.yml` 与统一 rewrite 管理的工作流：

| 工作流 | 说明 | .env 变量 |
|--------|------|-----------|
| `structure_generator` | 大纲生成 | `DIFY_WORKFLOW_STRUCTURE_GENERATOR` |
| `content_writer` | 单章节内容生成 | `DIFY_WORKFLOW_CONTENT_WRITER` |
| `content_group_writer` | H2 分组批量生成 | `DIFY_WORKFLOW_CONTENT_GROUP_WRITER` |
| `content_rewrite` | 单章节改写 | `DIFY_WORKFLOW_CONTENT_REWRITE` |
| `response_content_writer` | 响应类正文生成 | `DIFY_WORKFLOW_RESPONSE_CONTENT_WRITER` |
| `diagram_generator` | 图表生成 | `DIFY_WORKFLOW_DIAGRAM_GENERATOR` |
| `doc_analysis` | 文档分析 | `DIFY_WORKFLOW_DOC_ANALYSIS` |

历史兼容链路仍可能读取以下变量，但不属于当前清理后的 DSL 规范入口：

- `DIFY_WORKFLOW_REQUIREMENT_EXTRACTOR`
- `DIFY_WORKFLOW_BLUEPRINT_GENERATOR`
- `DIFY_WORKFLOW_GROUP_REVIEW_WRITER`
- `DIFY_WORKFLOW_ATTACHMENT_GENERATOR`
- `DIFY_WORKFLOW_SCORING_ASSISTANT`

密钥通过 `python-dotenv` 从项目根目录 `.env` 自动加载，后端通过 `_get_workflow_key(name)` 读取。

## 快速启动

```bash
# 安装依赖
pip install -r requirements-lite.txt
pip install pdfplumber python-docx python-dotenv

# 配置密钥（在项目根目录）
# 编辑 .env，填入 DIFY_WORKFLOW_* 变量

# 启动服务
python main_lite.py
# API Doc: http://localhost:5000/apidoc
```

## 脱敏 profile 配置

脱敏方案在 `config.yaml` 的 `pipt.profiles` 中定义：

| Profile | 覆盖实体 | 方法 |
|---------|--------|------|
| `tender` | 姓名、电话、邮箱、身份证 | mask（遮盖） |
| `default` | 以上 + 机构名、地址、银行、IP、车牌 | placeholder |
