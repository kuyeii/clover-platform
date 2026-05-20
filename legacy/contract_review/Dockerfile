FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PYTHONPATH=/app:/app/legacy/contract_review \
    RUN_ROOT=/app/data/runs

WORKDIR /app/legacy/contract_review

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      curl \
      fontconfig \
      fonts-noto-cjk \
      libreoffice \
      libreoffice-writer \
    && rm -rf /var/lib/apt/lists/*

COPY requirements-dev.txt /app/requirements-dev.txt
COPY legacy/contract_review/requirements.txt ./requirements.txt
RUN python -m pip install --upgrade pip \
    && python -m pip install -r /app/requirements-dev.txt \
    && python -m pip install -r requirements.txt

COPY packages /app/packages
COPY config /app/config
COPY legacy/contract_review /app/legacy/contract_review
RUN mkdir -p /app/data/runs /app/data/uploads /app/data/web_meta

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8000/api/health || exit 1

CMD ["uvicorn", "web_api:app", "--host", "0.0.0.0", "--port", "8000"]
