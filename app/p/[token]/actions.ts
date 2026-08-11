"use server";

import { createHash } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getLocale } from "@/lib/locale-server";
import { getRequestContext } from "@/lib/request-context";
// @ts-ignore -- pure logic, proven both ways in tests/rate-limit.test.mjs
import { consume } from "@/lib/core/rate-limit.mjs";

export type ApproveState = { ok: boolean; error?: string; witnessed?: boolean };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_SIGNATURE = 400_000; // matches the column truncation in migration 004/023

/**
 * Approve and sign a document — from the SERVER, so there is evidence.
 *
 * THE DEFECT: components/SignApprove.tsx called `supabase.rpc("approve_document")`
 * straight from the browser. The server never saw the request at all, so an
 * approved estimate recorded a typed name and a PNG and nothing else — no IP,
 * no user agent, no witnessed timestamp. As e-signature evidence under
 * ESIGN/UETA that is close to worthless: nothing connects the mark on the page
 * to the session that made it.
 *
 * This action is now the app's signing path. It captures what the server
 * observed and hands it to `approve_document_with_evidence`, which is granted
 * to the SERVICE ROLE ONLY — precisely so that the browser cannot dictate its
 * own IP address. Forged evidence would be worse than none.
 *
 * `approve_document` keeps its anon grant (migration 004 created it, 013
 * granted it, 023 §6 added the sign-once guard, and db/ci asserts it as anon).
 * A signature taken that way still writes an evidence row, marked
 * `capture = 'none'`, so it is visible as unwitnessed rather than passing for
 * the real thing.
 */
export async function approveDocument(
  _previous: ApproveState,
  formData: FormData,
): Promise<ApproveState> {
  const locale = (await getLocale()) === "he" ? "he" : "en";
  const he = locale === "he";
  const token = String(formData.get("token") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const signature = String(formData.get("signature") ?? "");

  if (!UUID.test(token))
    return { ok: false, error: he ? "הקישור אינו תקין." : "This link is not valid." };
  if (!name) return { ok: false, error: he ? "הזינו את שמכם." : "Enter your name." };
  if (signature.length > MAX_SIGNATURE) {
    return {
      ok: false,
      error: he
        ? "החתימה גדולה מדי. נסו לצייר אותה שוב."
        : "That signature is too large. Please draw it again.",
    };
  }

  const context = await getRequestContext();
  // Signing is anonymous and reachable by anyone holding the link.
  const limit = consume(`sign:${context.ip ?? "unknown"}:${token}`, 5, 600_000);
  if (!limit.allowed) {
    return {
      ok: false,
      error: he
        ? "יותר מדי ניסיונות. נסו שוב בעוד כמה דקות."
        : "Too many attempts. Try again in a few minutes.",
    };
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    // No service role configured: fall back to the anon RPC so a customer is
    // never blocked from approving their own estimate — and say so, because a
    // signature recorded without evidence must not look like one recorded with
    // it. `approve_document` still writes the evidence row (capture = 'none').
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("approve_document", {
      p_token: token,
      p_name: name,
      p_sig: signature,
    });
    if (error || !data) return { ok: false, error: approvalFailure(he) };
    return { ok: true, witnessed: false };
  }

  const { data, error } = await admin.rpc("approve_document_with_evidence", {
    p_token: token,
    p_name: name,
    p_sig: signature,
    p_ip: context.ip,
    p_ip_source: context.ipSource,
    p_ip_trusted: context.ipTrusted,
    p_user_agent: context.userAgent,
    p_device: context.device,
    // A hash of exactly what was stored. Anyone can later prove the signature
    // image on file is the one that was taken, without re-reading 400 KB.
    p_sig_sha256: signature ? createHash("sha256").update(signature).digest("hex") : null,
  });

  const result = data as { ok?: boolean; capture?: string } | null;
  if (error || !result?.ok) return { ok: false, error: approvalFailure(he) };
  return { ok: true, witnessed: result.capture === "server" };
}

function approvalFailure(he: boolean) {
  return he
    ? "לא הצלחנו לרשום את האישור. ייתכן שהמסמך כבר נחתם."
    : "We could not record the approval. The document may already be signed.";
}
