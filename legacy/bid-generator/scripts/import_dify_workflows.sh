#!/bin/bash
# ============================================================
# import-dify-workflows.sh - import DSL workflows into Dify
#                            and write API keys back to .env
# usage: bash scripts/import-dify-workflows.sh
# ============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

DIFY_BASE_URL="http://localhost"
ADMIN_EMAIL="admin@example.com"
ADMIN_PASSWORD="changeme123"
WORKFLOWS_DIR="${PROJECT_ROOT}/dify/workflows"
ENV_FILE="${PROJECT_ROOT}/.env"
DRY_RUN="${DRY_RUN:-false}"   # 外部可用 DRY_RUN=true bash ... 覆盖

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1; }

# ── 0. preflight ─────────────────────────────────────────────
command -v curl    &>/dev/null || error "curl is not installed"
command -v python3 &>/dev/null || error "python3 is not installed"
[ -d "${WORKFLOWS_DIR}" ]     || error "workflows dir not found: ${WORKFLOWS_DIR}"
[ -f "${ENV_FILE}" ]          || error ".env not found: ${ENV_FILE}"

# ── dry-run shortcut ─────────────────────────────────────────
if [ "${DRY_RUN}" = "true" ]; then
    info "[DRY-RUN] Skipping network calls. Workflow → env_key mapping:"
    shopt -s nullglob
    for f in "${WORKFLOWS_DIR}"/ProEngine_*.yml; do
        name="$(basename "${f}" .yml)"; name="${name#ProEngine_}"
        if [ "${name}" = "Structure_Generate" ]; then
            info "  $(basename "${f}") → DIFY_WORKFLOW_STRUCTURE_GENERATOR"
            continue
        fi
        key="DIFY_WORKFLOW_$(python3 -c "
import re,sys
parts=re.split(r'_+',sys.argv[1])
words=[]
for p in parts:
    words+=[w for w in re.sub(r'([A-Z][a-z]+)',r'_\1',p).split('_') if w]
print('_'.join(w.upper() for w in words))
" "${name}")"
        info "  $(basename "${f}") → ${key}"
    done
    info "[DRY-RUN] Done. No changes made."
    exit 0
fi

# ── 1. wait for dify ─────────────────────────────────────────
info "Waiting for Dify to be ready ..."
READY=false
for i in $(seq 1 60); do
    CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "${DIFY_BASE_URL}/health" 2>/dev/null || echo "000")
    [ "${CODE}" = "200" ] && READY=true && break
    info "  attempt ${i}/60 — HTTP ${CODE}"
    sleep 5
done
[ "${READY}" = "true" ] || error "Dify did not become ready within 5 minutes"
info "Dify is ready"

# ── 2. setup admin (idempotent) ──────────────────────────────
info "Setting up admin account ..."
SETUP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 30 \
    -X POST "${DIFY_BASE_URL}/console/api/setup" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"${ADMIN_EMAIL}\",\"name\":\"Admin\",\"password\":\"${ADMIN_PASSWORD}\"}" \
    2>/dev/null || echo "000")
# 400 = already initialized, which is fine
[ "${SETUP_CODE}" = "400" ] && info "Admin already exists, skipping setup"
[ "${SETUP_CODE}" = "200" ] || [ "${SETUP_CODE}" = "201" ] || [ "${SETUP_CODE}" = "400" ] \
    || warn "Unexpected setup response: HTTP ${SETUP_CODE}"

# ── 3. login ─────────────────────────────────────────────────
info "Logging in ..."
LOGIN_RESP=$(curl -s --max-time 30 \
    -X POST "${DIFY_BASE_URL}/console/api/login" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"${ADMIN_EMAIL}\",\"password\":\"${ADMIN_PASSWORD}\"}")
ACCESS_TOKEN=$(echo "${LOGIN_RESP}" | python3 -c \
    "import sys,json; print(json.load(sys.stdin).get('data',{}).get('access_token',''))" 2>/dev/null || true)
