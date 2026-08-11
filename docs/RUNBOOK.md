# ServicePro — Operations runbook

**Audience:** whoever is on the hook when something breaks. Written to be usable
by someone who did not build this and has no memory of it.

> Before this existed there was **no** written backup, restore or rollback
> procedure anywhere in the project, and no error monitoring — a production
> failure was invisible until a customer complained. If you are reading this
> during an incident, start at "Something is broken".

---

## 1. Something is broken — first five minutes

1. **Check the app is alive.**
   `curl -s https://<your-domain>/api/health`
   - `{"status":"ok",...}` — the app and database are both reachable.
   - `{"status":"degraded"}` — the database is unreachable or the service-role
     key is wrong. Go to §4.
   - No response / 500 — the deployment itself is down. Go to §5.

2. **Check the nightly automation actually ran.** It is the most likely thing to
   have failed silently:
   ```sql
   select kind, max(sent_on) as last_sent from public.reminder_log group by kind;
   select mode, status, started_at from public.retention_runs order by started_at desc limit 5;
   ```
   If the newest date is more than ~2 days old, the cron is not running. Go to §6.

3. **Look for server errors.** Every uncaught server error is logged as a single
   JSON line by `instrumentation.ts` (`"event":"server_error"`). In Vercel:
   Deployment → Runtime Logs, filter on `server_error`.

---

## 2. Backups

**Supabase takes automatic daily backups on paid plans. On the free tier it does
not.** Confirm which plan this project is on *before* you need a backup —
discovering it during an incident is too late.

- Dashboard → Database → Backups shows retention and the latest snapshot.
- Point-in-time recovery is a paid add-on and is **off** unless someone enabled it.

### Take a manual backup right now

```bash
# Connection string: Supabase → Project Settings → Database → Connection string (URI)
pg_dump "$DATABASE_URL" --no-owner --no-privileges --format=custom \
  --file="servicepro-$(date +%Y%m%d-%H%M).dump"
```

Do this **before** applying any migration to production, and before any bulk
data operation (imports, retention enforcement, the archive tools).

Store it somewhere that is not the same account as the database.

### Restore

```bash
pg_restore --no-owner --no-privileges --clean --if-exists \
  --dbname "$DATABASE_URL" servicepro-YYYYMMDD-HHMM.dump
```

Restore into a **new project first** and verify it before overwriting anything
live. A restore that silently half-succeeded is worse than the outage.

---

## 3. Rolling back a deployment

The application and the database roll back **separately**, and the database is
the one that can hurt you.

**Application:** Vercel → Deployments → the last known-good one → *Promote to
Production*. This is safe and near-instant; the app is stateless.

**Database:** there are no down-migrations. Every migration in `db/` is additive —
none drops a table or column — so promoting an older app build over a newer
schema is normally fine: the extra columns are simply unused.

The exception is a migration that **changed behaviour**, which the old build may
depend on. Those are `create or replace function`, so reverting means re-running
the previous definition. See `db/MIGRATIONS.md` → "Rolling back".

**Do not revert `023_authorization_hardening.sql`.** It closes two paths that let
any staff member make themselves owner. If it appears to be causing a permissions
complaint, fix the policy — do not remove the guard.

---

## 4. Database unreachable

1. Supabase status page — is it them or us?
2. Project Settings → Database — is the project **paused**? Free-tier projects
   pause after inactivity and must be resumed manually.
3. Has `SUPABASE_SERVICE_ROLE_KEY` been rotated without updating the deployment?
   `/api/health` returns `degraded` for exactly this.
4. Connection limits: Supabase → Database → Connection pooling. A burst of
   serverless functions can exhaust direct connections; the pooled connection
   string exists for this.

---

## 5. Deployment is down

1. Vercel → Deployments — did the most recent build fail?
2. **The app now refuses to start when required environment variables are missing
   or malformed** (`lib/env.ts`, called from `instrumentation.ts`). This is
   deliberate: the alternative was booting successfully and failing later in front
   of a customer. The startup log names exactly what is missing — look for
   `Environment is not usable:`.
