import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
  ciDatabase, runAssertionScript, CI_DIR,
  policyDropsThatRemovedNothing, installedPolicies,
} from "./helpers/rls-harness.mjs";

// ---------------------------------------------------------------------------
// PROVING THE ASSERTIONS BOTH WAYS.
//
// tests/rls-assertions.test.mjs reports that ~100 adversarial security
// assertions pass. On its own that sentence is worth nothing, because the most
// common failure in this repository is not a check that is wrong — it is a check
// that CANNOT FAIL. This session alone found a booking test that never ran, RLS
// greps that matched a `%I` format string and were therefore true of every
// table, an i18n parity check comparing two empty strings, and scheduling rules
// that were correct, tested, and called by nothing.
//
// So each proof below PLANTS THE DEFECT the assertion exists to catch — into a
// real database, after the real migrations — and requires that the named
// assertion goes red. A green result here means the assertion is load-bearing.
//
// Defect 1 is the literal historical bug: ledger 1.18, migration 023 §4 dropping
// policy names that migration 009 never created, so the old org-only pair
// survived and was OR'd with the new narrow pair.
// ---------------------------------------------------------------------------

/**
 * Apply `defect`, re-run the assertion file, and require that exactly the named
 * assertion fails.
 *
 * `mustStillPass` names assertions in the same file that the defect has no
 * business affecting. Without it, a defect that broke the whole file — a syntax
 * error, a dropped table — would look like a successful proof of every
 * assertion in it.
 */
async function provePlantedDefectIsCaught({ defect, file, mustFail, mustStillPass = [] }) {
  const { db } = await ciDatabase();

  const before = await runAssertionScript(db, path.join(CI_DIR, file));
  const beforeHit = before.find((r) => r.label === mustFail);
  assert.ok(beforeHit, `no assertion in ${file} is labelled "${mustFail}" — this proof is aimed at nothing`);
  assert.ok(beforeHit.ok, `"${mustFail}" was already failing before the defect was planted`);

  await db.exec(defect);

  const after = await runAssertionScript(db, path.join(CI_DIR, file));
  const afterHit = after.find((r) => r.label === mustFail);
  assert.equal(afterHit?.ok, false,
    `the defect was planted and "${mustFail}" still passed — the assertion cannot fail, so it proves nothing`);

  for (const label of mustStillPass) {
    const control = after.find((r) => r.label === label);
    assert.equal(control?.ok, true,
      `control assertion "${label}" also went red, so the defect broke the file rather than the property under test`);
  }
}

test("PROOF: restoring the pre-023 timesheet policy is caught (ledger 1.18, verbatim)", async () => {
  await provePlantedDefectIsCaught({
    // Exactly what migration 009 created and migration 023 failed to drop.
    // PERMISSIVE policies are OR'd, so this alone re-opens every colleague's
    // timesheet even though the narrow 023 policies are still installed.
    defect: `create policy time_entries_select on public.job_time_entries
               for select to authenticated
               using (organization_id = public.current_org_id());`,
    file: "30_tenant_assertions.sql",
    mustFail: "tech CANNOT read another technician job_time_entries row",
    mustStillPass: ["tech CAN read their own job_time_entries row", "tenant A CANNOT read tenant B customers"],
  });
});

