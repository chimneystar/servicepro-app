import type { ElementType, HTMLAttributes } from "react";
import { cx, spaceVars, type SpaceStep } from "./cx";

type LayoutProps = Omit<HTMLAttributes<HTMLElement>, "className"> & {
  as?: ElementType;
  /** A step from the spacing scale in app/globals.css. Defaults to step 4 (10px). */
  gap?: SpaceStep;
  className?: string;
};

/** Vertical flex with a gap from the token scale. */
export function Stack({ as: Tag = "div", gap, className, ...rest }: LayoutProps) {
  return <Tag className={cx("sp-stack", className)} style={spaceVars(gap)} {...rest} />;
}

/** Horizontal flex, centred, with a gap from the token scale. */
export function Row({
  as: Tag = "div",
  gap,
  wrap,
  between,
  top,
  className,
  ...rest
}: LayoutProps & { wrap?: boolean; between?: boolean; top?: boolean }) {
  return (
    <Tag
      className={cx(
        "sp-row",
        wrap && "sp-row--wrap",
        between && "sp-row--between",
        top && "sp-row--top",
        className,
      )}
      style={spaceVars(gap)}
      {...rest}
    />
  );
}

/**
 * Equal-width columns. `cols` drives `grid-template-columns` through a custom
 * property rather than an inline `gridTemplateColumns`, so the one place that
 * knows what a column is stays in the stylesheet — and so a narrow screen can
 * collapse it with a media query, which an inline style cannot.
 */
export function Grid({
  as: Tag = "div",
  gap,
  cols = 1,
  className,
  ...rest
}: LayoutProps & { cols?: number }) {
  return <Tag className={cx("sp-grid", className)} style={spaceVars(gap, cols)} {...rest} />;
}
