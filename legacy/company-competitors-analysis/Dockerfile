FROM m.daocloud.io/docker.io/library/node:20-slim AS frontend

WORKDIR /app

COPY package*.json ./

RUN npm ci

COPY index.html ./
COPY vite.config.js ./
COPY public ./public
COPY src ./src

RUN npm run build


FROM m.daocloud.io/docker.io/library/python:3.12-slim AS runtime

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    BACKEND_HOST=0.0.0.0 \
    BACKEND_PORT=8788 \
    CORS_ORIGIN=http://localhost:8788 \
    STATIC_DIR=/app/dist

COPY backend ./backend
COPY --from=frontend /app/dist ./dist

# Docker unified deployment will be handled in a later phase.

EXPOSE 8788

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import os, urllib.request; port=os.environ.get('BACKEND_PORT', '8788'); urllib.request.urlopen(f'http://127.0.0.1:{port}/api/health', timeout=3).read()"

CMD ["python", "backend/server.py"]
