"use client";

import { useCallback, useState, useTransition } from "react";
// @ts-ignore — pure decision logic, unit-tested directly by node:test.
import { actionFailureMessage, fallbackMessage } from "@/lib/core/action-result.mjs";

export type ActionOutcome = { ok?: boolean; error?: string } | void | null | undefined;

/**
 * Run a server action inside a transition and keep whatever went wrong.
 *
 * Replaces the `start(async () => { await action(); router.refresh(); })`
 * shape, which threw the `{ ok, error }` contract away and made a rejected
 * write indistinguishable from a saved one.
 */
export function useActionStatus(he = false) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    (task: () => Promise<ActionOutcome>, onSuccess?: () => void, onFailure?: () => void) => {
      setError(null);
      start(async () => {
        let result: ActionOutcome;
        try {
          result = await task();
        } catch {
          // A thrown action (network drop, redeploy mid-flight) is a failed
          // write too, and used to vanish just as quietly.
          setError(fallbackMessage(he));
          onFailure?.();
          return;
        }
        const failure = actionFailureMessage(result, he);
        if (failure) {
          setError(failure);
          // Lets an optimistic list roll back instead of showing a change the
          // database refused.
          onFailure?.();
          return;
        }
        onSuccess?.();
      });
    },
    [he],
  );

  return { pending, error, setError, run };
}

/** Inline error banner. Rendered where the person is working, not in a console. */
export function ActionError({ error, style }: { error: string | null; style?: React.CSSProperties }) {
  if (!error) return null;
  return (
    <div role="alert" style={{ ...errorBox, ...style }}>
      {error}
    </div>
  );
}

const errorBox: React.CSSProperties = {
  background: "#fdeaea",
  color: "#dc2626",
  padding: "9px 12px",
  borderRadius: 10,
  fontSize: "0.8125rem",
  fontWeight: 600,
  marginTop: 8,
};