3. Promote the last good deployment (§3) while you fix it.

---

## 6. The nightly job is not running

`/api/cron/daily` is triggered by Vercel Cron at 13:00 UTC (`vercel.json`). It
generates recurring jobs, sends reminders, reconciles ACH payments, retries
receipts and enforces data retention.

- **It requires `CRON_SECRET`.** Without it the endpoint returns 401 and does
  nothing. It used to run *unauthenticated* when the variable was unset, which
  meant anyone on the internet could trigger platform-wide data deletion; it now
  fails closed instead.
- Vercel must send that secret. Project Settings → Environment Variables, and the
  cron invocation must carry `Authorization: Bearer <CRON_SECRET>`.
- **`maxDuration` is 60 seconds**, which requires a Pro plan. On Hobby the
  function is capped lower and retention or reconciliation will truncate mid-run.
  Confirm the plan.
- The endpoint returns HTTP **500** and a `failed: [...]` list when any subsystem
  fails. It used to return `ok: true` unconditionally, so the dashboard stayed
  green over a broken system.

Trigger it manually to see the result:
```bash
curl -s -H "Authorization: Bearer $CRON_SECRET" https://<your-domain>/api/cron/daily | jq
```

---

## 7. Payments are failing

1. **`PAYMENT_SECRETS_KEY`** must decode to exactly 32 bytes. A wrong-length key
   used to surface only at the first real card payment; boot validation now
   catches it. Never rotate this without re-encrypting stored merchant
   credentials — every saved Helcim token becomes unreadable.
2. **Webhook verifiers** — `HELCIM_*_VERIFIER` and `STRIPE_WEBHOOK_SECRET`. All
   webhook routes fail closed without them: payments will be taken by the
   provider but never recorded here. Check the provider's webhook delivery log
   for 4xx/5xx responses.
3. **Reconciliation** — ACH takes days to settle. `reconcilePendingHelcimPayments`
   runs nightly; if the cron is down (§6), payments stay `processing` and invoices
   never flip to paid.
4. Never edit `payments` rows by hand to "fix" a balance. Invoice state is derived
   from settled payments; a manual row silently corrupts revenue reporting and
   technician commission.

---

## 8. Suspected data exposure

1. **Rotate first, investigate second.** Supabase → Settings → API → rotate the
   affected key, then update the deployment.
2. **Customer portal links** never used to expire. They now age out after 180
   days and can be revoked individually:
   ```sql
   select public.rotate_customer_portal_token('<customer-uuid>');
   ```
3. **Check who did what.** `audit_log` covers jobs, invoices, estimates and
   customers. Note the known gap: **`payments` has no audit trigger yet**
   (tracked as ledger item 6a.2), so payment edits leave no trail.
4. If a *service-role* key leaked, treat every tenant as exposed — that key
   bypasses row-level security entirely.

---

## 9. Routine checks

Weekly, or after any deploy that touches the database:

```sql
-- No table should ever appear here.
select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname='public' and c.relkind='r' and not c.relrowsecurity;

-- Jobs that would haunt the dispatch board (should be zero after migration 025).
select count(*) from public.jobs where end_date is null and deleted_at is null;

-- Deposits paid but not credited to an invoice (should be zero after 024).
select count(*) from public.payments
 where estimate_id is not null and invoice_id is null
   and normalized_status in ('settled','partially_refunded');
```

And run `db/016_isolation_tests.sql` — it must print `✔ ALL ISOLATION TESTS PASSED`.

---

## 10. Known gaps

Honest list of what this runbook cannot yet help you with. All are tracked in
`docs/REMEDIATION-PLAN.md`.

- **No alerting.** Errors are logged as structured JSON but nothing pages anyone.
  Somebody has to look.
- **No migration ledger in the database.** `db/MIGRATIONS.md` is the record; keep
  it accurate.
- **No audit trail on `payments`.**
- **No point-in-time recovery** unless it has been explicitly enabled and paid for.
