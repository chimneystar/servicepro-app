import type { HTMLAttributes } from "react";
import { cx } from "./cx";

export type PillTone = "accent" | "neutral" | "success" | "danger" | "warning";

export type PillProps = Omit<HTMLAttributes<HTMLSpanElement>, "className"> & {
  tone?: PillTone;
  className?: string;
};

/** Status badge. Replaces the `{...base, background, color}` spread family. */
export default function Pill({ tone = "accent", className, ...rest }: PillProps) {
  return (
    <span className={cx("sp-pill", tone !== "accent" && `sp-pill--${tone}`, className)} {...rest} />
  );
}
