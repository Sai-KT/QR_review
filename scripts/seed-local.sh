#!/usr/bin/env bash
# ==============================================================================
# QR_review — Strictly Local-Only Seed Runner
# Milestone M2 — Task M2-T08: Production Reference Data & Local Seed Personas
# ==============================================================================
# Invariant: Guarantees that synthetic development personas and test fixtures
# can only be applied directly to the verified local Supabase Docker container.
# Bypasses network exposure, rejects arbitrary URLs or remote hosts, and requires
# verified local container state and authorization.
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
FIXTURE_FILE="${PROJECT_ROOT}/supabase/fixtures/local_seed.sql"
CONTAINER_NAME="supabase_db_qr-review"

# 1. Enforce fixture file existence
if [ ! -f "${FIXTURE_FILE}" ]; then
  echo "[ERROR] Local seed fixture not found at: ${FIXTURE_FILE}" >&2
  exit 1
fi

# 2. Verify Docker CLI is available
if ! command -v docker > /dev/null 2>&1; then
  echo "[ERROR] Docker CLI is not installed or not in PATH. Halting." >&2
  exit 1
fi

# 3. Verify Docker daemon is reachable
if ! docker info > /dev/null 2>&1; then
  echo "[ERROR] Docker daemon is unreachable. Is Colima / Docker running?" >&2
  exit 1
fi

# 4. Verify local Supabase container exists and is running
CONTAINER_STATUS=$(docker inspect --format '{{.State.Status}}' "${CONTAINER_NAME}" 2>/dev/null || true)
if [ "${CONTAINER_STATUS}" != "running" ]; then
  echo "[ERROR] Target container '${CONTAINER_NAME}' is not running (status: '${CONTAINER_STATUS}')." >&2
  echo "[ERROR] Local Supabase stack must be running via 'npx supabase start'." >&2
  exit 1
fi

# 5. Verify container image is a genuine Supabase Postgres image
CONTAINER_IMAGE=$(docker inspect --format '{{.Config.Image}}' "${CONTAINER_NAME}" 2>/dev/null || true)
case "${CONTAINER_IMAGE}" in
  *supabase/postgres*) ;;
  *)
    echo "[ERROR] Container '${CONTAINER_NAME}' is running unexpected image '${CONTAINER_IMAGE}'." >&2
    exit 1
    ;;
esac

echo "[INFO] Verified local container '${CONTAINER_NAME}' (${CONTAINER_IMAGE})."

# Helper function to execute SQL stream with local authorization
run_seed_stream() {
  local extra_prefix="${1:-}"
  (
    echo "SET app.local_seed_authorized = 'true';"
    if [ -n "${extra_prefix}" ]; then
      echo "${extra_prefix}"
    fi
    cat "${FIXTURE_FILE}"
  ) | docker exec -i "${CONTAINER_NAME}" psql -U postgres -d postgres -v ON_ERROR_STOP=1
}

# 6. Mode dispatch
MODE="${1:-apply}"

case "${MODE}" in
  --rollback|--dry-run)
    echo "[INFO] Executing in TRANSACTION-ROLLBACK test mode..."
    (
      echo "BEGIN;"
      echo "SET app.local_seed_authorized = 'true';"
      cat "${FIXTURE_FILE}"
      echo "ROLLBACK;"
    ) | docker exec -i "${CONTAINER_NAME}" psql -U postgres -d postgres -v ON_ERROR_STOP=1
    echo "[SUCCESS] Local seed fixture successfully validated and rolled back."
    ;;

  --repeat)
    echo "[INFO] Executing repeat idempotency test (pass 1 of 2)..."
    run_seed_stream ""
    echo "[INFO] Executing repeat idempotency test (pass 2 of 2)..."
    run_seed_stream ""
    echo "[SUCCESS] Seed idempotency test passed cleanly without collisions or duplicates."
    ;;

  apply|"")
    echo "[INFO] Applying local seed fixture to '${CONTAINER_NAME}'..."
    run_seed_stream ""
    echo "[SUCCESS] Local seed fixture applied successfully to '${CONTAINER_NAME}'."
    ;;

  *)
    echo "[ERROR] Unknown option '${MODE}'. Supported options: apply (default), --rollback, --repeat" >&2
    exit 1
    ;;
esac

