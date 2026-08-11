import type { ButtonHTMLAttributes } from "react";
import { cx } from "./cx";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "quiet";
export type ButtonSize = "sm" | "md" | "lg";

export type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Escape hatch for a caller that still needs one extra class. */
  className?: string;
};

/**
 * Replaces the ~33 copies of `const btn: React.CSSProperties` that were
 * copy-pasted between files, most of them byte-identical.
 *
 * `type` defaults to "button" rather than being left to the browser. 174 of the
 * app's 315 buttons used to have no type, which inside a form means "delete
 * this row" submits the form (ledger 6.6). A primitive that defaulted the other
 * way would put that defect back in one place.
 */
export default function Button({
  variant = "primary",
  size = "lg",
  className,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        "sp-btn",
        variant !== "primary" && `sp-btn--${variant}`,
        size !== "lg" && `sp-btn--${size}`,
        className,
      )}
      {...rest}
    />
  );
}
