#!/usr/bin/env node
/**
 * Seed a local ServicePro E2E database with an organisation and three users.
 *
 * Users are created through the GoTrue admin API rather than by inserting into
 * auth.users directly — direct inserts break whenever the auth schema changes
 * (auth.identities.provider_id in particular has moved more than once).
 *
 * Everything below runs against the LOCAL stack only. The keys `supabase start`
 * prints are fixed demo keys, identical on every machine; they are not secrets,
 * and this script refuses to run against anything that is not localhost.
 *
 * Usage:  node seed.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";

const URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SERVICE_KEY) {
  console.error(
    "SUPABASE_SERVICE_ROLE_KEY is not set.\n" +
    "Run:  export SUPABASE_SERVICE_ROLE_KEY=$(supabase status -o json | jq -r .SERVICE_ROLE_KEY)"
  );
  process.exit(1);
}

// Hard guard. This script deletes and recreates users; pointing it at a hosted
// project would be destructive, so localhost is the only permitted target.
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:|$)/.test(URL)) {
  console.error(`Refusing to run: SUPABASE_URL is "${URL}", which is not localhost.`);
  console.error("This seed is for a throwaway local database only.");
  process.exit(1);
}

const db = createClient(URL, SERVICE_KEY, { auth: { persistSession: false } });

const pw = () => randomBytes(12).toString("base64url");

const USERS = [
  { key: "OWNER",  email: "e2e-owner@example.com",  role: "owner",  name: "E2E Owner" },
  { key: "OFFICE", email: "e2e-office@example.com", role: "office", name: "E2E Office" },
  { key: "TECH",   email: "e2e-tech@example.com",   role: "tech",   name: "E2E Tech" },
];

const die = (label, error) => {
  if (!error) return;
  console.error(`\n✖ ${label}: ${error.message ?? JSON.stringify(error)}`);
  process.exit(1);
};

async function main() {
  console.log(`Seeding ${URL}\n`);

  // ---- 1. users -----------------------------------------------------------
  const { data: list } = await db.auth.admin.listUsers({ perPage: 1000 });
  for (const u of USERS) {
    u.password = pw();

    // Idempotent: drop a previous run's user with the same address.
    const existing = list?.users?.find((x) => x.email === u.email);
    if (existing) await db.auth.admin.deleteUser(existing.id);

    const { data, error } = await db.auth.admin.createUser({
      email: u.email,
      password: u.password,
      email_confirm: true, // pre-confirmed; no mailbox exists to confirm from
    });
    die(`create user ${u.email}`, error);
    u.id = data.user.id;
    console.log(`  user     ${u.email.padEnd(24)} ${u.role.padEnd(7)} ${u.id}`);
  }

  const [owner, office, tech] = USERS;

  // ---- 2. organisation ----------------------------------------------------
  // create_org_and_owner() depends on auth.uid(), which a service-role client
  // does not have, so the org and owner profile are written directly instead.
  const { data: org, error: orgErr } = await db
    .from("organizations")
    .insert({ name: "E2E Test Co", currency: "USD" })
    .select("id, name")
    .single();
  die("create organization", orgErr);
  console.log(`\n  org      ${org.name}  ${org.id}`);

  const { error: subErr } = await db.from("subscriptions").insert({
    organization_id: org.id,
    status: "trialing",
    trial_end: new Date(Date.now() + 14 * 864e5).toISOString(),
  });
  if (subErr && !/duplicate|unique/i.test(subErr.message)) die("create subscription", subErr);

  // ---- 3. profiles --------------------------------------------------------
  for (const u of USERS) {
    const { error } = await db.from("profiles").upsert({
      id: u.id,
      organization_id: org.id,
      full_name: u.name,
      role: u.role,
      active: true,
    });
    die(`profile ${u.email}`, error);
  }
  console.log(`  profiles owner / office / tech attached to the org`);

  // ---- 4. capabilities ----------------------------------------------------
  // Owners bypass this table entirely — loadCapabilities() short-circuits and
  // grants all 12. Office gets broad-but-not-total. Tech gets the minimum.
  //
  // The tech row exists for the negative case: no payments, no invoices, no
  // reports. That is what proves a technician cannot reach financial data.
  const CAPS = {
    office: {
      can_view_customers: true,  can_edit_customers: true,  can_manage_schedule: true,
      can_edit_jobs: true,       can_manage_estimates: true, can_manage_invoices: true,
      can_manage_payments: false, can_view_reports: true,   can_manage_purchasing: false,
      can_manage_automations: false, can_manage_settings: false, can_manage_team: false,
    },
    tech: {
      can_view_customers: true,  can_edit_customers: false, can_manage_schedule: true,
      can_edit_jobs: true,       can_manage_estimates: false, can_manage_invoices: false,
      can_manage_payments: false, can_view_reports: false,  can_manage_purchasing: false,
      can_manage_automations: false, can_manage_settings: false, can_manage_team: false,
    },
  };
  for (const u of [office, tech]) {
    const { error } = await db
      .from("profile_capabilities")
      .upsert({ profile_id: u.id, organization_id: org.id, ...CAPS[u.role] });
    die(`capabilities ${u.email}`, error);
  }
  console.log(`  caps     office = no payments/settings/team · tech = jobs + schedule only`);

  // ---- 5. a customer and a job assigned to the technician -----------------
  const { data: customer, error: custErr } = await db.from("customers").insert({
    organization_id: org.id,
    name: "E2E Customer",
    phone: "5125550100",
    email: "e2e-customer@example.com",
    address: "1 Test Street",
    city: "Austin",
    created_by: owner.id,
  }).select("id").single();
  die("create customer", custErr);

  const today = new Date().toISOString().slice(0, 10);
  const { data: job, error: jobErr } = await db.from("jobs").insert({
    organization_id: org.id,
    customer_id: customer.id,
    assigned_to: tech.id,          // required by the role-separation tests
    service: "AC Cleaning",
    status: "scheduled",
    price_minor: 18900,
    scheduled_date: today,
    start_time: "09:00",
    end_time: "10:00",
    created_by: owner.id,
  }).select("id").single();
  die("create job", jobErr);
  console.log(`  data     1 customer, 1 job assigned to the tech (${today} 09:00) ${job.id}`);

  // ---- 6. write the .env the test runner consumes -------------------------
  const anon = process.env.SUPABASE_ANON_KEY ?? "<run: supabase status>";
  const env = [
    "# Generated by seed.mjs — local throwaway database only.",
    "# Do not commit. Losing it is harmless: re-run the seed for fresh passwords.",
    `NEXT_PUBLIC_SUPABASE_URL=${URL}`,
    `NEXT_PUBLIC_SUPABASE_ANON_KEY=${anon}`,
    `SUPABASE_SERVICE_ROLE_KEY=${SERVICE_KEY}`,
    "",
    ...USERS.flatMap((u) => [`E2E_${u.key}_EMAIL=${u.email}`, `E2E_${u.key}_PASSWORD=${u.password}`]),
    "",
    "# Generated fresh for this environment. 32 bytes, as lib/payments/crypto.ts requires.",
    `PAYMENT_SECRETS_KEY=${randomBytes(32).toString("hex")}`,
    `CRON_SECRET=${randomBytes(24).toString("hex")}`,
  ].join("\n") + "\n";

  writeFileSync(".env.e2e", env);
  console.log(`\n✔ Seed complete. Credentials written to .env.e2e`);
  console.log(`  Sign in as ${owner.email}, ${office.email} or ${tech.email}.`);
  console.log(`  Passwords are generated per run and never reused.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
