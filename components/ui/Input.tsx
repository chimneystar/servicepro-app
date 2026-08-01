import type { InputHTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";
import type { Named } from "./Named";

type Base = Omit<InputHTMLAttributes<HTMLInputElement>, "className" | "size"> & {
  className?: string;
  /** Bumps the control to the 1rem type step — the other size in the product. */
  large?: boolean;
  /** Rendered under the control, inside the same <label>. */
  hint?: ReactNode;
};

export type InputProps = Base & Named;

/**
 * Replaces the ~36 copies of `const inp: React.CSSProperties`.
 *
 * When `label` is given the control is WRAPPED in its label, so the association
 * cannot be broken by an id collision or by someone moving the markup. The
 * `Named` union makes a nameless `<Input />` a type error.
 */
export default function Input({
  label,
  className,
  large,
  hint,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  ...rest
}: InputProps) {
  const cls = cx("sp-input", large && "sp-control--lg", className);
  // Written as two branches rather than one shared element so that the
  // accessible name is visible in the source of this file — see Select.
  if (label === undefined) {
    return (
      <input className={cls} aria-label={ariaLabel} aria-labelledby={ariaLabelledBy} {...rest} />
    );
  }
  return (
    <label className="sp-field">
      <span className="sp-label">{label}</span>
      <input className={cls} {...rest} />
      {hint ? <span className="sp-text-subtle">{hint}</span> : null}
    </label>
  );
}
