// The one rule every server action call site has to obey: a failed write must
// not look like a successful one.
//
// THE BUG: roughly two dozen client components did
//
//   start(async () => { await someAction(id); router.refresh(); });
//
// The action returns `{ ok, error }`. Discarding it means the spinner stops,
// the page refreshes, and the change is simply not there — no message, nothing
// in the console, nothing the person at the desk can act on. A write that
// silently does nothing is worse than one that throws, because the operator
// believes the record was saved.
//
// This module holds the decision itself so it can be unit-tested without a
// browser; components/ActionStatus.tsx is the thin React wrapper.
//
// Tests: tests/action-result.test.mjs

/** The message shown when an action fails without saying why. */
export function fallbackMessage(he) {
  return he
    ? "לא הצלחנו לשמור את השינוי. אפשר לנסות שוב."
    : "We couldn't save that change. Please try again.";
}

/**
 * Given whatever a server action returned, decide what to show the user.
 *
 * Returns the message to display, or `null` when the write succeeded.
 *
 * Deliberately treats an absent/`void` result as success: several actions
 * predate the `{ ok, error }` contract, and inventing a failure for them would
 * be its own bug — a guard that cries wolf gets ignored, which puts us back
 * where we started.
 */
export function actionFailureMessage(result, he = false) {
  if (result === null || result === undefined) return null;
  if (typeof result !== "object") return null;
  if (result.ok === false) return String(result.error || "").trim() || fallbackMessage(he);
  return null;
}

/** True when the result represents a write that did not happen. */
export function actionFailed(result) {
  return actionFailureMessage(result, false) !== null;
}
