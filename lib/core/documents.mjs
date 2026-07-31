// Document integrity: locking, versioning, voiding and credit notes.
//
// WHY THIS MODULE EXISTS
//
// Four defects in the same family, all of them about a financial record that
// could be changed after the customer had already seen it:
//
//   6a.1  There was no way to CORRECT an issued invoice. The only two options
//         were edit-in-place (which rewrites a document the customer already
//         holds a copy of) and soft-delete (which erases the number from the
//         sequence). An accountant can accept neither.
//   6a.3  next_document_number() bumped a counter and returned it BEFORE the
//         row insert, so a failed insert burned a number for ever.
//   6a.5  updateInvoice had no status guard at all: a sent, signed or PAID
//         invoice's line items and total could still be rewritten, and the
//         customer's public /p/<token> link would then show different figures
//         than the ones they approved.
//   6a.6  No version column existed anywhere in the schema, so two office users
//         editing the same estimate silently last-write-wins.
//
// The rules live here — pure, no database, no React — so they are unit-tested
// rather than reasoned about, and so the server action and the database trigger
// in db/036_document_integrity.sql can be checked against ONE definition of
// "financially material".
//
// Tests: tests/document-integrity.test.mjs

const int = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
};

const text = (value) => String(value ?? "").trim();

/**
 * The columns whose value the customer relies on. Once a document is locked
 * these may not change; everything else (internal notes, status transitions,
 * the void marker itself) still may.
 *
 * db/036_document_integrity.sql enforces the SAME list in a BEFORE UPDATE
 * trigger, and tests/document-integrity.test.mjs asserts the two agree — a
 * server-side guard alone would be bypassed by anyone talking straight to
 * PostgREST with the anon key, which is the threat model for this branch.
 */
export const MATERIAL_FIELDS = Object.freeze([
  "customer_id",
  "discount_minor",
  "tax_rate_bps",
  "total_minor",
  "issue_date",
  "deposit_minor",
]);

/** Why a document is locked. Ordered by precedence, strongest first. */
export const LOCK_CODES = Object.freeze({
  VOIDED: "voided",
  PAID: "paid",
  COLLECTED: "collected",
  SIGNED: "signed",
  DECIDED: "decided",
  SENT: "sent",
});

/** The shortest reason we will accept on a void, a credit note or a reopen. */
export const MIN_REASON_LENGTH = 5;

const REASONS = {
  voided: {
    en: "This document has been voided.",
    he: "המסמך בוטל.",
  },
  paid: {
    en: "This invoice is marked paid.",
    he: "החשבונית מסומנת כשולמה.",
  },
  collected: {
    en: "Money has already been collected against this document.",
    he: "כבר נגבה כסף כנגד המסמך הזה.",
  },
  signed: {
    en: "The customer has already signed this document.",
    he: "הלקוח כבר חתם על המסמך הזה.",
  },
  decided: {
    en: "The customer has already approved or rejected this estimate.",
    he: "הלקוח כבר אישר או דחה את הצעת המחיר הזו.",
  },
  sent: {
    en: "This document has already been sent to the customer.",
    he: "המסמך כבר נשלח ללקוח.",
  },
};

const REMEDIES = {
  invoice: {
    en: "Issue a credit note or void it — the original invoice and its number stay exactly as the customer received them.",
    he: "אפשר להוציא זיכוי או לבטל — החשבונית המקורית והמספר שלה נשמרים בדיוק כפי שהלקוח קיבל אותם.",
  },
  estimate: {
    en: "Reopen it first (that is recorded, with your reason), or duplicate it into a new estimate.",
    he: "צריך לפתוח אותה מחדש (הפעולה נרשמת יחד עם הסיבה), או לשכפל אותה להצעה חדשה.",
  },
  voided: {
    en: "A voided document cannot be edited. Duplicate it if you need a replacement.",
    he: "מסמך שבוטל אינו ניתן לעריכה. אפשר לשכפל אותו אם צריך מסמך חלופי.",
  },
};

const pick = (bundle, he) => (he ? bundle.he : bundle.en);

