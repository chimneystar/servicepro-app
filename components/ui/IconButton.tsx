import type { ButtonHTMLAttributes } from "react";
import { cx } from "./cx";

export type IconButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "className" | "aria-label"
> & {
  /**
   * Required, and required as a STRING. An icon-only control whose whole label
   * is a glyph announces as "button" and nothing else; this is the one place in
   * the design system where the accessible name has no visible fallback at all,
   * so it is not optional and cannot be satisfied by a node.
   */
  "aria-label": string;
  className?: string;
};

/** The small square "remove this row" control — `const xBtn`, six copies. */
export default function IconButton({ className, type = "button", ...rest }: IconButtonProps) {
  return <button type={type} className={cx("sp-icon-btn", className)} {...rest} />;
}
