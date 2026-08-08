import type { AnchorHTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";

export type TextLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "className"> & {
  className?: string;
  /**
   * Required. `jsx-a11y/anchor-has-content` refused this component while the
   * children arrived through a spread, and it was right to: a link with no text
   * is announced as its own href. Naming the prop makes "a link says what it
   * links to" a type error rather than a review note.
   */
  children: ReactNode;
};

/**
 * `color:#2563eb; font-weight:700; font-size:0.875rem; text-decoration:none` —
 * nineteen exact copies, most of them the "back to ..." link at the top of a
 * detail screen.
 *
 * Named TextLink rather than Link so it cannot be confused with next/link at an
 * import site; this one is a plain anchor and does not prefetch.
 */
export default function TextLink({ className, children, ...rest }: TextLinkProps) {
  return (
    <a className={cx("sp-link", className)} {...rest}>
      {children}
    </a>
  );
}