const normalizeKind = (kind) => (String(kind) === "invoice" ? "invoice" : "estimate");

/**
 * Is this document locked against edits to its financially material fields,
 * and if so why?
 *
 * `doc` is a plain row-shaped object; the extra `collected_minor` is what the
 * caller has already worked out from settled payments (a deposit paid against
 * an estimate counts, which is why estimates are checked for it too).
 */
export function documentLock(kind, doc = {}) {
  const k = normalizeKind(kind);
  const status = String(doc?.status ?? "").toLowerCase();
  const collected = Math.max(0, int(doc?.collected_minor));
  const at = (code) => ({ locked: true, code, kind: k });

  if (doc?.voided_at) return at(LOCK_CODES.VOIDED);
  if (k === "invoice") {
    if (status === "void") return at(LOCK_CODES.VOIDED);
    if (status === "paid" || doc?.paid_at) return at(LOCK_CODES.PAID);
  }
  if (collected > 0) return at(LOCK_CODES.COLLECTED);
  if (doc?.signed_at) return at(LOCK_CODES.SIGNED);
  if (k === "estimate" && (status === "approved" || status === "rejected")) return at(LOCK_CODES.DECIDED);
  if (doc?.sent_at || (k === "estimate" && status === "sent")) return at(LOCK_CODES.SENT);
  return { locked: false, code: null, kind: k };
}

/** Convenience predicate over {@link documentLock}. */
export function isDocumentLocked(kind, doc = {}) {
  return documentLock(kind, doc).locked;
}

/**
 * May this document's money still be edited in place?
 *
 * Returns `{ ok: true }` or `{ ok: false, code, error }` — never throws, so the
 * caller shows a sentence rather than a stack trace. The sentence always says
 * BOTH what happened and what to do instead: a lock with no exit is how people
 * end up editing rows in the database by hand, which is the failure this whole
 * item exists to prevent.
 */
export function assertDocumentEditable(kind, doc = {}, { he = false } = {}) {
  const lock = documentLock(kind, doc);
  if (!lock.locked) return { ok: true };
  const remedy = lock.code === LOCK_CODES.VOIDED ? REMEDIES.voided : REMEDIES[lock.kind];
  return {
    ok: false,
    code: lock.code,
    error: `${pick(REASONS[lock.code], he)} ${pick(remedy, he)}`,
  };
}

// ---------------------------------------------------------------------------
// 6a.6 — optimistic concurrency
// ---------------------------------------------------------------------------

/** Read a version out of a form field. Returns null when it is not a version. */
export function parseVersion(raw) {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) && n >= 1 ? n : null;
}

/**
 * Compare the version the editor loaded with the version now in the database.
 *
 * The message deliberately names both numbers and states plainly that nothing
 * was saved. "Something went wrong" would leave the user unsure whether to
 * retype their work, and a silent overwrite is the bug being fixed.
 */
export function assertVersionMatch(kind, loaded, current, { he = false } = {}) {
  const k = normalizeKind(kind);
  const want = parseVersion(loaded);
  if (want === null) {
    return {
      ok: false,
      code: "version_missing",
      error: he
        ? "לא נשלחה גרסת המסמך, ולכן לא ניתן לוודא שאף אחד אחר לא ערך אותו. יש לרענן את הדף ולנסות שוב."
        : "The document version was not submitted, so we cannot tell whether someone else edited it. Reload the page and try again.",
    };
  }
  const have = parseVersion(current);
  if (have === null) return { ok: true, version: want };
  if (have === want) return { ok: true, version: want };
  const noun = k === "invoice" ? { en: "invoice", he: "החשבונית" } : { en: "estimate", he: "הצעת המחיר" };
  return {
    ok: false,
    code: "stale_write",
    error: he
      ? `${noun.he} נערכה על ידי מישהו אחר בזמן שערכת אותה (טענת גרסה ${want}, כעת היא גרסה ${have}). השינויים שלך לא נשמרו. יש לרענן כדי לראות את הגרסה הנוכחית.`
      : `This ${noun.en} was changed by someone else while you were editing it (you loaded version ${want}, it is now version ${have}). Your changes were NOT saved. Reload to see the current version.`,
  };
}

