// ---------------------------------------------------------------------------
//  Postgres error classification — pure, no I/O.
//
//  Two SQLSTATEs carry meaning the user needs to see, and both were being
//  mishandled:
//    * 23505 unique_violation — the database refused a duplicate we were racing
//      to create. That is the constraint doing its job, not a failure to report
//      (clockIn double-click, recurring plan generated twice).
//    * 23P01 exclusion_violation — jobs_no_double_book refused to book a
//      technician over an existing appointment. Collapsing that into "we
//      couldn't update that assignment" leaves the dispatcher guessing.
// ---------------------------------------------------------------------------

/** Read the SQLSTATE off whatever shape the client handed us. */
export function errorCode(error) {
  if (!error) return null;
  if (typeof error === "string") return error;
  const code = /** @type {{ code?: unknown }} */ (error).code;
  return typeof code === "string" ? code : null;
}

/** 23505 — a unique index refused a duplicate row. */
export function isUniqueViolation(error) {
  return errorCode(error) === "23505";
}

/** 23P01 — an exclusion constraint refused an overlapping booking. */
export function isDoubleBookConflict(error) {
  return errorCode(error) === "23P01";
}
