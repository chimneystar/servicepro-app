import { createClient } from "@/lib/supabase/server";
import { t, type Locale } from "@/lib/i18n";
import type { Profile } from "@/lib/auth";
// @ts-ignore -- integer-safe money engine (JS module, unit-tested)
import { computeDocument, parseQtyToMilli, parseAmountToMinor, resolveTaxJurisdictions, isCustomerTaxExempt } from "@/lib/core/money.mjs";
// @ts-ignore -- document integrity rules (JS module, unit-tested)
import {
  assertDocumentEditable as editableRule, assertVersionMatch, isUniqueViolation,
  NUMBER_COLLISION_RETRIES, shouldReleaseDocumentNumber,
  validateVoid, validateCreditNote, validateCreditNoteCancel, validateReopen,
  documentLock,
} from "@/lib/core/documents.mjs";

export type ActionResult = { ok: boolean; error?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Settled statuses. Same definition as lib/core/refunds.mjs REFUNDABLE_STATUSES. */
const SETTLED = ["settled", "partially_refunded"];

/**
 * Money actually received against a document, net of refunds.
 *
 * A deposit paid against an estimate counts for BOTH the estimate and the
 * invoice it converted into — the same rule openBalance() applies in
 * lib/payments/server.ts, which is why a part-paid estimate is locked too.
 */
async function collectedMinor(
  supabase: any, kind: "estimate" | "invoice", id: string, estimateId?: string | null,
): Promise<number> {
  if (!UUID.test(id)) return 0;
  let query = supabase.from("payments")
    .select("amount_minor, base_amount_minor, refunded_minor")
    .in("normalized_status", SETTLED);
  if (kind === "invoice") {
    query = estimateId && UUID.test(estimateId)
      ? query.or(`invoice_id.eq.${id},estimate_id.eq.${estimateId}`)
      : query.eq("invoice_id", id);
  } else {
    query = query.eq("estimate_id", id);
  }
  const { data } = await query;
  return (data ?? []).reduce(
    (sum: number, p: any) =>
      sum + Math.max(0, Number(p.base_amount_minor ?? p.amount_minor ?? 0) - Number(p.refunded_minor ?? 0)),
    0,
  );
}

/** Public wrapper over {@link collectedMinor} for screens that need the figure. */
export async function collectedOnDocument(
  kind: "estimate" | "invoice", id: string, estimateId?: string | null,
): Promise<number> {
  const supabase = await createClient();
  return collectedMinor(supabase, kind, id, estimateId ?? null);
}

/**
 * Allocate a document number (6a.3).
 *
 * Kept in one place so every caller gets the max-aware, row-locked allocation
 * from migration 036 and the release-on-failure behaviour below.
 */
async function allocateNumber(
  supabase: any, orgId: string, kind: "estimate" | "invoice" | "credit_note",
): Promise<{ number?: number; error?: string }> {
  const { data, error } = await supabase.rpc("next_document_number", { p_org: orgId, p_kind: kind });
  if (error) return { error: error.message };
  return { number: data as number };
}

/**
 * Hand a burned number back after a failed insert.
 *
 * This is the gap-reduction half of the numbering decision. It is a
 * compare-and-set in the database — the number comes back only if the counter
 * still stands where we left it and nothing has taken the number — so it can
 * never issue the same number twice. When it cannot, the gap is kept, because a
 * gap is a question and a duplicate number is a disaster. Failure to release is
 * deliberately not surfaced: the document creation already failed, and a second
 * error about bookkeeping would bury the first.
 */
async function releaseNumber(
  supabase: any, orgId: string, kind: "estimate" | "invoice" | "credit_note", numberValue: number,
): Promise<void> {
  try {
    await supabase.rpc("release_document_number", { p_org: orgId, p_kind: kind, p_number: numberValue });
  } catch { /* the gap stays; see NUMBERING_POLICY in lib/core/documents.mjs */ }
}

/**
 * Insert a numbered document, re-allocating if the number collided.
 *
 * A collision is possible even with the row lock — the /settings next-number
 * override and any historical hand-inserted row live outside it — and before
 * migration 036 the caller saw a raw `23505` it could do nothing with.
 */
async function insertNumbered(
  supabase: any, table: "estimates" | "invoices", orgId: string,
  kind: "estimate" | "invoice", row: Record<string, unknown>,
): Promise<{ id?: string; number?: number; error?: string }> {
  let lastError = "";
  for (let attempt = 0; attempt <= NUMBER_COLLISION_RETRIES; attempt++) {
    const allocated = await allocateNumber(supabase, orgId, kind);
    if (allocated.error || !allocated.number) return { error: allocated.error ?? "numbering failed" };

    const { data, error } = await supabase.from(table)
      .insert({ ...row, number: allocated.number }).select("id").single();
    if (!error) return { id: data.id, number: allocated.number };

    lastError = error.message;
    if (!isUniqueViolation(error)) {
      await releaseNumber(supabase, orgId, kind, allocated.number);
      return { error: lastError };
    }
    // Collision: the number is genuinely taken, so it is NOT released — it
    // belongs to whatever document holds it. Allocate the next one.
  }
  return { error: lastError || "could not allocate a document number" };
}

/** What tax to charge on one document, and where the number came from. */
export type DocumentTax = { taxRateBps: number; taxExempt: boolean; mode: "flat" | "jurisdictions" };

/**
 * Resolve the tax for a document (ledger 5.16).
 *
 * `tax_jurisdictions` and `customer_tax_exemptions` existed but fed nothing —
 * every document used the single flat `organizations.tax_rate_bps`. They now
 * feed this, but only for an organisation that has opted in (`tax_mode`), so an
 * existing business's totals are unchanged until its owner turns it on.
 *
 * The rates come back through the `document_tax_context` security-definer
 * function rather than a direct select, because migration 022 gated those two
 * tables behind `payments.manage`: an office user with `estimates.manage` and no
 * finance access would otherwise read an empty rule list and price the document
 * at 0% tax with no error at all.
 *
 * If migration 035 has not been applied the function does not exist; we fall
 * back to the flat rate, which is exactly the behaviour before this feature.
 */
export async function resolveDocumentTax(
  supabase: any, orgId: string, customerId: string, onDate: string
): Promise<DocumentTax> {
  const { data, error } = await supabase.rpc("document_tax_context", { p_customer: customerId });
  if (error || !data) {
    const { data: org } = await supabase.from("organizations").select("tax_rate_bps").eq("id", orgId).single();
    return { taxRateBps: org?.tax_rate_bps ?? 0, taxExempt: false, mode: "flat" };
  }
  const context = data as {
    tax_mode?: string; tax_rate_bps?: number;
    jurisdictions?: Record<string, unknown>[]; exemptions?: Record<string, unknown>[];
  };
  const mode: "flat" | "jurisdictions" = context.tax_mode === "jurisdictions" ? "jurisdictions" : "flat";
  const flatBps = Number.isInteger(context.tax_rate_bps) ? (context.tax_rate_bps as number) : 0;
  const taxRateBps = mode === "jurisdictions"
    ? resolveTaxJurisdictions(context.jurisdictions ?? [], { onDate }).effectiveBps
    : flatBps;
  return { taxRateBps, taxExempt: isCustomerTaxExempt(context.exemptions ?? [], { onDate }), mode };
}

const today = () => new Date().toISOString().slice(0, 10);

type LineItem = {
  title: string; description: string; qtyMilli: number; unitPriceMinor: number;
  costMinor: number; taxable: boolean; imagePath: string | null;
};

/**
 * Create an estimate or invoice. The total is ALWAYS recomputed here on the
 * server from the line items using the tested money engine (with per-item tax)
 * — the client can never submit a total we didn't calculate. Each item is also
 * saved to the reusable item library (price_book) so it can be picked next time.
 */
export async function createDocument(
  kind: "estimate" | "invoice",
  formData: FormData,
  profile: Profile,
  locale: Locale
): Promise<ActionResult> {
  const customer_id = String(formData.get("customer_id") ?? "");
  if (!customer_id) return { ok: false, error: t(locale, "err.invalid") };

  // Parallel arrays, one entry per line item row.
  const titles = formData.getAll("title").map(String);
  const descs = formData.getAll("desc").map(String);
  const qtys = formData.getAll("qty").map(String);
  const prices = formData.getAll("price").map(String);
  const costs = formData.getAll("cost").map(String);
  const taxables = formData.getAll("taxable").map(String);
  const images = formData.getAll("image_path").map(String);

  const items: LineItem[] = [];
  try {
    for (let i = 0; i < Math.max(titles.length, descs.length); i++) {
      const title = (titles[i] ?? "").trim();
      const description = (descs[i] ?? "").trim();
      if (!title && !description) continue; // skip empty rows
      items.push({
        title: title || description,
        description,
        qtyMilli: parseQtyToMilli(qtys[i] ?? "0"),
        unitPriceMinor: parseAmountToMinor(prices[i] ?? "0"),
        costMinor: parseAmountToMinor(costs[i] ?? "0"),
        taxable: (taxables[i] ?? "1") !== "0",
        imagePath: (images[i] ?? "").trim() || null,
      });
    }
  } catch {
    return { ok: false, error: t(locale, "err.invalid") };
  }
  if (items.length === 0) return { ok: false, error: t(locale, "err.invalid") };

  let discountMinor = 0;
  try { discountMinor = parseAmountToMinor(String(formData.get("discount") ?? "0")); }
  catch { return { ok: false, error: t(locale, "err.invalid") }; }

  const supabase = await createClient();
  const tax = await resolveDocumentTax(supabase, profile.organization_id!, customer_id, today());

  const totals = computeDocument({
    items: items.map((i) => ({ qtyMilli: i.qtyMilli, unitPriceMinor: i.unitPriceMinor, taxable: i.taxable })),
    discountMinor, taxRateBps: tax.taxRateBps, taxExempt: tax.taxExempt,
  });

  const table = kind === "invoice" ? "invoices" : "estimates";
  const doc = await insertNumbered(supabase, table, profile.organization_id!, kind, {
    organization_id: profile.organization_id,
    created_by: profile.id,
    customer_id,
    status: kind === "invoice" ? "unpaid" : "draft",
    discount_minor: totals.discountMinor,
    // The rate ACTUALLY applied — 0 for an exempt customer — so the stored
    // document is internally consistent with its own total.
    tax_rate_bps: totals.taxRateBps,
    total_minor: totals.totalMinor,
    notes: String(formData.get("notes") ?? "").trim() || null,
  });
  if (doc.error || !doc.id) return { ok: false, error: doc.error };

  const itemsTable = kind === "invoice" ? "invoice_items" : "estimate_items";
  const parentKey = kind === "invoice" ? "invoice_id" : "estimate_id";
  const { error: itErr } = await supabase.from(itemsTable).insert(
    items.map((it, idx) => ({
      organization_id: profile.organization_id,
      [parentKey]: doc.id,
      title: it.title,
      description: it.description || it.title,
      qty_milli: it.qtyMilli,
      unit_price_minor: it.unitPriceMinor,
      cost_minor: it.costMinor,
      taxable: it.taxable,
      image_path: it.imagePath,
      sort: idx,
    }))
  );
  if (itErr) return { ok: false, error: itErr.message };

  // Save each item to the reusable library (dedupe by name, case-insensitive).
  await saveItemsToLibrary(supabase, profile.organization_id!, items);

  return { ok: true };
}

/** Parse the parallel line-item arrays out of a form (shared by create + edit). */
function parseDocItems(formData: FormData): LineItem[] {
  const titles = formData.getAll("title").map(String);
  const descs = formData.getAll("desc").map(String);
  const qtys = formData.getAll("qty").map(String);
  const prices = formData.getAll("price").map(String);
  const costs = formData.getAll("cost").map(String);
  const taxables = formData.getAll("taxable").map(String);
  const images = formData.getAll("image_path").map(String);
  const items: LineItem[] = [];
  for (let i = 0; i < Math.max(titles.length, descs.length); i++) {
    const title = (titles[i] ?? "").trim();
    const description = (descs[i] ?? "").trim();
    if (!title && !description) continue;
    items.push({
      title: title || description, description,
      qtyMilli: parseQtyToMilli(qtys[i] ?? "0"),
      unitPriceMinor: parseAmountToMinor(prices[i] ?? "0"),
      costMinor: parseAmountToMinor(costs[i] ?? "0"),
      taxable: (taxables[i] ?? "1") !== "0",
      imagePath: (images[i] ?? "").trim() || null,
    });
  }
  return items;
}

/** The columns every integrity check needs. One string, so it cannot drift. */
const INTEGRITY_COLUMNS =
  "id, number, status, version, signed_at, sent_at, voided_at, void_reason, deleted_at";

/** Read the lock/version state of one document. */
async function loadIntegrityRow(
  supabase: any, kind: "estimate" | "invoice", table: "estimates" | "invoices", id: string,
): Promise<any | null> {
  const cols = kind === "invoice" ? `${INTEGRITY_COLUMNS}, paid_at, estimate_id` : INTEGRITY_COLUMNS;
  const { data } = await supabase.from(table).select(cols).eq("id", id).maybeSingle();
  return data ?? null;
}

/**
 * Update an existing estimate/invoice. Totals are recomputed server-side.
 *
 * Two guards were added here (ledger 6a.5 and 6a.6), because this function had
 * neither:
 *
 *   * A SENT, SIGNED or PAID document's figures may no longer be rewritten. The
 *     customer's public /p/<token> link is served from these same rows, so an
 *     in-place edit retroactively changed the document they had already
 *     approved — with nothing recording that it had changed. Corrections now go
 *     through voidDocument / issueCreditNote, which keep the original.
 *   * The version the editor loaded must still be the version in the database.
 *     Two office users on the same estimate used to last-write-wins in silence.
 */
export async function updateDocument(
  kind: "estimate" | "invoice", id: string, formData: FormData, profile: Profile, locale: Locale
): Promise<ActionResult> {
  const table = kind === "invoice" ? "invoices" : "estimates";
  const itemsTable = kind === "invoice" ? "invoice_items" : "estimate_items";
  const parentKey = kind === "invoice" ? "invoice_id" : "estimate_id";
  const he = locale === "he";
  const supabase = await createClient();

  const customer_id = String(formData.get("customer_id") ?? "");
  if (!customer_id) return { ok: false, error: t(locale, "err.invalid") };

  const current = await loadIntegrityRow(supabase, kind, table, id);
  if (!current || current.deleted_at) return { ok: false, error: t(locale, "err.invalid") };

  const collected = await collectedMinor(supabase, kind, id, (current as any).estimate_id);
  const editable = editableRule(kind, { ...current, collected_minor: collected }, { he });
  if (!editable.ok) return { ok: false, error: editable.error };

  const version = assertVersionMatch(kind, formData.get("version"), current.version, { he });
  if (!version.ok) return { ok: false, error: version.error };

  let items: LineItem[];
  let discountMinor = 0;
  try {
    items = parseDocItems(formData);
    discountMinor = parseAmountToMinor(String(formData.get("discount") ?? "0"));
  } catch { return { ok: false, error: t(locale, "err.invalid") }; }
  if (items.length === 0) return { ok: false, error: t(locale, "err.invalid") };

  const issue = String(formData.get("issue_date") ?? "").trim();
  // Re-price on the document's own issue date: a rate that changed last month
  // must not be applied retroactively to a document issued before it started.
  const tax = await resolveDocumentTax(
    supabase, profile.organization_id!, customer_id,
    /^\d{4}-\d{2}-\d{2}$/.test(issue) ? issue : today(),
  );
  const totals = computeDocument({
    items: items.map((i) => ({ qtyMilli: i.qtyMilli, unitPriceMinor: i.unitPriceMinor, taxable: i.taxable })),
    discountMinor, taxRateBps: tax.taxRateBps, taxExempt: tax.taxExempt,
  });

  let depositMinor = 0;
  if (kind === "estimate") { try { depositMinor = parseAmountToMinor(String(formData.get("deposit") ?? "0")); } catch { depositMinor = 0; } }
  // `.eq("version", …)` is the concurrency check: migration 036 bumps the
  // version on every update, so a second writer matches ZERO rows rather than
  // overwriting the first. `.select()` is what makes that visible — without it
  // an update matching nothing is indistinguishable from one that worked.
  const { data: saved, error: upErr } = await supabase.from(table).update({
    customer_id,
    discount_minor: totals.discountMinor,
    tax_rate_bps: totals.taxRateBps,
    total_minor: totals.totalMinor,
    notes: String(formData.get("notes") ?? "").trim() || null,
    ...(issue ? { issue_date: issue } : {}),
    ...(kind === "estimate" ? { deposit_minor: Math.min(depositMinor, totals.totalMinor) } : {}),
    updated_at: new Date().toISOString(),
  }).eq("id", id).eq("version", version.version).select("id, version");
  if (upErr) return { ok: false, error: upErr.message };
  if (!saved || saved.length === 0) {
    const { data: now } = await supabase.from(table).select("version").eq("id", id).maybeSingle();
    return { ok: false, error: assertVersionMatch(kind, version.version, now?.version ?? null, { he }).error
      ?? t(locale, "err.invalid") };
  }

  // Replace items.
  await supabase.from(itemsTable).delete().eq(parentKey, id);
  const { error: itErr } = await supabase.from(itemsTable).insert(items.map((it, idx) => ({
    organization_id: profile.organization_id, [parentKey]: id,
    title: it.title, description: it.description || it.title, qty_milli: it.qtyMilli,
    unit_price_minor: it.unitPriceMinor, cost_minor: it.costMinor, taxable: it.taxable, image_path: it.imagePath, sort: idx,
  })));
  if (itErr) return { ok: false, error: itErr.message };
  await saveItemsToLibrary(supabase, profile.organization_id!, items);
  return { ok: true };
}

/** Duplicate an estimate/invoice into a fresh draft with a new number. */
export async function duplicateDocument(
  kind: "estimate" | "invoice", id: string, profile: Profile
): Promise<{ ok: boolean; error?: string; newId?: string; number?: number }> {
  const table = kind === "invoice" ? "invoices" : "estimates";
  const itemsTable = kind === "invoice" ? "invoice_items" : "estimate_items";
  const parentKey = kind === "invoice" ? "invoice_id" : "estimate_id";
  const supabase = await createClient();

  const { data: src } = await supabase.from(table).select("*").eq("id", id).single();
  if (!src) return { ok: false, error: "not found" };
  const { data: items } = await supabase.from(itemsTable).select("*").eq(parentKey, id).order("sort");

  const doc = await insertNumbered(supabase, table, profile.organization_id!, kind, {
    organization_id: profile.organization_id, created_by: profile.id,
    customer_id: src.customer_id, status: kind === "invoice" ? "unpaid" : "draft",
    discount_minor: src.discount_minor, tax_rate_bps: src.tax_rate_bps, total_minor: src.total_minor, notes: src.notes,
    // Carried over deliberately: duplicating an estimate used to silently drop
    // its deposit request, so the copy asked for nothing up front. Reported as a
    // known gap in docs/REMEDIATION-PLAN.md §5.7 and fixed here because this
    // file is in scope for the document-integrity pass.
    ...(kind === "estimate" ? { deposit_minor: src.deposit_minor ?? 0 } : {}),
  });
  if (doc.error || !doc.id) return { ok: false, error: doc.error };
  const number = doc.number;

  if (items && items.length) {
    await supabase.from(itemsTable).insert(items.map((it: any, idx: number) => ({
      organization_id: profile.organization_id, [parentKey]: doc.id,
      title: it.title, description: it.description, qty_milli: it.qty_milli, unit_price_minor: it.unit_price_minor,
      cost_minor: it.cost_minor ?? 0, taxable: it.taxable ?? true, image_path: it.image_path ?? null, sort: idx,
    })));
  }
  return { ok: true, newId: doc.id, number: number as number };
}

/**
 * Soft-delete an estimate/invoice.
 *
 * This used to be the only way to "cancel" an issued invoice, and it is the
 * wrong instrument: the document vanishes from every list and its number
 * vanishes from the sequence with it, so the books show a hole nobody can
 * explain. Deleting is now refused once the document has left the building;
 * voidDocument() is the instrument for that, and it keeps both.
 *
 * The row's number is NOT freed either way — the unique constraint added in
 * migration 036 covers deleted rows on purpose.
 */
export async function softDeleteDocument(
  kind: "estimate" | "invoice", id: string, locale: Locale = "en" as Locale,
): Promise<ActionResult> {
  const table = kind === "invoice" ? "invoices" : "estimates";
  const he = locale === "he";
  const supabase = await createClient();

  const current = await loadIntegrityRow(supabase, kind, table, id);
  if (!current) return { ok: false, error: "not found" };

  const collected = await collectedMinor(supabase, kind, id, (current as any).estimate_id);
  const lock = documentLock(kind, { ...current, collected_minor: collected });
  if (lock.locked && lock.code !== "voided") {
    return {
      ok: false,
      error: he
        ? `לא ניתן למחוק מסמך שכבר נשלח, נחתם או שולם — המספר שלו חייב להישאר ברצף. אפשר לבטל אותו (ביטול שומר את המסמך ואת המספר) או להוציא זיכוי.`
        : `A document that has been sent, signed or paid cannot be deleted — its number has to stay in the sequence. Void it instead (a void keeps the document and its number), or issue a credit note.`,
    };
  }

  const { error } = await supabase.from(table).update({ deleted_at: new Date().toISOString() }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * May this document still be edited in place? Server-side wrapper that adds the
 * one thing the pure rule cannot know: money already collected against it.
 *
 * Used by the edit screens so they do not open an editor whose save is going to
 * be refused. It is NOT the guard — updateDocument re-checks, and migration 036
 * re-checks again in the database, because the threat model is PostgREST.
 */
export async function assertDocumentEditable(
  kind: "estimate" | "invoice", doc: Record<string, any>, locale: Locale = "en" as Locale,
): Promise<{ ok: boolean; code?: string; error?: string }> {
  const supabase = await createClient();
  const collected = await collectedMinor(supabase, kind, String(doc.id ?? ""), doc.estimate_id ?? null);
  return editableRule(kind, { ...doc, collected_minor: collected }, { he: locale === "he" });
}

// ---------------------------------------------------------------------------
// 6a.1 — correcting an issued document.
// ---------------------------------------------------------------------------

/**
 * Record that a document has been put in front of the customer.
 *
 * Nothing in the product tracked this. Estimates had a 'sent' status; invoices
 * had no signal at all, which is precisely why an invoice could be repriced
 * after the customer received it with nobody any the wiser. From this moment
 * the figures are locked and corrections go through a credit note or a void.
 *
 * Setting it is idempotent and one-way: `sent_at` is only written when it is
 * null, and migration 036 refuses to let it be cleared except by the audited
 * estimate reopen.
 */
export async function markDocumentSent(kind: "estimate" | "invoice", id: string): Promise<ActionResult> {
  const table = kind === "invoice" ? "invoices" : "estimates";
  const supabase = await createClient();
  const { error } = await supabase.from(table)
    .update({ sent_at: new Date().toISOString() })
    .eq("id", id).is("sent_at", null).is("deleted_at", null);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * Void a document: cancel it while keeping it, its figures and its NUMBER.
 *
 * This is the answer to "an accountant cannot accept either option". The row is
 * not edited and not deleted; it is marked cancelled, with who did it and why,
 * and migration 036 stops it being signed or paid from that moment on. The
 * number stays in the sequence, so the commonest cause of a missing number
 * shows up as a void rather than as a gap nobody can explain.
 */
export async function voidDocument(
  kind: "estimate" | "invoice", id: string, reason: string, profile: Profile, locale: Locale,
): Promise<ActionResult> {
  const table = kind === "invoice" ? "invoices" : "estimates";
  const he = locale === "he";
  const supabase = await createClient();

  const current = await loadIntegrityRow(supabase, kind, table, id);
  if (!current) return { ok: false, error: t(locale, "err.invalid") };

  const collected = await collectedMinor(supabase, kind, id, (current as any).estimate_id);
  const check = validateVoid(kind, current, { reason, collectedMinor: collected, he });
  if (!check.ok) return { ok: false, error: check.error };

  const { data: saved, error } = await supabase.from(table).update({
    voided_at: new Date().toISOString(),
    void_reason: check.reason,
    voided_by: profile.id,
    ...(kind === "invoice" ? { status: "void" } : {}),
    updated_at: new Date().toISOString(),
  }).eq("id", id).is("voided_at", null).select("id");
  if (error) return { ok: false, error: error.message };
  if (!saved || saved.length === 0) {
    return { ok: false, error: he ? "המסמך כבר בוטל." : "This document is already voided." };
  }
  return { ok: true };
}

/**
 * Reopen a sent estimate (the one audited exit from a lock).
 *
 * An estimate is a negotiation, not a tax document, and re-quoting after
 * sending is ordinary business — locking it with no way back would remove a
 * capability the product already had. The reopen is recorded (who, when, why,
 * and how many times) and returns the estimate to draft. A signed, decided,
 * part-paid or voided estimate cannot be reopened, and an invoice never can.
 */
export async function reopenEstimate(
  id: string, reason: string, profile: Profile, locale: Locale,
): Promise<ActionResult> {
  const he = locale === "he";
  const supabase = await createClient();

  const { data: current } = await (supabase.from("estimates") as any)
    .select(`${INTEGRITY_COLUMNS}, reopen_count`).eq("id", id).maybeSingle();
  if (!current || current.deleted_at) return { ok: false, error: t(locale, "err.invalid") };

  const collected = await collectedMinor(supabase, "estimate", id);
  const check = validateReopen("estimate", current, { reason, collectedMinor: collected, he });
  if (!check.ok) return { ok: false, error: check.error };

  const { error } = await supabase.from("estimates").update({
    sent_at: null,
    status: "draft",
    reopened_at: new Date().toISOString(),
    reopened_by: profile.id,
    reopen_reason: check.reason,
    reopen_count: Number(current.reopen_count ?? 0) + 1,
    updated_at: new Date().toISOString(),
  }).eq("id", id).eq("version", current.version);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export type CreditNote = {
  id: string; number: number; amount_minor: number; reason: string;
  status: string; issue_date: string; created_at: string;
  cancelled_at: string | null; cancel_reason: string | null;
};

/** Every credit note against an invoice, newest first. */
export async function loadCreditNotes(supabase: any, invoiceId: string): Promise<CreditNote[]> {
  const { data } = await supabase.from("credit_notes")
    .select("id, number, amount_minor, reason, status, issue_date, created_at, cancelled_at, cancel_reason")
    .eq("invoice_id", invoiceId).order("number", { ascending: false });
  return (data ?? []) as CreditNote[];
}

/**
 * Issue a credit note against an invoice.
 *
 * The invoice is not touched. The credit note is its own dated, numbered,
 * reasoned document that reduces what the customer owes — which is what an
 * accountant means by correcting an issued invoice, and what neither editing
 * nor deleting could ever be. `invoices.credited_minor` is a derived cache
 * maintained by trigger (migration 036 §5), never written from here.
 *
 * A credit note does NOT move money. If the customer has already paid and the
 * money is going back, that is a refund as well — the two are recorded
 * separately because they are separate events.
 */
export async function issueCreditNote(
  invoiceId: string, amountInput: string, reason: string, profile: Profile, locale: Locale,
): Promise<{ ok: boolean; error?: string; number?: number }> {
  const he = locale === "he";
  const supabase = await createClient();

  const { data: invoice } = await supabase.from("invoices")
    .select("id, number, status, total_minor, voided_at, deleted_at")
    .eq("id", invoiceId).maybeSingle();
  if (!invoice) return { ok: false, error: t(locale, "err.invalid") };

  let amountMinor: number;
  try { amountMinor = parseAmountToMinor(amountInput); }
  catch { return { ok: false, error: he ? "צריך להזין סכום זיכוי." : "Enter a credit amount." }; }

  const notes = await loadCreditNotes(supabase, invoiceId);
  const check = validateCreditNote(invoice, notes, { amountMinor, reason, he });
  if (!check.ok) return { ok: false, error: check.error };

  const allocated = await allocateNumber(supabase, profile.organization_id!, "credit_note");
  if (allocated.error || !allocated.number) return { ok: false, error: allocated.error };

  const { error } = await supabase.from("credit_notes").insert({
    organization_id: profile.organization_id,
    invoice_id: invoiceId,
    number: allocated.number,
    amount_minor: check.amountMinor,
    reason: check.reason,
    created_by: profile.id,
  });
  if (error) {
    await releaseNumber(supabase, profile.organization_id!, "credit_note", allocated.number);
    return { ok: false, error: error.message };
  }
  return { ok: true, number: allocated.number };
}

/**
 * Cancel a credit note issued in error.
 *
 * The row is never deleted: it is marked cancelled with its own reason, so the
 * credit-note sequence has no holes and the mistake stays visible. Same shape
 * as db/030_refunds.sql — corrections are recorded, not erased.
 */
export async function cancelCreditNote(
  noteId: string, reason: string, profile: Profile, locale: Locale,
): Promise<ActionResult> {
  const he = locale === "he";
  const supabase = await createClient();

  const { data: note } = await supabase.from("credit_notes")
    .select("id, status").eq("id", noteId).maybeSingle();
  const check = validateCreditNoteCancel(note ?? {}, { reason, he });
  if (!check.ok) return { ok: false, error: check.error };

  const { error } = await supabase.from("credit_notes").update({
    status: "cancelled",
    cancelled_at: new Date().toISOString(),
    cancelled_by: profile.id,
    cancel_reason: check.reason,
    updated_at: new Date().toISOString(),
  }).eq("id", noteId).eq("status", "issued");
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

async function saveItemsToLibrary(supabase: any, orgId: string, items: LineItem[]) {
  try {
    const { data: existing } = await supabase.from("price_book").select("name").eq("organization_id", orgId);
    const have = new Set((existing ?? []).map((r: any) => String(r.name ?? "").trim().toLowerCase()));
    const seen = new Set<string>();
    const toAdd = items
      .filter((it) => {
        const k = it.title.trim().toLowerCase();
        if (!k || have.has(k) || seen.has(k)) return false;
        seen.add(k); return true;
      })
      .map((it) => ({
        organization_id: orgId, name: it.title, description: it.description || null,
        price_minor: it.unitPriceMinor, cost_minor: it.costMinor, taxable: it.taxable, image_path: it.imagePath,
      }));
    if (toAdd.length) await supabase.from("price_book").insert(toAdd);
  } catch { /* library save is best-effort; never blocks the document */ }
}
