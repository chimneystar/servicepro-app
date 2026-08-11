import type { ReactNode } from "react";

/**
 * A form control MUST carry an accessible name, and this type is how that is
 * enforced before the code runs.
 *
 * The measurement behind it: 241 of 402 form controls in this product had no
 * programmatic label at all (ledger 6.6). Those were fixed one call site at a
 * time, which works exactly until the next call site. Routing every control
 * through a primitive whose props do not typecheck without a name turns "please
 * remember to label it" into a build error.
 *
 * The three arms are mutually exclusive on purpose. `label` renders a wrapping
 * `<label>`, which is association with no `id` to collide; `aria-label` and
 * `aria-labelledby` are for the cases where the visible label already exists
 * somewhere this component cannot reach. Allowing `label` together with
 * `aria-label` would let a Hebrew visible label sit under an English
 * announced one, which is the failure mode this product is most exposed to.
 */
export type Named =
  | { label: ReactNode; "aria-label"?: never; "aria-labelledby"?: never }
  | { label?: never; "aria-label": string; "aria-labelledby"?: never }
  | { label?: never; "aria-label"?: never; "aria-labelledby": string };