// ---------------------------------------------------------------------------
// 6a.3 — document numbering
// ---------------------------------------------------------------------------

/**
 * THE NUMBERING DECISION, stated once so it cannot drift.
 *
 * Gaps are ACCEPTED. Numbers are NEVER reused.
 *
 * Why: a reused number puts two different documents with the same number into
 * two different customers' hands, and no filing can untangle that afterwards.
 * A gap is merely a question, and a question that can be answered is fine —
 * which is why voiding preserves the number and its row rather than deleting
 * it, so the overwhelmingly common cause of a "missing" number ("we cancelled
 * that one") shows up in the sequence as a void rather than as nothing at all.
 *
 * Gaps are also made rare rather than merely tolerated: a number is allocated
 * immediately before the insert, and if the insert then fails the number is
 * handed back by an exact compare-and-set (see releaseDocumentNumber /
 * public.release_document_number) — it is returned only if no one else has
 * taken a number in the meantime, so the release can never hand the same
 * number to two documents.
 */
export const NUMBERING_POLICY = Object.freeze({
  reuseBurnedNumbers: false,
  gapsAllowed: true,
  voidPreservesNumber: true,
  releaseOnFailedInsert: "compare-and-set",
});

/**
 * The number a fresh allocation must produce.
 *
 * Mirrors the body of public.next_document_number() after migration 036: the
 * stored counter alone is not enough, because /settings lets an owner set the
 * next number by hand and setting it BACKWARDS would otherwise mint a number a
 * document already holds. Taking the max of the counter and the highest number
 * actually in use makes a collision impossible instead of merely rejected.
 */
export function nextAllocationFrom(counter, highestUsed) {
  return Math.max(int(counter), int(highestUsed), 0) + 1;
}

/**
 * May a burned number be handed back?
 *
 * Only when the counter still stands exactly where this allocation left it. If
 * anyone else has allocated since, rolling back would re-issue our number to a
 * second document — the one outcome the policy forbids.
 */
export function shouldReleaseDocumentNumber(counterNow, allocated) {
  const now = parseVersion(counterNow);
  const mine = parseVersion(allocated);
  return now !== null && mine !== null && now === mine;
}

/** True for a PostgreSQL unique-violation, whatever wrapper it arrived in. */
export function isUniqueViolation(error) {
  if (!error) return false;
  const code = String(error.code ?? error?.error?.code ?? "");
  if (code === "23505") return true;
  return /duplicate key value violates unique constraint/i.test(String(error.message ?? ""));
}

/** How many times to re-allocate and retry an insert that hit a collision. */
export const NUMBER_COLLISION_RETRIES = 3;

// ---------------------------------------------------------------------------
// 6a.1 — void
// ---------------------------------------------------------------------------

function reasonProblem(reason, he) {
  const value = text(reason);
  if (value.length >= MIN_REASON_LENGTH) return null;
  return he
    ? `צריך לכתוב סיבה (לפחות ${MIN_REASON_LENGTH} תווים). הסיבה נשמרת לצמיתות על המסמך.`
    : `Give a reason (at least ${MIN_REASON_LENGTH} characters). It is kept on the document permanently.`;
}

/**
 * May this document be voided, and is the reason good enough?
 *
 * A void CANCELS a document while keeping it, its number and its figures
 * exactly as they were. It is therefore only right while nothing has been
 * collected: once money has changed hands the correct instrument is a credit
 * note, which records the reduction as its own dated, numbered document rather
 * than pretending the sale never happened.
 */
