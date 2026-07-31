/**
 * Recovery rules for soft-deleted records (ledger 6a.4).
 *
 * `deleted_at` was written by four different code paths and honoured on every
 * read, but nothing in the product could LIST or RESTORE a soft-deleted row.
 * The data was still there and no screen could reach it.
 *
 * This module holds the part of "can this be restored?" that is pure decision,
 * so it can be proven in both directions without a database. The same rules are
 * ALSO enforced by triggers in db/037_recovery.sql — the check here gives the
 * user a readable reason before the write; the trigger closes the race between
 * the check and the write, and covers any other caller.
 *
 * THE RESTORE-CONSISTENCY RULE (chosen deliberately, stated in full):
 *
 *   1. Parent-first, never cascade down. A job, estimate or invoice may be
 *      restored only when every parent it points at is currently live. An
 *      invoice restored beside a still-deleted customer would appear in the
 *      ledger attached to a customer no screen can open — a record that looks
 *      whole and is not. Restoring a parent does NOT drag its children back,
 *      because they were deleted by separate decisions and silently reviving
 *      them would be its own surprise.
 *
 *   2. A customer erased to satisfy a completed privacy DELETION request is
 *      never restorable. That erasure is a legal obligation, not a mistake, and
 *      an undo button on it is a compliance hole. (The identifying fields were
 *      overwritten anyway — "restoring" would produce a shell named
 *      "Deleted customer · 1a2b3c4d" and nothing more.)
 *
 *   3. A job whose slot is now occupied cannot be restored. The database
 *      exclusion constraint `jobs_no_double_book` is the authority; this module
 *      only translates its error code into a sentence a dispatcher can act on.
 */

/** The four tables that carry `deleted_at` and therefore need a trash screen. */
export const RECOVERABLE_KINDS = ["customer", "job", "estimate", "invoice"];

/** kind -> table name. Verified against db/001_schema.sql. */
export const KIND_TABLE = {
  customer: "customers",
  job: "jobs",
  estimate: "estimates",
  invoice: "invoices",
};

/** Deleting any of these is owner/office only, so restoring them must be too. */
export const RESTORE_ROLES = ["owner", "office"];

export function isRecoverableKind(kind) {
  return RECOVERABLE_KINDS.includes(kind);
}

export function tableForKind(kind) {
  return isRecoverableKind(kind) ? KIND_TABLE[kind] : null;
}

/** A parent reference is a blocker when it is missing entirely or still deleted. */
function parentBlocker(code, label, parent) {
  if (parent == null) {
    return {
      code,
      label,
      reason: "missing",
      message: `The ${label} this record belongs to no longer exists.`,
    };
  }
  if (parent.deleted) {
    return {
      code,
      label,
      reason: "deleted",
      name: parent.name ?? null,
      message: `Restore the ${label}${parent.name ? ` “${parent.name}”` : ""} first — restoring this on its own would attach it to a record no screen can open.`,
    };
  }
  return null;
}

/**
 * Everything standing between this row and a clean restore.
 *
 * @param {string} kind         one of RECOVERABLE_KINDS
 * @param {object} context
 *   deleted        {boolean} is the row actually soft-deleted right now
 *   privacyErased  {boolean} customer only: a completed privacy deletion request exists
 *   customer       {{deleted:boolean,name?:string}|null|undefined} parent customer, for non-customer kinds
 *   job            {{deleted:boolean,name?:string}|null|undefined} invoice only, when invoices.job_id is set
 *   estimate       {{deleted:boolean,name?:string}|null|undefined} invoice only, when invoices.estimate_id is set
 * @returns {Array<{code:string,message:string}>} empty means restorable
 */
export function restoreBlockers(kind, context = {}) {
  if (!isRecoverableKind(kind)) {
    return [{ code: "unknown_kind", message: "That kind of record cannot be restored." }];
  }
  const blockers = [];

  if (context.deleted === false) {
    blockers.push({ code: "not_deleted", message: "This record is not in the trash." });
    return blockers; // nothing else is meaningful once the premise is wrong
  }

  if (kind === "customer") {
    if (context.privacyErased) {
      blockers.push({
        code: "privacy_erased",
        message:
          "This customer was erased to satisfy a privacy deletion request. That erasure is a legal obligation and cannot be undone here.",
      });
    }
    return blockers;
  }

  const customer = parentBlocker("parent_customer_deleted", "customer", context.customer);
  if (customer) blockers.push(customer);

  if (kind === "invoice") {
    // `job_id` and `estimate_id` are both nullable on public.invoices. The KEY
    // being present is what says "this invoice references one" — a null VALUE
    // means the referenced row could not be found, which is itself a blocker.
    // (Reading `context.job == null` as "no job" would make a dangling
    // reference restore silently, the exact failure this rule exists to stop.)
    if (Object.prototype.hasOwnProperty.call(context, "job")) {
      const job = parentBlocker("parent_job_deleted", "job", context.job);
      if (job) blockers.push(job);
    }
    if (Object.prototype.hasOwnProperty.call(context, "estimate")) {
      const estimate = parentBlocker("parent_estimate_deleted", "estimate", context.estimate);
      if (estimate) blockers.push(estimate);
    }
  }

  return blockers;
}

/** Convenience: true when nothing stands in the way. */
export function canRestore(kind, context = {}) {
  return restoreBlockers(kind, context).length === 0;
}

/**
 * Turn whatever Postgres threw into something a dispatcher can act on.
 * A raw "23P01" or "restore_parent_deleted" in a toast is not an explanation.
 */
export function restoreFailureMessage(error) {
  const code = String(error?.code ?? "");
  const text = String(error?.message ?? error ?? "");

  if (code === "23P01" || /jobs_no_double_book|exclusion constraint/i.test(text)) {
    return {
      code: "double_booked",
      message:
        "That technician is already booked for this time slot. Move or unassign the conflicting job, then restore this one.",
    };
  }
  if (/restore_privacy_erased/.test(text)) {
    return {
      code: "privacy_erased",
      message: "This customer was erased under a privacy deletion request and cannot be restored.",
    };
  }
  if (/restore_parent_deleted/.test(text)) {
    return {
      code: "parent_deleted",
      message: "Restore the customer (and the job, for an invoice) this record belongs to first.",
    };
  }
  if (
    code === "42501" ||
    /permission denied|row-level security|insufficient_privilege/i.test(text)
  ) {
    return { code: "forbidden", message: "You do not have permission to restore this record." };
  }
  return { code: "restore_failed", message: "Restore failed. Nothing was changed." };
}
