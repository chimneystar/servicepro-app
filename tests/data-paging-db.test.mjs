import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { freshDatabase, asUser, DB_DIR } from "./helpers/pg.mjs";
import { fakePostgrest, countingPostgrest, DB_MAX_ROWS } from "./helpers/postgrest-fake.mjs";
import {
  pageAll,
  PAGE_SIZE,
  clampLimit,
  isLastPage,
  pageBounds,
  pageWindow,
  splitPage,
} from "../lib/core/paging.mjs";

// ---------------------------------------------------------------------------
// THE ONLY WAY TO KNOW.
//
// Every other test of pagination in this repository is a static one: it reads
// the source and asserts that `.range(a, b)` appears in it. That is worth
// having — it is what `tests/export-and-currency.test.mjs` does — but it cannot
// answer the question the accountant actually asked, which is "did I receive
// all of my invoices?"
//
// A response truncated by PostgREST's 1000-row cap is HTTP 200, `error: null`,
// and a thousand perfectly valid rows. It is indistinguishable from a complete
// answer at every layer above the wire. So the only proof is to put more than a
// thousand real rows in a real table and count what comes back.
//
// These tests do exactly that: PGlite applies all 41 migrations (the real
// schema, the real constraints), 1001 customers go in, and they are read back
// through an adapter that truncates the way Supabase truncates. The loop under
// test is `lib/core/paging.mjs` — the same module `lib/data/db.ts` ships, not a
// transcription of it.
// ---------------------------------------------------------------------------

const ROWS = 1001; // one more than the cap: the smallest number that can detect it

const ciShim = readFileSync(path.join(DB_DIR, "ci", "00_supabase_shim.sql"), "utf8");

/** A fresh schema with `count` customers in one organisation. */
async function databaseWithCustomers(count) {
  const { db } = await freshDatabase();
  const { rows } = await db.query(
    `insert into public.organizations (name) values ('Paging Ltd') returning id`,
  );
  const orgId = rows[0].id;
  // One statement: 1001 round trips through PGlite is slow enough to matter.
  await db.query(
    `insert into public.customers (organization_id, name, phone)
     select $1, 'Customer ' || lpad(g::text, 5, '0'), '555' || g
     from generate_series(1, $2) g`,
    [orgId, count],
  );
  return { db, orgId };
}

test("the 1000-row cap is real: an unpaged read of 1001 rows silently returns 1000", async () => {
  const { db, orgId } = await databaseWithCustomers(ROWS);
  const supabase = fakePostgrest(db);

  // This is what 130 reads in this codebase looked like before the data layer.
  const { data, error } = await supabase
    .from("customers")
    .select("id, name")
    .eq("organization_id", orgId)
    .order("name", { ascending: true });

  assert.equal(
    error,
    null,
    "the truncation is NOT reported as an error — that is the whole defect",
  );
  assert.equal(data.length, DB_MAX_ROWS, "exactly the cap came back");
  assert.notEqual(data.length, ROWS, "and one customer is missing, with nothing to say so");
  await db.close();
});

test("readAll's loop returns every one of 1001 rows", async () => {
  const { db, orgId } = await databaseWithCustomers(ROWS);
  const supabase = fakePostgrest(db);

  const all = await pageAll(
    (from, to) =>
      supabase
        .from("customers")
        .select("id, name")
        .eq("organization_id", orgId)
        .order("name", { ascending: true })
        .range(from, to)
        .then((r) => r.data),
    {
      onOverflow: () => {
        throw new Error("unexpected overflow");
      },
    },
  );

  assert.equal(all.length, ROWS, "every row, past the cap");
  // Not just the count — the right rows, in order, with no page boundary
  // dropping or duplicating one. An off-by-one in `pageBounds` would keep the
  // count plausible while losing row 501.
  const names = all.map((r) => r.name);
  assert.equal(names[0], "Customer 00001");
  assert.equal(names[ROWS - 1], `Customer 0${ROWS}`);
  assert.equal(new Set(all.map((r) => r.id)).size, ROWS, "no row was read twice");
  assert.deepEqual(names, [...names].sort(), "the order survived paging");
  await db.close();
});