export function validateVoid(kind, doc = {}, { reason = "", collectedMinor = 0, he = false } = {}) {
  const k = normalizeKind(kind);
  if (doc?.deleted_at) {
    return { ok: false, code: "deleted", error: he ? "המסמך נמחק." : "This document has been deleted." };
  }
  if (doc?.voided_at || (k === "invoice" && String(doc?.status ?? "") === "void")) {
    return {
      ok: false,
      code: "already_void",
      error: he ? "המסמך כבר בוטל." : "This document is already voided.",
    };
  }
  const collected = Math.max(0, int(collectedMinor));
  if (collected > 0) {
    return {
      ok: false,
      code: "money_collected",
      error: he
        ? `לא ניתן לבטל מסמך שכבר נגבה כנגדו כסף (${(collected / 100).toFixed(2)}). צריך להוציא זיכוי, ולהחזיר את הכסף אם צריך.`
        : `A document that has already collected money (${(collected / 100).toFixed(2)}) cannot be voided. Issue a credit note instead, and refund the money if it is going back.`,
    };
  }
  const problem = reasonProblem(reason, he);
  if (problem) return { ok: false, code: "reason_required", error: problem };
  return { ok: true, reason: text(reason) };
}

// ---------------------------------------------------------------------------
// 6a.1 — credit notes
// ---------------------------------------------------------------------------

/** Credit notes that still count. A cancelled note is history, not a credit. */
export const ACTIVE_CREDIT_STATUS = "issued";

export function issuedCreditsMinor(creditNotes) {
  return (creditNotes ?? [])
    .filter((n) => String(n?.status ?? ACTIVE_CREDIT_STATUS) === ACTIVE_CREDIT_STATUS)
    .reduce((sum, n) => sum + Math.max(0, int(n?.amount_minor)), 0);
}

/** How much of this invoice has not yet been credited away. */
export function remainingCreditableMinor(invoice = {}, creditNotes = []) {
  return Math.max(0, int(invoice?.total_minor) - issuedCreditsMinor(creditNotes));
}

/**
 * What the customer still owes: the invoice, less what was credited, less what
 * was collected. Credits come off the bill, not off the money received — a
 * credit note reduces the debt, it does not un-receive a payment.
 */
export function invoiceOutstandingMinor(invoice = {}, { collectedMinor = 0, creditNotes = [] } = {}) {
  const billed = remainingCreditableMinor(invoice, creditNotes);
  return Math.max(0, billed - Math.max(0, int(collectedMinor)));
}

/**
 * Validate a credit note against the invoice it corrects.
 *
 * The ceiling is the invoice total minus credits already issued. Allowing more
 * would turn the receivable negative, which every downstream reader would
 * report as revenue the business never had.
 */
export function validateCreditNote(invoice = {}, creditNotes = [], { amountMinor = 0, reason = "", he = false } = {}) {
  if (!invoice || invoice.deleted_at) {
    return { ok: false, code: "not_found", error: he ? "החשבונית לא נמצאה." : "That invoice was not found." };
  }
  if (invoice.voided_at || String(invoice.status ?? "") === "void") {
    return {
      ok: false,
      code: "voided",
      error: he
        ? "החשבונית בוטלה, ולכן אין מה לזכות."
        : "This invoice was voided, so there is nothing left to credit.",
    };
  }
  // Deliberately NOT coerced from a string. Everything upstream goes through
  // parseAmountToMinor, and silently accepting "50" would read fifty DOLLARS as
  // fifty cents — the exact class of float/units bug tests/money.test.mjs
  // exists to keep out of this codebase.
  const amount = typeof amountMinor === "number" ? amountMinor : NaN;
  if (!Number.isFinite(amount) || !Number.isInteger(amount)) {
    return { ok: false, code: "invalid_amount", error: he ? "צריך להזין סכום זיכוי." : "Enter a credit amount." };
  }
  if (amount <= 0) {
    return {
      ok: false,
      code: "invalid_amount",
      error: he ? "סכום הזיכוי חייב להיות גדול מאפס." : "A credit note must be greater than zero.",
    };
  }
  const remaining = remainingCreditableMinor(invoice, creditNotes);
  if (remaining <= 0) {
    return {
      ok: false,
      code: "fully_credited",
      error: he ? "החשבונית הזו כבר זוכתה במלואה." : "This invoice has already been credited in full.",
    };
  }
  if (amount > remaining) {
    return {
      ok: false,
      code: "exceeds_invoice",
      error: he
        ? `זה יותר ממה שנותר לזכות בחשבונית הזו (${(remaining / 100).toFixed(2)} זמין).`
        : `That is more than remains on this invoice (${(remaining / 100).toFixed(2)} available).`,
    };
  }
  const problem = reasonProblem(reason, he);
  if (problem) return { ok: false, code: "reason_required", error: problem };
  return { ok: true, amountMinor: amount, reason: text(reason) };
}

