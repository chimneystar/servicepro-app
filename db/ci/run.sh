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
#  Needs:  psql, connecting as a superuser, and node (the migrations are applied
#          by the repository's own runner, `scripts/db-migrate.mjs`, so that this
#          job proves the runner too and not merely the SQL). No ORM, no
#          migration tool, no dependencies to install — the runner shells out to
#          psql and imports nothing outside node's standard library.
# =====================================================================
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL must be set (postgresql://...)}"

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
db="$(cd "$here/.." && pwd)"
root="$(cd "$db/.." && pwd)"

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
echo "=== 2. Every migration, applied BY THE RUNNER ==="
# Not a glob, and not this script's own idea of the order.
#
# It used to be decided in three places — a `[0-9][0-9][0-9]_*.sql` glob here,
# tests/helpers/pg.mjs, and db/MIGRATIONS.md by hand. Duplicated rules are how
# `016` ends up applied as a migration in one place and skipped in another, and
# how the runbook came to stop at 017. There is now one definition
# (db/migrations.manifest.json + lib/core/migrations.mjs) and everything asks it.
#
# Using `db:migrate` rather than reproducing its file list is deliberate: it
# makes this job the end-to-end proof of the runner itself against a real
# PostgreSQL — the ledger table is created, every migration is recorded, and the
# guards run — instead of proving only that the SQL applies.
#
# The baseline is `001_schema.sql` and sorts FIRST. It used to be `schema.sql`,
# which had to be applied first but sorted last.
node "$root/scripts/db-migrate.mjs" plan

if ! node "$root/scripts/db-migrate.mjs" up; then
  echo "::error::the migration runner refused, or a migration failed — see above"
  exit 1
fi

# The ledger must now agree with the tree. A runner that applied everything and
# then disagreed with itself would be worse than none.
if ! node "$root/scripts/db-migrate.mjs" status; then
  echo "::error::migrations applied but the ledger does not reconcile with db/"
  exit 1
fi

# And re-running must be a no-op. If `up` were not idempotent, every deploy
# would re-apply forty migrations.
if ! node "$root/scripts/db-migrate.mjs" up; then
  echo '::error::a second "up" on an up-to-date database failed — the runner is not idempotent'
  exit 1
fi

echo ""
echo "=== 3. db/016_isolation_tests.sql — the existing proof, finally executed ==="
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
echo "=== 4. Fixtures: two tenants, five identities ==="
run "$here/10_fixtures.sql"

echo ""
echo "=== 5. Adversarial assertions ==="
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
