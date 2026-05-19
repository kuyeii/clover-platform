# gateway-in — ProEngine 入口网关

> 负责招标文件的解析、结构化信息提取、安全分流与脱敏调用

## 功能概述

1. **文件解析** — 支持 PDF/DOCX/HTML 格式招标文件的内容提取
2. **结构化提取** — 从招标文件中提取项目名称、技术要求、评分标准等关键信息
3. **安全分流** — 根据 Tier 1/Tier 2 等级分类，决定是否需要脱敏处理
4. **图片剥离** — Tier 2 文件中的图片强制剥离或替换为空白占位符
5. **脱敏调用** — 调用 pipt-flask (pipt-lite 分支) 进行敏感信息脱敏

## 安装

```bash
pip install -e .
```

## 使用

```bash
python -m src.main --input <招标文件路径> --tier 1
```
