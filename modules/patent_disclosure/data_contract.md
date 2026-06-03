# Data Contract

数据库 schema：`patent_disclosure`

## cases

状态：

```text
draft
ready
running
succeeded
failed
archived
```

核心字段：`id`、`owner_user_id`、`title`、`technical_topic`、`applicant`、`project_name`、`description`、`status`、`anonymize`、`metadata`、`created_at`、`updated_at`。

## materials

材料类型：

```text
source
reference
existing
```

解析状态：

```text
pending
parsed
failed
skipped
```

## jobs

任务状态：

```text
pending
running
succeeded
failed
```

任务步骤：

```text
pending
material_parse
project_scan
patent_points
cnipa_prior_art
build_disclosure
self_check
export_docx
succeeded
failed
```

## artifacts

产物类型：

```text
patent_points
cnipa_prior_art_notes
disclosure_md
disclosure_docx
self_check
```

