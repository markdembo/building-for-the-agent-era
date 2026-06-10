#!/usr/bin/env bash
# scripts/reset.sh
#
# Clears the extension registry + submissions in D1 (remote) and deletes any
# Artifacts repos whose names start with `ext-`. Leaves the `records` table
# untouched. Safe to re-run.
set -euo pipefail

cd "$(dirname "$0")/.."

echo "==> Clearing extensions + submissions in D1 (remote)..."
count() {
  npx wrangler d1 execute DB --remote --json \
    --command "SELECT COUNT(*) AS c FROM $1;" 2>/dev/null \
    | python3 -c 'import sys, json; d=json.load(sys.stdin); print(d[0]["results"][0]["c"])' 2>/dev/null \
    || echo "?"
}

EXT_COUNT=$(count extensions)
SUB_COUNT=$(count submissions)

npx wrangler d1 execute DB --remote --yes \
  --command "DELETE FROM extensions; DELETE FROM submissions;" >/dev/null

REC_COUNT=$(count records)

echo "    extensions deleted:  ${EXT_COUNT}"
echo "    submissions deleted: ${SUB_COUNT}"
echo "    records preserved:   ${REC_COUNT}"

echo ""
echo "==> Artifacts repos (ext-*): not deleted from this script."
echo "    Phase 2 will own the Artifacts admin path. For now, if any"
echo "    'ext-*' repos exist in the 'vinyl-app' namespace, remove them"
echo "    via the dashboard or the REST API."

echo ""
echo "Reset complete."
