#!/usr/bin/env bash
# =====================================================================
#  ServicePro — stand up a real PostgreSQL, apply every migration in order,
#  and PROVE the security properties hold.
#
#  Until this existed, every security assertion in the repository was static
#  analysis of SQL text. Reading a policy cannot prove that the policy refuses
#  a query. This script is the only thing in the project that does.
#
#  Usage:  DATABASE_URL=postgresql://user:pass@host:5432/db  bash db/ci/run.sh
#  Needs:  psql, connecting as a superuser. Nothing else — no ORM, no migration
#          tool, no node.
# =====================================================================
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL must be set (postgresql://...)}"

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
db="$(cd "$here/.." && pwd)"

# If the assertion files ever stop running — a typo, a bad glob, a file renamed
# away — the suite would go green while proving nothing. This floor is the
# guard. Raise it whenever assertions are added, TOGETHER WITH the identical
# floor in tests/rls-assertions.test.mjs, which runs these same files under
# `npm run verify` against PGlite.
MIN_ASSERTIONS=110

PSQL=(psql -X -q -v ON_ERROR_STOP=1
      -P pager=off -P footer=off -P tuples_only=on
      --dbname "$DATABASE_URL")

log="$(mktemp)"
trap 'rm -f "$log" "$log.step"' EXIT

# Run one SQL file. Server NOTICEs (which is how every assertion reports) go to
# stderr, so both streams are captured. ON_ERROR_STOP makes any SQL error a
# non-zero exit, and pipefail makes the pipeline inherit it.
run() {
  local file="$1"
  echo "--- $(basename "$file")"
  if ! psql -X -q -v ON_ERROR_STOP=1 -P pager=off -P footer=off -P tuples_only=on \
            --dbname "$DATABASE_URL" -f "$file" > "$log.step" 2>&1; then
    cat "$log.step"
    echo "::error::psql failed on $file"
    exit 1
  fi
  cat "$log.step"
  cat "$log.step" >> "$log"
}

echo "=== 0. Server ==="
"${PSQL[@]}" -c 'select version()'

echo ""
echo "=== 1. Supabase shim (roles, auth, storage, default grants, ci helpers) ==="
run "$here/00_supabase_shim.sql"

echo ""
echo "=== 2. Baseline schema ==="
run "$db/schema.sql"

echo ""
echo "=== 3. Every numbered migration, in order ==="
# db/MIGRATIONS.md is the authoritative sequence, and the numeric filename order
# matches it. 016 is NOT a migration — it is the isolation test, and it is run
# in step 4. GO-LIVE.sql is excluded by the glob because it only re-bundles
# 012-015, which are applied individually here.
for f in $(ls "$db"/[0-9][0-9][0-9]_*.sql | sort); do
  case "$(basename "$f")" in
    016_*) echo "--- $(basename "$f") (skipped here — it is a test, not a migration)"; continue ;;
  esac
  run "$f"
done

echo ""
echo "=== 4. db/016_isolation_tests.sql — the existing proof, finally executed ==="
if ! psql -X -q -v ON_ERROR_STOP=1 -P pager=off -P footer=off -P tuples_only=on \
          --dbname "$DATABASE_URL" -f "$db/016_isolation_tests.sql" > "$log.step" 2>&1; then
  cat "$log.step"
  echo "::error::016_isolation_tests.sql raised — cross-tenant isolation is BROKEN"
  exit 1
fi
cat "$log.step"
# A test that silently did nothing must not be mistaken for a test that passed.
if ! grep -q 'ALL ISOLATION TESTS PASSED' "$log.step"; then
  echo "::error::016_isolation_tests.sql did not report success — it may not have run"
  exit 1
fi

echo ""
echo "=== 5. Fixtures: two tenants, five identities ==="
run "$here/10_fixtures.sql"

echo ""
echo "=== 6. Adversarial assertions ==="
run "$here/20_privilege_assertions.sql"
run "$here/30_tenant_assertions.sql"
run "$here/40_document_assertions.sql"

passed="$(grep -c 'NOTICE:  ok' "$log" || true)"
echo ""
echo "====================================================================="
echo "  $passed assertions passed against a real PostgreSQL"
echo "====================================================================="

if [ "$passed" -lt "$MIN_ASSERTIONS" ]; then
  echo "::error::only $passed assertions ran, expected at least $MIN_ASSERTIONS — assertions were skipped"
  exit 1
fi
