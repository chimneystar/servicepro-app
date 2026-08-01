import type { HTMLAttributes } from "react";
import { cx } from "./cx";

export type CardProps = Omit<HTMLAttributes<HTMLDivElement>, "className"> & {
  /** Drop the padding — for a card whose child owns its own edges (a table). */
  flush?: boolean;
  className?: string;
};

/** A bordered, rounded surface. */
export default function Card({ flush, className, ...rest }: CardProps) {
  return <div className={cx("sp-card", flush && "sp-card--flush", className)} {...rest} />;
}
