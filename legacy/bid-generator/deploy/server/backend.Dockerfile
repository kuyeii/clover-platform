FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_ROOT_USER_ACTION=ignore \
    PIP_DEFAULT_TIMEOUT=120 \
    PIP_RETRIES=10

WORKDIR /app

RUN sed -i 's/deb.debian.org/mirrors.tuna.tsinghua.edu.cn/g' /etc/apt/sources.list.d/debian.sources && \
    sed -i 's|security.debian.org/debian-security|mirrors.tuna.tsinghua.edu.cn/debian-security|g' /etc/apt/sources.list.d/debian.sources || true && \
    apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    fontconfig \
    libgl1 \
    libglib2.0-0 \
    libmagic1 \
    libreoffice-writer \
    fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/*

COPY pipt-flask/requirements-lite.txt /tmp/requirements-lite.txt

RUN python -m pip install --upgrade pip setuptools wheel -i https://pypi.tuna.tsinghua.edu.cn/simple && \
    pip install --index-url https://download.pytorch.org/whl/cpu --extra-index-url https://pypi.tuna.tsinghua.edu.cn/simple torch==2.1.2 && \
    pip install -r /tmp/requirements-lite.txt -i https://pypi.tuna.tsinghua.edu.cn/simple && \
    pip install \
      cryptography \
      httpx \
      Jinja2 \
      markdown \
      pdfplumber \
      pymupdf \
      pymupdf4llm \
      python-dotenv \
      python-multipart \
      requests \
      SQLAlchemy \
      -i https://pypi.tuna.tsinghua.edu.cn/simple && \
    pip install "setuptools>=68,<81" -i https://pypi.tuna.tsinghua.edu.cn/simple && \
    python -c "import pkg_resources; import hanlp, numpy, torch, transformers; assert numpy.__version__.startswith('1.26.'), numpy.__version__; assert torch.__version__.startswith('2.1.2'), torch.__version__; assert transformers.__version__ == '4.34.1', transformers.__version__; print('deps-ok', hanlp.__version__, numpy.__version__, torch.__version__, transformers.__version__)" && \
    libreoffice --version >/dev/null

COPY gateway-out /app/gateway-out
RUN pip install -e /app/gateway-out

COPY pipt-flask /app/pipt-flask
COPY dify-bridge /app/dify-bridge
COPY config.yaml /app/config.yaml

RUN test -f /app/pipt-flask/app/extension/celery_task/pipt_task/assets/ner_model/model.pt && \
    test -f /app/pipt-flask/app/extension/celery_task/pipt_task/assets/tok_model/model.pt

WORKDIR /app/pipt-flask

ENV PYTHONPATH=/app/pipt-flask:/app/gateway-out:/app/dify-bridge \
    PIPT_DB_PATH=/data/pipt_mappings.db \
    PIPT_ENV=production

EXPOSE 5000

CMD ["uvicorn", "main_lite:app", "--host", "0.0.0.0", "--port", "5000"]