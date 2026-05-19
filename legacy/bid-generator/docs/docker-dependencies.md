# ProEngine — Docker 打包依赖清单

> 本文档记录 ProEngine 各服务在 Docker 镜像中需要额外安装的**系统级依赖**和  
> **Python 包补充**，可直接参考写入各服务的 `Dockerfile` 或 `docker-compose.yml`。

---

## 一、`pipt-flask`（后端 API 服务）

### 1.1 系统包（`apt-get install`）

| 包名 | 用途 | 触发场景 |
|------|------|---------|
| `libreoffice` | DOCX / DOC → PDF 转换（无头模式）| 用户上传 DOCX 时生成 PDF 预览 |
| `libreoffice-l10n-zh-cn` | 中文字体支持，避免转换乱码 | 同上 |
| `fonts-noto-cjk` | CJK 字体，防转换后中文缺字 | 同上 |
| `poppler-utils` | `pdftotext` 等 PDF 工具链 | PDF 文本提取备用 |

**Dockerfile 片段示例：**
```dockerfile
RUN apt-get update && apt-get install -y --no-install-recommends \
    libreoffice \
    libreoffice-l10n-zh-cn \
    fonts-noto-cjk \
    poppler-utils \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*
```

> [!NOTE]
> `libreoffice` 镜像较大（约 400MB），建议评估是否拆分为独立 `converter` 服务，  
> 通过内部接口调用，避免主 API 镜像过重。

---

### 1.2 Python 包补充（添加到 `requirements-lite.txt`）

| 包名 | 用途 | 触发场景 |
|------|------|---------|
| `python-docx` | DOCX 读取 / 内容提取 | 需求提取、文档解析 |
| `pymupdf` (`fitz`) | PDF 文本 + 页面解析 | PDF 格式需求提取 |
| `pymupdf4llm` | PDF → Markdown（VLM 增强）| 视觉辅助解析（可选）|
| `olefile` | 旧版 `.doc`（OLE2）格式识别 | 上传旧版 Word 文件时 |
| `python-multipart` | FastAPI 文件上传支持 | `/projects/extract` 接口 |
| `httpx` | 异步 HTTP 客户端（Dify 调用）| Dify Workflow 对接 |
| `docx2pdf` ⚠️ | DOCX→PDF（需有 Word 或 LibreOffice）| 作为备选方案保留 |

**`requirements-lite.txt` 补充内容：**
```txt
# === 文档解析 ===
python-docx>=1.1.0
pymupdf>=1.24.0
pymupdf4llm>=0.0.5        # 可选：VLM 增强解析
olefile>=0.47             # 旧版 .doc 格式支持
python-multipart>=0.0.9   # FastAPI 文件上传

# === HTTP 客户端 ===
httpx>=0.27.0

# === DOCX→PDF 转换（Linux 上依赖 LibreOffice headless，无需额外安装）===
# docx2pdf 在 Linux 纯 CLI 环境可选，已集成 LibreOffice subprocess 方案
```

---

## 二、`gateway-out`（Docx 输出服务）

### 2.1 Python 包

| 包名 | 用途 |
|------|------|
| `python-docx>=1.1.0` | Markdown → DOCX 生成（`md_to_docx.py` 已用）|

> `gateway-out` 目前无额外系统级依赖，`python-docx` 已是主要依赖。

---

## 三、前端（`frontend-web`）

前端为纯静态 React 应用，运行时无额外系统依赖。  
在 Docker 内构建时仅需 `node:20-alpine` 即可。

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
```

---

## 四、推荐 docker-compose 服务拆分

```yaml
services:
  pipt-api:           # 主 API（含 NER、脱敏、Dify 对接）
  converter:          # 独立 LibreOffice 转换服务（可选，避免主 API 镜像臃肿）
  gateway-out:        # Docx 输出生成服务
  frontend:           # React 前端静态页（Nginx）
  redis:              # 队列/缓存（已在用）
```

---

## 五、版本锁定建议

| 工具 | 推荐版本 |
|------|---------|
| Python | `3.11-slim` |
| Node | `20-alpine` |
| LibreOffice | 系统包管理器最新稳定版 |
| Ubuntu base | `ubuntu:22.04` 或 `debian:bookworm-slim` |

> [!TIP]
> 生产环境建议基于 `python:3.11-slim`（而非 `python:3.9`）以获得更好的性能和更长的安全支持期。

---

*最后更新：2026-03-13*
