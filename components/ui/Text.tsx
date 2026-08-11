import type { ElementType, HTMLAttributes } from "react";
import { cx } from "./cx";

type TextProps = Omit<HTMLAttributes<HTMLElement>, "className"> & {
  as?: ElementType;
  className?: string;
};

/**
 * Secondary text: `font-size:0.8125rem; color:#5c6675`. Twenty-seven exact
 * copies of that pair, which made it the single most repeated declaration pair
 * in the product.
 */
export function Muted({ as: Tag = "div", className, ...rest }: TextProps) {
  return <Tag className={cx("sp-text-muted", className)} {...rest} />;
}

/** One step quieter and one step smaller — timestamps, counts, hints. */
export function Subtle({ as: Tag = "div", className, ...rest }: TextProps) {
  return <Tag className={cx("sp-text-subtle", className)} {...rest} />;
}

/** Section heading: `font-size:0.9375rem; font-weight:800`. */
export function Heading({
  as: Tag = "h3",
  large,
  className,
  ...rest
}: TextProps & { large?: boolean }) {
  return <Tag className={cx("sp-heading", large && "sp-heading--lg", className)} {...rest} />;
}
