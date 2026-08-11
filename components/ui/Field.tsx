import type { LabelHTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";

export type FieldProps = Omit<LabelHTMLAttributes<HTMLLabelElement>, "className"> & {
  label: ReactNode;
  className?: string;
  children: ReactNode;
};

/**
 * A label wrapped around whatever control the caller has to render by hand —
 * a native checkbox, a third-party widget, a group of radios.
 *
 * Input / Select / Textarea already do this internally; Field is the escape
 * hatch that keeps the association guarantee for the cases they do not cover.
 * It WRAPS rather than pairing an `id` with `htmlFor` because a wrapping label
 * is association with no id to collide, and this product renders these inside
 * `.map()` far more often than not.
 */
export default function Field({ label, className, children, ...rest }: FieldProps) {
  return (
    <label className={cx("sp-field", className)} {...rest}>
      <span className="sp-label">{label}</span>
      {children}
    </label>
  );
}

/** The label text on its own, for a caller that owns the association already. */
export function Label({
  className,
  ...rest
}: Omit<LabelHTMLAttributes<HTMLLabelElement>, "className"> & { className?: string }) {
  return <span className={cx("sp-label", className)} {...rest} />;
}
