import type { HTMLAttributes, TableHTMLAttributes } from "react";
import { cx } from "./cx";

export type TableProps = Omit<TableHTMLAttributes<HTMLTableElement>, "className"> & {
  className?: string;
};

/**
 * A data table. Header cells align to `start`, not `left` — these tables carry
 * Hebrew, and a physical direction here mirrors wrong for half the product.
 *
 * Wrap in `TableScroll` on a dense screen: a table that overflows its column on
 * a laptop is the defect A3 found in the sidebar, one element over.
 */
export default function Table({ className, ...rest }: TableProps) {
  return <table className={cx("sp-table", className)} {...rest} />;
}

export function TableScroll({
  className,
  ...rest
}: Omit<HTMLAttributes<HTMLDivElement>, "className"> & { className?: string }) {
  return <div className={cx("sp-table-scroll", className)} {...rest} />;
}