[ -z "${ACCESS_TOKEN}" ] && error "Login failed. Response: ${LOGIN_RESP}"
info "Login successful"

# ── 4. import workflows ──────────────────────────────────────
info "Importing workflows from ${WORKFLOWS_DIR} ..."

# ProEngine_DocAnalysis.yml → DIFY_WORKFLOW_DOC_ANALYSIS
yml_to_env_key() {
    local name
    name="$(basename "$1" .yml)"
    name="${name#ProEngine_}"
    if [ "${name}" = "Structure_Generate" ]; then
        echo "DIFY_WORKFLOW_STRUCTURE_GENERATOR"
        return
    fi
    echo "DIFY_WORKFLOW_$(python3 -c "
import re, sys
parts = re.split(r'_+', sys.argv[1])
words = []
for p in parts:
    words += [w for w in re.sub(r'([A-Z][a-z]+)', r'_\1', p).split('_') if w]
print('_'.join(w.upper() for w in words))
" "${name}")"
}

shopt -s nullglob
YML_FILES=("${WORKFLOWS_DIR}"/ProEngine_*.yml)
[ ${#YML_FILES[@]} -eq 0 ] && error "No ProEngine_*.yml files found in ${WORKFLOWS_DIR}"

RESULTS=()
for YAML_FILE in "${YML_FILES[@]}"; do
    NAME="$(basename "${YAML_FILE}" .yml)"
    KEY="$(yml_to_env_key "${YAML_FILE}")"
    info "  importing ${NAME} ..."

    YAML_JSON=$(python3 -c "import json,sys; print(json.dumps(open(sys.argv[1]).read()))" "${YAML_FILE}" 2>/dev/null)
    [ -z "${YAML_JSON}" ] && warn "  failed to read ${YAML_FILE}, skipping" && continue

    IMPORT_RESP=$(curl -s --max-time 60 \
        -X POST "${DIFY_BASE_URL}/console/api/apps/import" \
        -H "Authorization: Bearer ${ACCESS_TOKEN}" \
        -H "Content-Type: application/json" \
        -d "{\"data\": ${YAML_JSON}}")
    APP_ID=$(echo "${IMPORT_RESP}" | python3 -c \
        "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null || true)
    [ -z "${APP_ID}" ] && warn "  import failed: $(echo "${IMPORT_RESP}" | head -c 200)" && continue
    info "  app_id=${APP_ID}"

    KEY_RESP=$(curl -s --max-time 30 \
        -X POST "${DIFY_BASE_URL}/console/api/apps/${APP_ID}/api-keys" \
        -H "Authorization: Bearer ${ACCESS_TOKEN}")
    API_KEY=$(echo "${KEY_RESP}" | python3 -c \
        "import sys,json; print(json.load(sys.stdin).get('key',''))" 2>/dev/null || true)
    [ -z "${API_KEY}" ] && warn "  keygen failed: $(echo "${KEY_RESP}" | head -c 200)" && continue

    RESULTS+=("${KEY}=${API_KEY}")
    info "  ${KEY}=${API_KEY}"
done

[ ${#RESULTS[@]} -eq 0 ] && error "No workflows were successfully imported"

# ── 5. write keys to .env ────────────────────────────────────
info "Writing API keys to ${ENV_FILE} ..."
for KV in "${RESULTS[@]}"; do
    K="${KV%%=*}"
    V="${KV#*=}"
    if grep -q "^${K}=" "${ENV_FILE}"; then
        sed -i "s|^${K}=.*|${K}=${V}|" "${ENV_FILE}"
        info "  updated : ${K}"
    else
        echo "${K}=${V}" >> "${ENV_FILE}"
        info "  appended: ${K}"
    fi
done

info "=============================================="
info " Workflow import complete"
info " Imported : ${#RESULTS[@]} / ${#YML_FILES[@]} workflows"
info " Keys written to: ${ENV_FILE}"
info "=============================================="