// Loosening the RLS policy alone does NOT make this assertion fail, which is
// worth stating plainly: role escalation on public.profiles is defended TWICE
// over, by the WITH CHECK in profiles_self_update and independently by the
// trg_profiles_guard_privileges trigger, and either alone refuses the exploit.
// The test below removes both, because an assertion that only fires when every
// layer is gone is still load-bearing — and the two controls prove that each
// layer holds on its own.
test("PROOF: a technician promoting themselves is caught, and is guarded twice", async () => {
  const loosenPolicy = `drop policy if exists profiles_self_update on public.profiles;
      create policy profiles_self_update on public.profiles for update to authenticated
        using (id = auth.uid()) with check (id = auth.uid());`;
  const dropTrigger = `drop trigger if exists trg_profiles_guard_privileges on public.profiles;`;
  const file = "20_privilege_assertions.sql";
  const label = "tech CANNOT change their own profiles.role to owner";

  // Each layer, alone, must still refuse.
  for (const [name, defect] of [["the RLS policy", dropTrigger], ["the guard trigger", loosenPolicy]]) {
    const { db } = await ciDatabase();
    await db.exec(defect);
    const results = await runAssertionScript(db, path.join(CI_DIR, file));
    assert.equal(results.find((r) => r.label === label)?.ok, true,
      `with only ${name} left, a technician could promote themselves — that layer does not hold on its own`);
  }

  // With both gone, the assertion must fire. If it does not, it is decorative.
  await provePlantedDefectIsCaught({
    defect: `${dropTrigger}\n${loosenPolicy}`,
    file,
    mustFail: label,
    mustStillPass: ["tech CAN still edit their own full_name", "owner CAN still issue an invitation"],
  });
});

test("PROOF: one broad policy beside the correct ones re-opens the tenant boundary", async () => {
  await provePlantedDefectIsCaught({
    // The whole point of the OR'ing hazard, in one statement. Every correct
    // customers policy is left in place; this one is simply added beside them.
    defect: `create policy customers_oops on public.customers
               for select to authenticated using (true);`,
    file: "30_tenant_assertions.sql",
    mustFail: "tenant A CANNOT read tenant B customers",
    mustStillPass: ["tenant A CAN read its own customers", "tenant A CANNOT update tenant B customers"],
  });
});

// Both signing guards live in approve_document_with_evidence: migration 038
// made approve_document a wrapper around it precisely so the guard would exist
// in one place. Removing a guard from the LIVE function — read out of pg_proc
// rather than pasted from a migration — is what proves the assertion tracks the
// code that actually runs. Pointing this proof at 036's copy of
// approve_document is how the missing void guard stayed invisible.
async function proveSigningGuardIsLoadBearing(guard, label, control) {
  const { db } = await ciDatabase();
  const file = "40_document_assertions.sql";

  const before = (await runAssertionScript(db, path.join(CI_DIR, file))).find((r) => r.label === label);
  assert.ok(before, `no assertion in ${file} is labelled "${label}"`);
  assert.equal(before.ok, true, `"${label}" was already failing before the guard was removed`);

  const { rows } = await db.query(
    `select prosrc from pg_proc where proname = 'approve_document_with_evidence'`);
  const body = rows[0].prosrc.replaceAll(guard, "and true");
  assert.notEqual(body, rows[0].prosrc,
    `"${guard}" is not in the live approve_document_with_evidence, so this proof would remove nothing`);
  await db.exec(
    `create or replace function public.approve_document_with_evidence(
       p_token uuid, p_name text, p_sig text,
       p_ip text default null, p_ip_source text default null, p_ip_trusted boolean default false,
       p_user_agent text default null, p_device text default null, p_sig_sha256 text default null)
     returns jsonb language plpgsql security definer set search_path = public as $planted$${body}$planted$;`);

  const after = await runAssertionScript(db, path.join(CI_DIR, file));
  assert.equal(after.find((r) => r.label === label)?.ok, false,
    `"${guard}" was removed and "${label}" still passed — the assertion proves nothing`);
  assert.equal(after.find((r) => r.label === control)?.ok, true,
    `control assertion "${control}" also went red, so the defect broke signing altogether`);
}

test("PROOF: losing the sign-once guard is caught", async () => {
  await proveSigningGuardIsLoadBearing(
    "and signed_at is null",
    "approve_document REFUSES to re-sign an already-signed estimate (returns false)",
    "approve_document SIGNS an unsigned estimate (returns true)");
});

test("PROOF: losing the void guard is caught — the exact regression 042 repairs", async () => {
  // Removing `and voided_at is null` reproduces the database as migrations 038
  // through 041 left it. If this assertion did not go red, migration 042 would
  // be unguarded and the next rewrite of the function would drop it again,
  // which is precisely how it was lost in the first place.
  await proveSigningGuardIsLoadBearing(
    "and voided_at is null",
    "approve_document REFUSES to sign a VOIDED estimate",
    "a live estimate beside the voided one still signs");
});

