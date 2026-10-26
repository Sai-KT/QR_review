#!/usr/bin/env bash
# ==============================================================================
# QR_review — Local Development Environment Orchestrator
# Milestone M1 — Task M1-T07: Supabase CLI Local Emulation & Mock Gemini Setup
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
PID_FILE="${PROJECT_ROOT}/.cache/mock-gemini.pid"
MOCK_PORT="${GEMINI_MOCK_PORT:-54329}"
MOCK_HOST="${GEMINI_MOCK_HOST:-127.0.0.1}"

# Ensure .cache directory exists
mkdir -p "${PROJECT_ROOT}/.cache"

# Helper: stop mock server if running
stop_mock_server() {
  if [ -f "${PID_FILE}" ]; then
    PID=$(cat "${PID_FILE}")
    if ps -p "${PID}" > /dev/null 2>&1; then
      echo "[start-local-dev] Stopping mock Gemini AI server (PID: ${PID})..."
      kill "${PID}" > /dev/null 2>&1 || true
      wait "${PID}" 2>/dev/null || true
    fi
    rm -f "${PID_FILE}"
  fi
}

# Handle --stop argument
if [ "${1:-}" = "--stop" ]; then
  stop_mock_server
  echo "[start-local-dev] All local dev background services stopped."
  exit 0
fi

# Cleanup on exit
cleanup() {
  echo ""
  echo "[start-local-dev] Shutting down development services..."
  stop_mock_server
  echo "[start-local-dev] Clean shutdown complete."
}
trap cleanup SIGINT SIGTERM EXIT

echo "================================================================================"
echo "   QR_review SaaS Platform — Local Development Environment (Milestone M1)"
echo "================================================================================"

# 1. Check Node.js prerequisite
if ! command -v node > /dev/null 2>&1; then
  echo "[ERROR] Node.js is required but was not found in PATH." >&2
  exit 1
fi

NODE_VERSION=$(node --version)
echo "[INFO] Node.js runtime: ${NODE_VERSION}"

# 2. Start Local Mock Gemini AI Server
stop_mock_server

echo "[INFO] Starting Mock Gemini AI server on http://${MOCK_HOST}:${MOCK_PORT}/v1beta..."
node --experimental-strip-types "${PROJECT_ROOT}/supabase/functions/mock-gemini.ts" > "${PROJECT_ROOT}/.cache/mock-gemini.log" 2>&1 &
MOCK_PID=$!
echo "${MOCK_PID}" > "${PID_FILE}"

# Wait up to 3s for mock server to be ready
MOCK_READY=false
for i in {1..30}; do
  if curl -s "http://${MOCK_HOST}:${MOCK_PORT}/v1beta/health" > /dev/null 2>&1; then
    MOCK_READY=true
    break
  fi
  sleep 0.1
done

if [ "${MOCK_READY}" = "true" ]; then
  echo "[SUCCESS] Mock Gemini AI server is active on http://${MOCK_HOST}:${MOCK_PORT}/v1beta (PID: ${MOCK_PID})"
else
  echo "[WARN] Mock Gemini AI server did not report healthy within 3s. Check .cache/mock-gemini.log"
fi

# If --mock-only is passed, wait on mock server and exit
if [ "${1:-}" = "--mock-only" ]; then
  echo "[INFO] Running in mock-only mode. Press Ctrl+C to stop."
  wait "${MOCK_PID}"
  exit 0
fi

# 3. Check Docker and Supabase CLI
if command -v docker > /dev/null 2>&1 && docker info > /dev/null 2>&1 && command -v supabase > /dev/null 2>&1; then
  echo "[INFO] Docker runtime and Supabase CLI detected."
  echo "[INFO] Starting local Supabase container stack..."
  supabase start || echo "[WARN] supabase start returned non-zero. Continuing in mock mode."
else
  echo "[INFO] Docker runtime or Supabase CLI not available on this host."
  echo "[INFO] Supabase local container launch skipped. Operating in Frontend + Mock AI mode."
fi

# 4. Launch Vite Frontend Development Server
echo "[INFO] Launching Vite frontend development server on http://127.0.0.1:5173..."
echo "--------------------------------------------------------------------------------"
echo "  • Frontend Gateway : http://127.0.0.1:5173"
echo "  • Mock Gemini AI   : http://${MOCK_HOST}:${MOCK_PORT}/v1beta"
echo "  • Studio (if up)   : http://127.0.0.1:54323"
echo "--------------------------------------------------------------------------------"
echo "Press Ctrl+C to terminate all services."

npm run dev -- --host 127.0.0.1 --port 5173
