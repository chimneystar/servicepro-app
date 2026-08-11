import type { SelectHTMLAttributes } from "react";
import { cx } from "./cx";
import type { Named } from "./Named";

type Base = Omit<SelectHTMLAttributes<HTMLSelectElement>, "className"> & {
  className?: string;
  large?: boolean;
};

export type SelectProps = Base & Named;

/** The dropdown half of the `inp` style object. See Input for the naming rule. */
export default function Select({
  label,
  className,
  large,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  ...rest
}: SelectProps) {
  const cls = cx("sp-select", large && "sp-control--lg", className);
  // The two branches are written out rather than sharing one element on
  // purpose: the accessible name has to be visible in the source of THIS file,
  // because that is where tests/accessibility.test.mjs and the design-system
  // probe look for it. A name arriving invisibly through a spread is a name
  // that no static check can confirm is there.
  if (label === undefined) {
    return (
      <select className={cls} aria-label={ariaLabel} aria-labelledby={ariaLabelledBy} {...rest} />
    );
  }
  return (
    <label className="sp-field">
      <span className="sp-label">{label}</span>
      <select className={cls} {...rest} />
    </label>
  );
}
