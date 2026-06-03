# gateway-out — ProEngine 出口网关

> 占位符复原 + Markdown 转标准排版 Word 文档

## 功能

1. **占位符复原** — 基于映射表将脱敏占位符还原为原始敏感信息
2. **Markdown → DOCX** — 将 LLM 生成的 Markdown 转换为标准排版的 Word 文档
3. **样式管理** — 预设标书排版样式（标题层级、正文字体、表格格式等）
4. **图表嵌入** — 支持 `<diagram>` SVG artifact 与 fenced `mermaid` 图表在导出前转 PNG

## 安装

```bash
pip install -e .
```

Mermaid 图表渲染依赖 Node CLI `mmdc`。生产环境应预装 `@mermaid-js/mermaid-cli`
并把 `mmdc` 暴露到 `PATH`；未安装时导出不会失败，Mermaid 源码会保留在 Word 中用于排查。
