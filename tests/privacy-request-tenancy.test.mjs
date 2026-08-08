import test from "node:test";
import assert from "node:assert/strict";
import { freshDatabase } from "./helpers/pg.mjs";

// ---------------------------------------------------------------------------
// A privacy request must not be able to name a customer belonging to a
// DIFFERENT business.
//
// HOW THIS FILE CAME ABOUT, because the mistake is the useful part.
//
// `privacy_requests.customer_id` (migration 022) is a plain single-column
// `references public.customers(id)`, NOT the composite
// `(customer_id, organization_id) -> customers(id, organization_id)` that
// migration 014 established elsewhere. Reading the schema, I concluded the
// tenant guard was missing here and wrote a migration to add the composite FK.
//
// It was not missing. Migration 014 also installs a generic org-guard TRIGGER,
// and 022 attaches it to this table; a cross-tenant insert is refused with
// `cross-tenant reference blocked: privacy_requests.customer_id -> customers`.
// The schema text alone does not tell you whether an invariant holds, because
// the invariant is not always enforced by the thing you are reading.
//
// My first version of this test asserted a foreign-key violation (23503) and
// went red — and I briefly read "red" as "the gap is real". It was red because
// the row was refused by a CHECK violation (23514) from the trigger instead:
// refused, correctly, by a mechanism I had not looked for. A test that fails
// for the wrong reason looks exactly like a test that fails for the right one.
// The proposed migration was withdrawn.
//
// What survives is worth keeping. Nothing previously executed this invariant
// for privacy requests — it was covered by a generic trigger nobody had aimed a
// test at. This file aims one, and asserts the specific mechanism, so that
// removing the trigger from this table cannot pass silently.
//
// Why it matters here specifically: a privacy request is a legal instrument, a
// data-subject access request under GDPR/CCPA. A cross-tenant customer_id would
// make app/api/privacy/export/[requestId]/route.ts return `customer: null` and
// empty arrays, then stamp the request `status = 'ready'` — the business would
// believe it had answered a statutory request the subject never received.
// ---------------------------------------------------------------------------

const ORG_A = "aaaaaaaa-0000-0000-0000-000000000001";
const ORG_B = "bbbbbbbb-0000-0000-0000-000000000002";
const CUST_B = "cccccccc-0000-0000-0000-000000000003";

async function twoTenants(db) {
  await db.exec(`
    insert into public.organizations (id, name) values
      ('${ORG_A}', 'Tenant A'), ('${ORG_B}', 'Tenant B');
    insert into public.customers (id, organization_id, name, phone)
      values ('${CUST_B}', '${ORG_B}', 'Tenant B customer', '555-0100');
  `);
}

test("a privacy request cannot name another business's customer", async () => {
  const { db } = await freshDatabase();
  await twoTenants(db);

  await assert.rejects(
    () =>
      db.exec(`
        insert into public.privacy_requests
          (organization_id, customer_id, request_type, requester_name, identity_verified_at)
        values
          ('${ORG_A}', '${CUST_B}', 'export', 'Mallory', now());
      `),
    (error) => {
      // Assert the MESSAGE, not just that something was thrown. Accepting any
      // error would let a typo in this fixture — a not-null violation, a bad
      // enum — masquerade as the guard working, which is how a test ends up
      // passing for a reason unrelated to what it claims to check.
      assert.match(
        String(error.message),
        /cross-tenant reference blocked: privacy_requests\.customer_id -> customers/,
        `refused, but not by the org guard: ${error.code} ${error.message}`,
      );
      return true;
    },
    "org A must not be able to file a privacy request naming a customer of org B",
  );
});

test("the same request against its OWN customer is accepted", async () => {
  // The other direction. Without this, a guard that rejected every insert would
  // pass the test above while breaking the entire privacy workflow.
  const { db } = await freshDatabase();
  await twoTenants(db);

  await db.exec(`
    insert into public.privacy_requests
      (organization_id, customer_id, request_type, requester_name, identity_verified_at)
    values
      ('${ORG_B}', '${CUST_B}', 'export', 'A genuine data subject', now());
  `);

  const { rows } = await db.query(
    `select customer_id from public.privacy_requests where organization_id = '${ORG_B}'`,
  );
  assert.equal(
    rows.length,
    1,
    "a business must still be able to file a request for its own customer",
  );
  assert.equal(rows[0].customer_id, CUST_B);
});

test("a privacy request with no customer attached is still allowed", async () => {
  // customer_id is nullable by design: a request arrives before anyone has
  // worked out which customer record it refers to. The guard must not quietly
  // make the column mandatory.
  const { db } = await freshDatabase();
  await twoTenants(db);

  await db.exec(`
    insert into public.privacy_requests
      (organization_id, request_type, requester_name)
    values
      ('${ORG_A}', 'access', 'Not yet matched to a customer');
  `);

  const { rows } = await db.query(
    `select customer_id from public.privacy_requests where organization_id = '${ORG_A}'`,
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].customer_id, null, "an unmatched request must still be recordable");
});
