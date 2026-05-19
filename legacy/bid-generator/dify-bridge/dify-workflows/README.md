# dify-workflows — 历史 Dify 工作流归档文档

> 本目录用于保存 `dify-bridge` 时代的旧版 DSL 说明。当前实际纳管口径请以 `../../dify/manifest.yml` 和 `../../docs/dify-workflows.md` 为准。

## 历史工作流总览

| # | 工作流名 | .env 变量 | 状态 |
|---|---------|-----------|------|
| 1 | `pro-engine-requirement-extractor` | `DIFY_WORKFLOW_REQUIREMENT_EXTRACTOR` | 历史归档 |
| 2 | `pro-engine-structure-generator` | `DIFY_WORKFLOW_STRUCTURE_GENERATOR` | 当前已迁移到 `dify/workflows/` |
| 3 | `pro-engine-content-writer` | `DIFY_WORKFLOW_CONTENT_WRITER` | 当前已迁移到 `dify/workflows/` |
| 4 | `pro-engine-content-group-writer` | `DIFY_WORKFLOW_CONTENT_GROUP_WRITER` | 当前已迁移到 `dify/workflows/` |
| 5 | `pro-engine-content-rewrite` | `DIFY_WORKFLOW_CONTENT_REWRITE` | 当前已迁移到 `dify/workflows/` |
| 6 | `pro-engine-group-review-writer` | `DIFY_WORKFLOW_GROUP_REVIEW_WRITER` | 历史归档 |
| 7 | `pro-engine-response-content-writer` | `DIFY_WORKFLOW_RESPONSE_CONTENT_WRITER` | 当前已迁移到 `dify/workflows/` |

---

## 工作流 1：需求提取 (requirement_extractor)

**用途**：从招标文件原文（已脱敏）中提取结构化需求列表

### 节点流程

```
开始 → LLM（需求分类提取，结构化输出）→ 结束
```

### 开始节点输入变量

| 变量名 | 类型 | 说明 |
|--------|------|------|
| `raw_document` | 段落文本 | 脱敏后的招标文件全文（最多 10,000 字） |
| `project_name` | 短文本 | 项目名称（辅助 LLM 理解背景） |

### 结束节点输出变量

变量名：`structured_output`（映射 LLM 的 structured_output 字段）

```json
{
  "bid_type": "tech",
  "project_summary": "省级政务云平台建设项目",
  "requirements": [
    { "type": "tech", "content": "系统需支持微服务架构，单节点 QPS ≥ 5000" },
    { "type": "biz",  "content": "供应商须具备系统集成三级资质" },
    { "type": "score","content": "安全等保三级响应方案完整", "points": 10 }
  ]
}
```

### LLM 结构化输出 Schema

```json
{
  "type": "object",
  "required": ["bid_type", "project_summary", "requirements"],
  "properties": {
    "bid_type": { "type": "string", "description": "tech / business / hardware / service" },
    "project_summary": { "type": "string" },
    "requirements": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["type", "content"],
        "properties": {
          "type": { "type": "string", "enum": ["tech", "biz", "score"] },
          "content": { "type": "string" },
          "points": { "type": "integer" }
        }
      }
    }
  }
}
```

---

## 工作流 2：大纲生成 (structure_generator)

**用途**：将需求列表转换为含一级+二级标题的标书目录框架，并为每个一级标题生成 AI 写作引导提示

**可选**：在 LLM 节点后串联 Critic LLM 节点对大纲进行质量自审（覆盖评分点、字数平衡）

### 节点流程

```
开始 → LLM Generator（大纲生成）→ [可选] LLM Critic（质量审核）→ 结束
```

### 开始节点输入变量

| 变量名 | 类型 | 说明 |
|--------|------|------|
| `requirements` | 段落文本 | 格式化需求文本，每行格式：`[类别] 需求内容（N 分）` |
| `bid_type` | 短文本 | `tech` / `business` |

### 结束节点输出变量

变量名：`structured_output`（映射 LLM Critic 或 Generator 的 structured_output）

```json
{
  "outline": [
    {
      "id": "sec_overview",
      "title": "第一章：总体技术方案",
      "wordCount": 2000,
      "writingHint": "重点阐述项目理解与核心技术路线，与评分标准"方案可行性"直接挂钩。",
      "children": [
        { "id": "sec_overview_1", "title": "1.1 项目背景与需求理解", "wordCount": 600 },
        { "id": "sec_overview_2", "title": "1.2 整体技术路线设计", "wordCount": 900 },
        { "id": "sec_overview_3", "title": "1.3 核心技术亮点", "wordCount": 500 }
      ]
    }
  ]
}
```

