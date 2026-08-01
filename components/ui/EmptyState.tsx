import type { HTMLAttributes } from "react";
import { cx } from "./cx";

export type EmptyStateProps = Omit<HTMLAttributes<HTMLDivElement>, "className"> & {
  className?: string;
};

/**
 * "Nothing here yet." Replaces `padding:40; text-align:center; color:#5c6675`.
 *
 * The message is always passed in by the caller and never defaulted, because
 * this product is bilingual and a primitive that shipped its own English string
 * would be an English string on a Hebrew screen.
 */
export default function EmptyState({ className, ...rest }: EmptyStateProps) {
  return <div className={cx("sp-empty", className)} {...rest} />;
}
