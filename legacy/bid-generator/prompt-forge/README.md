# prompt-forge — ProEngine 提示词工程

> 根据结构化招标信息自动生成高质量系统提示词

## 功能

1. **模板化提示词** — 基于 Jinja2 模板，按技术方案、评分导向等维度组装提示词
2. **动态优化** — Token 预估、冗余去除、上下文窗口适配
3. **规则审查** — 检查事实锚定、商务越界、章节标题污染和输出格式风险
4. **可扩展模板库** — 支持自定义模板，按项目类型选择最佳提示策略

## 安装

```bash
pip install -e .
```

## 提示词审查

```python
from src import PromptAuditor

issues = PromptAuditor().audit(prompt_text, stage="outline")
for issue in issues:
    print(issue.severity, issue.code, issue.message)
```

说明：本模块只做项目内规则审查，不内嵌外部 AGPL 项目的代码。
