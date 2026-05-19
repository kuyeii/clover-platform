# ProEngine — Dify 工作流接口说明

> 本文档只描述当前已经纳入 `dify/manifest.yml + dify/workflows/` 管理的 7 条工作流。`requirement_extractor`、`blueprint_generator`、`scoring_assistant`、`attachment_generator`、`group_review_writer` 等旧链路不在当前清理后的 DSL 规范入口内。

> 所有工作流均通过 `_get_workflow_key(name)` 从 `.env` 读取对应 API Key。

## 当前纳管工作流

| 工作流 | `.env` 变量 | 说明 |
|--------|-------------|------|
| `structure_generator` | `DIFY_WORKFLOW_STRUCTURE_GENERATOR` | 生成一级、二级大纲与 `writingHint` |
| `content_writer` | `DIFY_WORKFLOW_CONTENT_WRITER` | 生成单章节正文 |
| `content_group_writer` | `DIFY_WORKFLOW_CONTENT_GROUP_WRITER` | 以 H2 为单位批量生成多个 H3 |
| `content_rewrite` | `DIFY_WORKFLOW_CONTENT_REWRITE` | 对单章节草稿执行 review + rewrite |
| `response_content_writer` | `DIFY_WORKFLOW_RESPONSE_CONTENT_WRITER` | 生成响应情况类章节 |
| `diagram_generator` | `DIFY_WORKFLOW_DIAGRAM_GENERATOR` | 生成图表示意相关内容 |
| `doc_analysis` | `DIFY_WORKFLOW_DOC_ANALYSIS` | 执行文档分析与抽取 |

## 1. `structure_generator` — 大纲生成

触发时机：用户核对需求列表后，点击“生成大纲”时调用。

**输入**

| 字段 | 类型 | 说明 |
|------|------|------|
| `requirements` | string | 格式化需求文本，每行形如 `[技术] 需求内容（N 分）` |
| `bid_type` | string | 标书类别，如 `tech` / `business` |

**输出**

| 字段 | 类型 | 说明 |
|------|------|------|
| `outline` | array | 章节数组，包含 `id`、`title`、`wordCount`、`writingHint`、`children` |

## 2. `content_writer` — 单章节正文生成

触发时机：TemplateEditor 中逐章节点击“AI 生成内容”时调用。

**输入**

| 字段 | 类型 | 说明 |
|------|------|------|
| `section_title` | string | 当前章节标题 |
| `writing_hint` | string | 当前章节写作引导 |
| `expected_words` | integer | 预计字数 |
| `project_summary` | string | 项目摘要或蓝图摘要 |
| `requires_search` | string | `"true"` / `"false"` |
| `placeholder_hint` | string | 占位符保留说明 |

**输出**

| 字段 | 类型 | 说明 |
|------|------|------|
| `text` | string | Markdown 正文，需保留占位符 |

说明：当前 DSL 内包含“联网版 LLM”“非联网版 LLM”和“快速占位符修复”节点，模型版本由 manifest 统一改写。

## 3. `content_group_writer` — H2 分组批量生成

触发时机：用户执行一键生成或按 H2 批量生成时调用。

**输入**

| 字段 | 类型 | 说明 |
|------|------|------|
| `group_id` | string | H2 分组 ID |
| `group_title` | string | H2 标题 |
| `expected_total_words` | integer | 本组目标总字数 |
| `project_summary` | string | 项目摘要 |
| `global_outline` | string | 当前 H2 邻域大纲 |
| `placeholder_hint` | string | 占位符保留说明 |
| `requires_search` | string | `"true"` / `"false"` |
| `group_analysis_context` | string | 本组共享解析依据 |
| `search_query` | string | 联网搜索关键词 |
| `children_json` | string | 子章节数组 JSON 字符串 |

**输出**

| 字段 | 类型 | 说明 |
|------|------|------|
| `sections` | string | JSON 数组字符串，每项含 `section_id`、`section_title`、`content` |
| `group_feedback` | string | 可选，组级反馈 |

## 4. `content_rewrite` — 单章节改写

触发时机：用户对单章节点击“重新生成”并填写改写要求后调用。

**输入**

| 字段 | 类型 | 说明 |
|------|------|------|
| `section_id` | string | 当前章节 ID |
| `section_title` | string | 当前章节标题 |
| `current_content` | string | 当前章节草稿 |
| `rewrite_instruction` | string | 本次改写要求 |
| `expected_words` | integer | 目标字数 |
| `project_summary` | string | 项目摘要 |
| `global_outline` | string | 当前章节邻域大纲 |
| `section_outline_slice` | string | 当前章节局部大纲 |
| `analysis_context` | string | 当前章节解析依据 |
| `placeholder_hint` | string | 占位符保留说明 |

**输出**

| 字段 | 类型 | 说明 |
|------|------|------|
| `text` | string | 改写后的章节正文 |
| `feedback` | string | 可选，内部调试信息 |
| `quality_score` | number | 可选，内部调试评分 |

## 5. `response_content_writer` — 响应类章节生成

触发时机：章节 `generation_strategy = response_special` 时调用。

**输入**

| 字段 | 类型 | 说明 |
|------|------|------|
| `section_title` | string | 当前章节标题 |
| `writing_hint` | string | 当前章节写作引导 |
| `expected_words` | integer | 目标字数 |
| `project_summary` | string | 项目摘要 |
| `global_outline` | string | 当前章节邻域大纲 |
| `placeholder_hint` | string | 占位符保留说明 |
| `keywords` | string | 当前章节关键词 |

**输出**

| 字段 | 类型 | 说明 |
|------|------|------|
| `text` | string | 响应类章节正文 |

## 6. `diagram_generator` — 图表示意生成

触发时机：需要生成结构图、流程图或 SVG 示意内容时调用。

**输入**

| 字段 | 类型 | 说明 |
|------|------|------|
| `section_title` | string | 当前图表所属章节 |
| `diagram_request` | string | 图表生成需求 |
| `project_summary` | string | 项目摘要 |

**输出**

| 字段 | 类型 | 说明 |
|------|------|------|
| `text` | string | 图表规划或 SVG 相关输出 |

说明：当前 DSL 中分为“规划布局”和“SVG 渲染”两个 LLM 节点，统一由 manifest 中的 `diagram-generator` profile 管理。

## 7. `doc_analysis` — 文档分析

触发时机：需要对文档内容做抽取、分析或结构化理解时调用。

**输入**

| 字段 | 类型 | 说明 |
|------|------|------|
| `document_text` | string | 待分析文档文本 |
| `analysis_instruction` | string | 分析要求 |

**输出**

| 字段 | 类型 | 说明 |
|------|------|------|
| `text` | string | 分析结果 |

说明：当前 DSL 内有两个 LLM 节点，分别用于单节点提取和通用提取。

## 校验与模型治理

- 当前工作流清单以 `dify/manifest.yml` 为准。
- 模型版本改写通过 `01-foundation-infra/superadmin/hack/dify/rewrite-models.sh` 执行。
- manifest 可声明 `expected_llm_nodes`，用于检测 DSL 内关键 LLM 节点是否被删改。
- 在改写前可先运行 `01-foundation-infra/superadmin/hack/dify/validate-manifests.sh --all` 做一致性校验。

## 历史链路说明

- `requirement_extractor`
- `blueprint_generator`
- `scoring_assistant`
- `attachment_generator`
- `group_review_writer`

以上链路可能仍在业务代码或旧文档中出现，但当前不属于清理后的 `dify/workflows/` 管理范围，也不会被当前 manifest/rewrite 流程自动维护。