test("PROOF: restoring the pre-034 mailbox-only join is caught", async () => {
  await provePlantedDefectIsCaught({
    // Migration 034 §3b gutted the token-less form precisely because possession
    // of a mailbox is not a credential. This puts the email-only join back.
    defect: `create or replace function public.accept_invitation()
             returns uuid language plpgsql security definer set search_path = public as $planted$
             declare em text; inv record;
             begin
               if auth.uid() is null then raise exception 'not authenticated'; end if;
               if exists (select 1 from public.profiles where id = auth.uid() and organization_id is not null) then
                 return (select organization_id from public.profiles where id = auth.uid());
               end if;
               select email into em from auth.users where id = auth.uid();
               if em is null then return null; end if;
               select * into inv from public.invitations
                 where lower(email) = lower(em) and accepted_at is null and expires_at > now()
                 order by created_at desc limit 1;
               if not found then return null; end if;
               return inv.organization_id;
             end $planted$;`,
    file: "20_privilege_assertions.sql",
    mustFail: "the token-less accept_invitation() grants nothing, even to a genuine invitee",
    mustStillPass: [
      "accept_invitation(token) REFUSES an owner-level invite that an office user issued",
      "accept_invitation(token) ACCEPTS an owner-level invite that an owner issued",
    ],
  });
});

test("PROOF: a colleague's location history leaking is caught", async () => {
  await provePlantedDefectIsCaught({
    defect: `create policy technician_locations_oops on public.technician_locations
               for select to authenticated using (organization_id = public.current_org_id());`,
    file: "30_tenant_assertions.sql",
    mustFail: "tech CANNOT read a colleague location history",
    mustStillPass: ["tech CAN read their own location history", "tech CANNOT read another tenant location history"],
  });
});

test("PROOF: the harness itself would notice if impersonation stopped working", async () => {
  // The single most important guard in db/ci/10_fixtures.sql. If `set role
  // authenticated` silently left RLS unenforced, every "CANNOT" assertion in the
  // suite would pass while proving nothing at all — the exact shape of failure
  // this whole exercise exists to rule out.
  const { db } = await ciDatabase();
  await db.exec("alter role authenticated bypassrls;");
  const results = await runAssertionScript(db, path.join(CI_DIR, "10_fixtures.sql"));
  assert.equal(
    results.find((r) => r.label === "harness: RLS is ENFORCED for the impersonated role (tenant B is invisible)")?.ok,
    false,
    "RLS was switched off for the impersonated role and the fixtures still reported a trustworthy state");
});

test("PROOF: the no-op policy drop detector fires on a planted rename mismatch", async () => {
  // The detector reports nothing against db/ today, which is only reassuring if
  // it CAN report something. This is migration 023's mistake in miniature: a
  // migration that drops a name nothing created, on a table it did not create,
  // and installs a new policy beside the one it failed to remove.
  const { db } = await ciDatabase();
  const installed = await installedPolicies(db);

  const planted = `
    drop policy if exists customers_rw on public.customers;
    create policy customers_narrow on public.customers for select to authenticated
      using (organization_id = public.current_org_id());`;
  const found = policyDropsThatRemovedNothing("planted.sql", planted, installed);
  assert.deepEqual(found.map((f) => `${f.table}.${f.name}`), ["customers.customers_rw"],
    "the detector did not notice a drop that removed nothing");
  assert.equal(found[0].tableCreatedInSameFile, false);
  assert.equal(found[0].siblingDropRemovedSomething, false);

  // And it must stay SILENT on the good case: the ordinary drop-then-recreate
  // idiom, whose drop legitimately hits nothing on a first run. A detector that
  // fired on that would be turned off within a week.
  const idiomatic = `
    drop policy if exists customers_narrow on public.customers;
    create policy customers_narrow on public.customers for select to authenticated
      using (organization_id = public.current_org_id());`;
  assert.deepEqual(policyDropsThatRemovedNothing("planted.sql", idiomatic, installed), [],
    "the detector fired on the standard drop-then-recreate idiom");
});
