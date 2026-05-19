FROM node:20-alpine AS builder

WORKDIR /app

COPY frontend-web/package*.json ./
RUN npm ci

COPY frontend-web /app

ARG VITE_API_URL=/api
ENV VITE_API_URL=${VITE_API_URL}

RUN npm run build

FROM nginx:1.27-alpine

COPY deploy/server/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80