test("it pages — three ranged requests, not one lucky large one", async () => {
  const { db, orgId } = await databaseWithCustomers(ROWS);
  const { client, requests } = countingPostgrest(db);

  await pageAll(
    (from, to) =>
      client
        .from("customers")
        .select("id")
        .eq("organization_id", orgId)
        .order("id", { ascending: true })
        .range(from, to)
        .then((r) => r.data),
    {
      onOverflow: () => {
        throw new Error("unexpected overflow");
      },
    },
  );

  // 1001 rows at 500 per page: two full pages, then a short one that ends it.
  assert.equal(requests.length, 3, `expected 3 ranged requests, got ${requests.length}`);
  assert.ok(
    requests.every((r) => r.ranged),
    "every request the loop makes carries a range",
  );
  assert.match(requests[0].sql, /limit 500(?! offset)/);
  assert.match(requests[1].sql, /offset 500/);
  assert.match(requests[2].sql, /offset 1000/);
  await db.close();
});

test("a total that is an exact multiple of the page size still terminates, and completely", async () => {
  // The off-by-one that a 1001-row test cannot see. With PAGE_SIZE = 500 and
  // exactly 1000 rows, page 2 comes back empty; a loop that stopped on "a full
  // page" would return 1000 correctly by luck, and a loop that stopped only on
  // an empty page must not spin.
  const { db, orgId } = await databaseWithCustomers(PAGE_SIZE * 2);
  const { client, requests } = countingPostgrest(db);

  const all = await pageAll(
    (from, to) =>
      client
        .from("customers")
        .select("id")
        .eq("organization_id", orgId)
        .order("id", { ascending: true })
        .range(from, to)
        .then((r) => r.data),
    {
      onOverflow: () => {
        throw new Error("unexpected overflow");
      },
    },
  );

  assert.equal(all.length, PAGE_SIZE * 2);
  assert.equal(requests.length, 3, "the third request is what proves the sequence really ended");
  await db.close();
});

test("row-level security still applies to a paged read — paging is not a way around it", async () => {
  // Paging issues N requests where there was one. If any of them escaped RLS,
  // the data layer would have turned a correctness fix into a tenant leak.
  //
  // The CI shim, not the minimal one: only it issues Supabase's
  // `grant ... to authenticated`, and `set role authenticated` below is what
  // actually subjects the query to RLS. Without both, PGlite runs as the
  // superuser, every policy is bypassed, and this test would pass while proving
  // nothing at all — which is the failure mode db/ci/10_fixtures.sql exists to
  // catch. The assertion at the end of the fixture block here is the local
  // version of that check.
  const { db } = await freshDatabase({ shim: ciShim, skip: ["016_isolation_tests.sql"] });
  const orgs = [];
  for (const name of ["Tenant A", "Tenant B"]) {
    const { rows } = await db.query(
      `insert into public.organizations (name) values ($1) returning id`,
      [name],
    );
    orgs.push(rows[0].id);
  }
  const owners = [];
  for (const [i, org] of orgs.entries()) {
    const { rows } = await db.query(`insert into auth.users (email) values ($1) returning id`, [
      `owner${i}@example.com`,
    ]);
    const uid = rows[0].id;
    await db.query(
      `insert into public.profiles (id, organization_id, full_name, role)
       values ($1, $2, $3, 'owner')`,
      [uid, org, `Owner ${i}`],
    );
    owners.push(uid);
  }
  // 600 customers for A (so it genuinely spans two pages) and 3 for B.
  await db.query(
    `insert into public.customers (organization_id, name, phone)
     select $1, 'A ' || lpad(g::text, 4, '0'), '555' || g from generate_series(1, 600) g`,
    [orgs[0]],
  );
  await db.query(
    `insert into public.customers (organization_id, name, phone)
     select $1, 'B ' || g, '777' || g from generate_series(1, 3) g`,
    [orgs[1]],
  );

  await asUser(db, owners[1], async () => {
    await db.exec("set role authenticated;");
    // Prove the impersonation took effect BEFORE trusting anything it shows.
    // A "tenant B sees only 3 rows" result is equally consistent with RLS
    // working and with the fixture having inserted nothing.
    const { rows: check } = await db.query(`select count(*)::int as n from public.customers`);
    assert.equal(check[0].n, 3, "RLS is genuinely in force for this role, not bypassed");

    const supabase = fakePostgrest(db);
    const seen = await pageAll(
      (from, to) =>
        supabase
          .from("customers")
          .select("id, name")
          .order("name", { ascending: true })
          .range(from, to)
          .then((r) => r.data),
      {
        onOverflow: () => {
          throw new Error("unexpected overflow");
        },
      },
    );
    assert.equal(seen.length, 3, "tenant B pages through tenant B's rows only");
    assert.ok(
      seen.every((r) => r.name.startsWith("B ")),
      "no row of tenant A's 600 crossed a page boundary into tenant B's result",
    );
    await db.exec("reset role;");
  });
  await db.close();
});

