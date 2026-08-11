"use client";

import { useActionState } from "react";

export type ActionResult = { ok: boolean; error?: string };
type FormAction = (state: ActionResult, data: FormData) => Promise<ActionResult>;

const initial: ActionResult = { ok: false };

/**
 * A `<form>` that shows what the server action actually said.
 *
 * The Operations and Growth screens rendered plain `<form action={serverAction}>`
 * against actions that returned `void`. On a rejected insert the form cleared
 * and the page revalidated, which reads exactly like success — the new crew,
 * vendor, purchase order or campaign was simply missing and nothing said why.
 *
 * Children are passed through untouched (they are server-rendered), so the
 * markup of every field and button is unchanged; only the status line is new.
 */
export default function ActionForm({
  action,
  className,
  children,
  successLabel,
}: {
  action: FormAction;
  className?: string;
  children: React.ReactNode;
  successLabel: string;
}) {
  const [state, formAction] = useActionState(action, initial);
  return (
    <form action={formAction} className={className}>
      {children}
      {state.error && (
        <span className="form-error" role="alert">
          {state.error}
        </span>
      )}
      {state.ok && (
        <span className="ops-success" role="status">
          ✓ {successLabel}
        </span>
      )}
    </form>
  );
}
