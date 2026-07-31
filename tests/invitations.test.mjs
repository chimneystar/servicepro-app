import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { isValidInvitationToken, invitationAcceptUrl, invitationEmail, describeInviteDelivery } from "../lib/core/invitations.mjs";
import { stripSqlComments } from "./helpers/sql.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// ---------------------------------------------------------------------------
// TWO DEFECTS: the invitation email was NEVER SENT (there was no sendEmail
// anywhere in the team flow), and `accept_invitation()` matched on EMAIL ALONE,
// so the token it generated protected nothing at all.
// ---------------------------------------------------------------------------

test("only a real token shape is accepted", () => {
  assert.equal(isValidInvitationToken(randomUUID()), true);
  for (const bad of ["", " ", null, undefined, "abc", "not-a-uuid", "../../etc/passwd", `${randomUUID()} or 1=1`, randomUUID().slice(0, 30)]) {
    assert.equal(isValidInvitationToken(bad), false, `${JSON.stringify(bad)} must not be accepted`);
  }
});

test("the acceptance link carries the token to /join", () => {
  const token = randomUUID();
  const url = invitationAcceptUrl("https://app.servicepro.test", token);
  assert.equal(url, `https://app.servicepro.test/join?token=${token}`);
  assert.equal(invitationAcceptUrl("https://app.servicepro.test/", token), `https://app.servicepro.test/join?token=${token}`);
});

test("no link is produced when there is nothing safe to build one from", () => {
  // The alternative — an `undefined/join?token=...` link in a real customer's
  // inbox — is how "sent" turns back into "not delivered".
  const token = randomUUID();
  assert.equal(invitationAcceptUrl("", token), null);
  assert.equal(invitationAcceptUrl(undefined, token), null);
  assert.equal(invitationAcceptUrl("javascript:alert(1)", token), null);
  assert.equal(invitationAcceptUrl("https://app.servicepro.test", "not-a-token"), null);
});

test("the invitation email contains the link and escapes everything untrusted", () => {
  const token = randomUUID();
  const acceptUrl = invitationAcceptUrl("https://app.servicepro.test", token);
  const { subject, html, text } = invitationEmail({
    locale: "en", businessName: `Ace <script>alert("x")</script> Plumbing`,
    inviterName: "Dana & Co", role: "office", acceptUrl,
  });
  assert.match(subject, /You're invited to join/);
  assert.ok(html.includes(acceptUrl), "the whole point is that the person receives the link");
  assert.ok(!html.includes("<script>"), "an invitation must not carry markup from a business name");
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(html.includes("Dana &amp; Co"));
  assert.ok(html.includes("Office"), "the role being granted is stated");
  assert.ok(text.includes(acceptUrl));
});

test("the invitation email is written in the invited person's language", () => {
  const acceptUrl = invitationAcceptUrl("https://app.servicepro.test", randomUUID());
  const en = invitationEmail({ locale: "en", businessName: "Ace Plumbing", role: "tech", acceptUrl });
  const he = invitationEmail({ locale: "he", businessName: "Ace Plumbing", role: "tech", acceptUrl });
  assert.notEqual(he.subject, en.subject);
  assert.ok(he.html.includes(acceptUrl));
  assert.ok(he.html.includes("טכנאי"));
});

test("an invitation nobody was told about is NOT reported as sent", () => {
  // The screen used to show a pending invite as though the person had been
  // notified. They never had been: no email existed.
  assert.equal(describeInviteDelivery({ delivery_status: "pending" }, "en").tone, "warn");
  assert.equal(describeInviteDelivery({}, "en").tone, "warn");
  assert.match(describeInviteDelivery({ delivery_status: "unavailable" }, "en").text, /NOT emailed/);
  assert.equal(describeInviteDelivery({ delivery_status: "failed", delivery_error: "550 mailbox unavailable" }, "en").tone, "error");
  assert.match(describeInviteDelivery({ delivery_status: "failed", delivery_error: "550 mailbox unavailable" }, "en").text, /550 mailbox unavailable/);
  // And the good case is reported as good, in both languages.
  assert.equal(describeInviteDelivery({ delivery_status: "sent" }, "en").tone, "ok");
  assert.notEqual(describeInviteDelivery({ delivery_status: "sent" }, "he").text, describeInviteDelivery({ delivery_status: "sent" }, "en").text);
});

// ---------------------------------------------------------------------------
// Structural, over comment-stripped source: an email is really sent, and the
// database really requires the token.
// ---------------------------------------------------------------------------

const stripJsComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/[^\n]*$/gm, " ");
const source = (file) => stripJsComments(readFileSync(join(root, file), "utf8"));

