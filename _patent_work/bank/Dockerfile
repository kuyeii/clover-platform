# syntax=docker/dockerfile:1

############################
# 1) Build frontend
############################
FROM node:20-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

############################
# 2) Build backend (embed dist)
############################
FROM golang:1.22-alpine AS backend-build
WORKDIR /app

# Enable CA certs for module download
RUN apk add --no-cache ca-certificates git

# Copy go mod first for caching
COPY backend/go.mod backend/go.sum ./backend/
WORKDIR /app/backend
RUN go mod download

# Copy backend source
COPY backend/ ./

# Copy frontend build output into backend/dist for embed
COPY --from=frontend-build /app/frontend/dist ./dist

# Build
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags="-s -w" -o /app/app .

############################
# 3) Runtime
############################
FROM gcr.io/distroless/static-debian12:nonroot
WORKDIR /
ENV PORT=8080
ENV DATA_DIR=/data
EXPOSE 8080

COPY --from=backend-build /app/app /app

# The platform will mount:
# - secrets at /secret
# - data volume at /data (or other path configured via DATA_DIR)
ENTRYPOINT ["/app"]
