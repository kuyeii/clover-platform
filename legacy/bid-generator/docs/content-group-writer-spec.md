# `content_group_writer` 工作流约定

用于按单个 H2 一次生成其下多个 H3 子章节，目标是减少重复上下文注入、降低 Dify 调用次数，并提升同章内部连贯性。

## 输入变量

- `group_id`: H2 分组 ID
- `group_title`: H2 标题
- `expected_total_words`: 本组目标总字数
- `project_summary`: 蓝图摘要
- `global_outline`: 当前 H2 邻域大纲
- `placeholder_hint`: 占位符保留约束
- `requires_search`: `"true"` / `"false"`
- `group_analysis_context`: 本组共享解析依据
- `search_query`: 联网搜索关键词，建议由后端拼接 `group_title + H3 标题 + keywords`
- `children_json`: JSON 数组字符串，成员字段如下

```json
[
  {
    "section_id": "h3_xxx",
    "section_title": "子章节标题",
    "keywords": "关键词1,关键词2",
    "expected_words": 800,
    "writing_hint": "已合并目录定位、解析摘要、扩写约束后的提示"
  }
]
```

## 输出要求

最终输出必须能被后端解析为 `sections` 数组。推荐直接输出单个 JSON 对象，不要包裹 Markdown 解释文字。

```json
{
  "sections": [
    {
      "section_id": "h3_xxx",
      "section_title": "子章节标题",
      "content": "该子章节正文 Markdown",
      "quality_score": 8,
      "feedback": ""
    }
  ]
}
```

## 提示词约束

- 只允许输出当前 H2 下传入的子章节，不得新增、合并、删减章节。
- `section_id` 必须原样回传，不能改写。
- `content` 内禁止输出 `# / ## / ###` 标题行。
- 不得重复输出 H2 标题或目录编号。
- 仅允许在 `content` 中写正文，禁止在 JSON 外补充解释文本。
- 若依据不足，写实现机制和控制措施，不得编造型号、参数、标准编号。
- `{{__PIPT_*__}}` 与 `{{__BIDDER_*__}}` 占位符必须原样保留。
- 严禁将占位符简写为 `{{PIPT_1}}`、`{{BIDDER_ORG}}` 或任何非双下划线包裹格式。
- 主生成节点后必须经过占位符扫描：仅当检测到畸形 PIPT/BIDDER token 时，才进入快速修复节点。
- 快速修复节点只允许输出 `from -> to` 替换清单，不得重写正文；无法确定原实体的 token 必须保留给后端判失败。

## 后端收敛策略

- 工作流未配置时，请直接报错，不再静默退回单章节生成。
- JSON 无法解析、返回数量不匹配、缺少 `section_id`、正文为空时，后端按“部分成功”收敛：
  - 可解析的章节照常保留并返回。
  - 缺失或无效章节进入 `failed_sections`。
  - 不自动退回组内逐章生成。
- 若快速修复后仍存在无法还原的畸形占位符，该子章节进入 `failed_sections`，禁止静默删除占位符。