/**
 * Cancelling a credit note issued in error.
 *
 * The row is NOT deleted — it is marked cancelled with its own reason, so the
 * credit-note sequence has no holes either. This is the same shape as
 * db/030_refunds.sql: corrections are recorded, never erased.
 */
export function validateCreditNoteCancel(note = {}, { reason = "", he = false } = {}) {
  if (!note || !note.id) {
    return { ok: false, code: "not_found", error: he ? "הזיכוי לא נמצא." : "That credit note was not found." };
  }
  if (String(note.status ?? ACTIVE_CREDIT_STATUS) !== ACTIVE_CREDIT_STATUS) {
    return { ok: false, code: "already_cancelled", error: he ? "הזיכוי כבר בוטל." : "That credit note is already cancelled." };
  }
  const problem = reasonProblem(reason, he);
  if (problem) return { ok: false, code: "reason_required", error: problem };
  return { ok: true, reason: text(reason) };
}

// ---------------------------------------------------------------------------
// 6a.5 — the one exit from a lock that does NOT need a credit note
// ---------------------------------------------------------------------------

/** Lock states an estimate can be brought back from, with a reason on record. */
export const REOPENABLE_LOCK_CODES = Object.freeze([LOCK_CODES.SENT, LOCK_CODES.DECIDED]);

/**
 * Would a reopen be allowed if a good reason were given?
 *
 * Separate from validateReopen so a screen can decide whether to OFFER the
 * button without inventing a placeholder reason to ask with.
 */
export function canReopen(kind, doc = {}, { collectedMinor = 0 } = {}) {
  if (normalizeKind(kind) !== "estimate") return false;
  const lock = documentLock("estimate", { ...doc, collected_minor: collectedMinor });
  return lock.locked && REOPENABLE_LOCK_CODES.includes(lock.code);
}

/**
 * Reopening an estimate.
 *
 * An estimate is a negotiation, not a tax document: re-quoting after sending —
 * or after the customer said no, or said yes and then changed the scope — is
 * ordinary business, and locking it with no way back would remove a capability
 * the product already had (docs/FEATURE-INVENTORY.md lists estimate editing as
 * REAL, and the status dropdown already allowed approved → draft). So a SENT,
 * APPROVED or REJECTED estimate can be reopened — recorded, attributed and with
 * a reason — which returns it to draft.
 *
 * A SIGNED estimate cannot: the customer put their name to those figures. Nor
 * can a voided or part-paid one, and an invoice never can at all.
 */
export function validateReopen(kind, doc = {}, { reason = "", collectedMinor = 0, he = false } = {}) {
  if (normalizeKind(kind) !== "estimate") {
    return {
      ok: false,
      code: "not_reopenable",
      error: he
        ? "לא ניתן לפתוח מחדש חשבונית. תיקון נעשה באמצעות זיכוי או ביטול."
        : "An invoice cannot be reopened. Correct it with a credit note, or void it.",
    };
  }
  const lock = documentLock("estimate", { ...doc, collected_minor: collectedMinor });
  if (!lock.locked) {
    return {
      ok: false,
      code: "not_locked",
      error: he ? "הצעת המחיר אינה נעולה — אפשר לערוך אותה ישירות." : "This estimate is not locked; you can edit it directly.",
    };
  }
  if (!REOPENABLE_LOCK_CODES.includes(lock.code)) {
    return {
      ok: false,
      code: lock.code,
      error: `${pick(REASONS[lock.code], he)} ${
        he
          ? "לא ניתן לפתוח אותה מחדש. אפשר לשכפל אותה להצעה חדשה."
          : "It cannot be reopened. Duplicate it into a new estimate instead."
      }`,
    };
  }
  const problem = reasonProblem(reason, he);
  if (problem) return { ok: false, code: "reason_required", error: problem };
  return { ok: true, reason: text(reason) };
}