test("visible pagination walks a real table exactly once, and knows where it ends", async () => {
  // readPage's over-read, against real rows. The failure this catches is a
  // "Next" button on the last page: with 300 rows and a page of 100, page 2 is
  // full and there is nothing after it, which an implementation that asks for
  // exactly `size` rows cannot tell from a page that continues.
  const SIZE = 100;
  const TOTAL = 300;
  const { db, orgId } = await databaseWithCustomers(TOTAL);
  const supabase = fakePostgrest(db);

  const readOnePage = async (page) => {
    const { from, to } = pageWindow(page, SIZE);
    const { data } = await supabase
      .from("customers")
      .select("id, name")
      .eq("organization_id", orgId)
      .order("name", { ascending: true })
      .range(from, to);
    return splitPage(data, SIZE);
  };

  const seen = [];
  for (let page = 0; page < 5; page++) {
    const { rows, hasMore } = await readOnePage(page);
    seen.push(...rows);
    assert.ok(rows.length <= SIZE, `page ${page} returned more than one page of rows`);
    if (page < 2) assert.equal(hasMore, true, `page ${page} of 3 must offer a next page`);
    if (page === 2) {
      assert.equal(rows.length, SIZE, "the last page is exactly full");
      assert.equal(hasMore, false, "...and must NOT offer a next page — this is the off-by-one");
    }
    if (!hasMore) break;
  }

  assert.equal(seen.length, TOTAL, "every row appeared");
  assert.equal(new Set(seen.map((r) => r.id)).size, TOTAL, "and none appeared twice");
  await db.close();
});

// ---------------------------------------------------------------------------
// The arithmetic, without a database. Fast, and it pins the reasoning that the
// database tests confirm.
// ---------------------------------------------------------------------------

test("the page size is below the cap, which is what makes a short page meaningful", () => {
  assert.ok(
    PAGE_SIZE < DB_MAX_ROWS,
    "a page equal to the cap cannot tell a full page from a truncated one",
  );
  assert.deepEqual(pageBounds(0, 500), { from: 0, to: 499 });
  assert.deepEqual(pageBounds(2, 500), { from: 1000, to: 1499 });
  assert.equal(isLastPage(499, 500), true);
  assert.equal(isLastPage(500, 500), false, "a full page is never assumed to be the last");
});

test("an explicit limit is clamped below the cap rather than silently truncated", () => {
  assert.equal(clampLimit(10), 10);
  assert.equal(clampLimit(5000), DB_MAX_ROWS - 1, "asking for 5000 must not quietly become 1000");
  assert.equal(clampLimit(0), 1);
  assert.equal(clampLimit(2.7), 2);
});

test("the paging ceiling raises instead of looping for ever", async () => {
  let ceiling = null;
  await assert.rejects(
    pageAll(async () => new Array(10).fill({ id: 1 }), {
      size: 10,
      maxPages: 3,
      onOverflow: (c) => {
        ceiling = c;
        throw new Error("SP_TOO_MANY_ROWS");
      },
    }),
    /SP_TOO_MANY_ROWS/,
  );
  assert.equal(ceiling, 30, "the ceiling is reported in rows, so the message can be acted on");
});