### LLM 结构化输出 Schema（顶层必须是 object）

```json
{
  "type": "object",
  "required": ["outline"],
  "properties": {
    "outline": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "title", "wordCount", "children"],
        "properties": {
          "id": { "type": "string" },
          "title": { "type": "string", "description": "第X章：章节名" },
          "wordCount": { "type": "integer" },
          "writingHint": { "type": "string", "description": "AI写作引导，50-100字" },
          "children": {
            "type": "array",
            "items": {
              "type": "object",
              "required": ["id", "title", "wordCount"],
              "properties": {
                "id": { "type": "string" },
                "title": { "type": "string", "description": "X.X 节名" },
                "wordCount": { "type": "integer" }
              }
            }
          }
        }
      }
    }
  }
}
```

---

## 工作流 3：内容生成 (content_writer)

**用途**：按章节生成标书正文内容，结合 RAG 知识库检索和联网搜索（待配置）

### 节点流程（规划）

```
开始 → 知识库检索 → [可选] 联网搜索 → LLM 写作 → 结束
```

### 开始节点输入变量（规划）

| 变量名 | 类型 | 说明 |
|--------|------|------|
| `section_title` | 短文本 | 当前章节标题 |
| `writing_hint` | 段落文本 | 大纲生成阶段产生的 writingHint |
| `requirements` | 段落文本 | 与该章节相关的需求摘要 |
| `expected_words` | 整数 | 目标字数 |

---

## 工作流 4：H2 分组正文生成 (content_group_writer)

**用途**：以单个 H2 为单位，一次生成其下多个 H3 子章节，减少重复上下文注入和 Dify 调用次数。

### 节点流程

```
开始 → 知识库检索 → [可选] 联网搜索 → LLM 批量写作 → 代码清洗/JSON校验 → 结束
```

### 开始节点输入变量

| 变量名 | 类型 | 说明 |
|--------|------|------|
| `group_id` | 短文本 | H2 分组 ID |
| `group_title` | 短文本 | H2 标题 |
| `expected_total_words` | 整数 | 本组总目标字数 |
| `project_summary` | 段落文本 | 项目蓝图摘要 |
| `global_outline` | 段落文本 | 当前 H2 邻域大纲 |
| `placeholder_hint` | 段落文本 | 占位符保留规则 |
| `requires_search` | 短文本 | `"true"` / `"false"` |
| `group_analysis_context` | 段落文本 | 本组共享解析依据 |
| `search_query` | 短文本 | 联网搜索关键词，由后端拼接 H2 标题、H3 标题与关键词 |
| `children_json` | 段落文本 | 子章节数组 JSON 字符串 |

### 结束节点输出变量

| 变量名 | 类型 | 说明 |
|--------|------|------|
| `sections` | 字符串 | JSON 数组字符串，每项包含 `section_id`、`section_title`、`content` |
| `group_feedback` | 字符串 | 可选，组级反馈 |

---

## 工作流 5：单章节重生成 (content_rewrite)

**用途**：对当前单章节初稿先 review，再 rewrite，只把最终改写正文回传给前端。

### 节点流程

```
开始 → LLM REVIEW → LLM REWRITE → 代码清洗/JSON解析 → 结束
```

### 开始节点输入变量

| 变量名 | 类型 | 说明 |
|--------|------|------|
| `section_id` | 短文本 | 章节 ID |
| `section_title` | 短文本 | 章节标题 |
| `current_content` | 段落文本 | 当前章节已有正文 |
| `rewrite_instruction` | 段落文本 | 本次补充改写要求 |
| `expected_words` | 整数 | 本次目标字数 |
| `project_summary` | 段落文本 | 项目蓝图摘要 |
| `global_outline` | 段落文本 | 当前章节邻域大纲 |
| `section_outline_slice` | 段落文本 | 当前章节局部大纲 |
| `analysis_context` | 段落文本 | 当前章节解析依据 |
| `placeholder_hint` | 段落文本 | 占位符保留规则 |

### 结束节点输出变量

| 变量名 | 类型 | 说明 |
|--------|------|------|
| `text` | 字符串 | 改写后的章节正文 |
| `feedback` | 字符串 | 可选，内部调试信息 |
| `quality_score` | 数字 | 可选，内部调试评分 |

---

## 工作流 6：H2 手动评估 (group_review_writer)

**用途**：历史整章评估链路，当前前端不再暴露，仅保留 DSL 供回溯。 

---

## 维护说明

- 当前不要再把新 DSL 回写到本目录。
- 当前应维护 `../../dify/workflows/` 和 `../../dify/manifest.yml`。
- 本目录仅用于回溯旧版工作流版本变化。