test("the team flow now actually sends the invitation email", () => {
  const actions = source("app/(app)/team/actions.ts");
  assert.match(actions, /import \{[^}]*sendEmail[^}]*\} from "@\/lib\/providers"/);
  assert.match(actions, /await sendEmail\(/);
  assert.match(actions, /invitationEmail\(/);
  assert.match(actions, /delivery_status: "sent"/);
  // Failure is recorded rather than swallowed.
  assert.match(actions, /delivery_status: status/);
  assert.match(actions, /export async function resendInvite/);
});

test("acceptance goes through the token, not the email address alone", () => {
  const onboarding = source("app/onboarding/page.tsx");
  assert.match(onboarding, /rpc\("accept_invitation", \{ invite_token: inviteToken \}\)/);
  assert.doesNotMatch(onboarding, /rpc\("accept_invitation"\)/, "the email-only form must not be what joins a business");
  const join = source("app/join/route.ts");
  assert.match(join, /isValidInvitationToken/);
  assert.match(join, /httpOnly: true/);
  assert.match(join, /sameSite: "lax"/);
});

test("migration 034 makes the token a requirement and keeps the 023 owner guard", () => {
  const sql = stripSqlComments(readFileSync(join(root, "db", "034_notifications_support.sql"), "utf8"));

  assert.match(sql, /create or replace function public\.accept_invitation\(invite_token text\)/);
  assert.match(sql, /where token = wanted and accepted_at is null and expires_at > now\(\)/);
  assert.match(sql, /lower\(inv\.email\) is distinct from lower\(em\)/, "the email must still have to match the token's invitation");
  assert.match(sql, /invitation_email_mismatch/);

  // 023 §2 added this. It must survive verbatim.
  assert.match(sql, /if inv\.role::text = 'owner' then/);
  assert.match(sql, /invitation_role_not_permitted/);
  assert.match(sql, /grant\s+execute on function public\.accept_invitation\(text\) to authenticated/);
  assert.match(sql, /revoke execute on function public\.accept_invitation\(text\) from public, anon/);

  // The hint that stops the token requirement stranding an invited person.
  assert.match(sql, /create or replace function public\.pending_invitation_hint\(\)/);
  assert.doesNotMatch(sql.split("pending_invitation_hint")[1] ?? "", /i\.token/, "the hint must never return the token");
});

test("migration 034 drops nothing and is idempotent", () => {
  const sql = stripSqlComments(readFileSync(join(root, "db", "034_notifications_support.sql"), "utf8"));
  // A previous defect on this branch was a migration dropping policy names that
  // did not exist, so the fix silently did nothing. This one drops nothing at
  // all, and every create is guarded.
  assert.doesNotMatch(sql, /\bdrop\s+(policy|table|function|trigger|index|column|constraint)\b/i);
  for (const create of sql.match(/create table [^(]+/gi) ?? []) {
    assert.match(create, /if not exists/i, create);
  }
  for (const create of sql.match(/create index [^(]+/gi) ?? []) {
    assert.match(create, /if not exists/i, create);
  }
  for (const create of sql.match(/create (or replace )?function [^(]+/gi) ?? []) {
    assert.match(create, /or replace/i, create);
  }
  // The one bare `create policy` is inside a guard that checks pg_policies.
  const policyCount = (sql.match(/create policy/gi) ?? []).length;
  assert.equal(policyCount, 1);
  assert.match(sql, /if not exists \(\s*select 1 from pg_policies[\s\S]*?create policy/i);
});

test("every column migration 034 writes to exists in the schema it is built on", () => {
  const sql = stripSqlComments(readFileSync(join(root, "db", "034_notifications_support.sql"), "utf8"));
  const baseline = stripSqlComments(readFileSync(join(root, "db", "001_schema.sql"), "utf8"));
  const foundation = stripSqlComments(readFileSync(join(root, "db", "018_product_foundation.sql"), "utf8"));
  const platform = stripSqlComments(readFileSync(join(root, "db", "022_operations_privacy_team_admin.sql"), "utf8"));

  // Tables this migration alters must already exist somewhere.
  for (const [table, definition] of [["public.invitations", baseline], ["public.push_notification_events", foundation]]) {
    assert.match(sql, new RegExp(`alter table ${table.replace(".", "\\.")}`), `${table} is altered`);
    assert.match(definition, new RegExp(`create table if not exists ${table.replace(".", "\\.")}`), `${table} must exist first`);
  }
  // Columns read by the new function must be real columns of `invitations`.
  for (const column of ["token", "accepted_at", "expires_at", "invited_by", "organization_id", "email", "role"]) {
    assert.match(baseline, new RegExp(`\\n\\s+${column}\\s`), `invitations.${column}`);
  }
  // Support session columns the access rules read must be real too.
  for (const column of ["admin_user_id", "organization_id", "access_level", "starts_at", "expires_at", "revoked_at"]) {
    assert.match(platform, new RegExp(`\\n\\s+${column}\\s`), `support_sessions.${column}`);
  }
});
