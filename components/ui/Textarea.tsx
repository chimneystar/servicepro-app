import type { TextareaHTMLAttributes } from "react";
import { cx } from "./cx";
import type { Named } from "./Named";

type Base = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "className"> & {
  className?: string;
  large?: boolean;
};

export type TextareaProps = Base & Named;

/** The multi-line half of the `inp` style object. See Input for the naming rule. */
export default function Textarea({
  label,
  className,
  large,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  ...rest
}: TextareaProps) {
  const cls = cx("sp-textarea", large && "sp-control--lg", className);
  if (label === undefined) {
    return (
      <textarea className={cls} aria-label={ariaLabel} aria-labelledby={ariaLabelledBy} {...rest} />
    );
  }
  return (
    <label className="sp-field">
      <span className="sp-label">{label}</span>
      <textarea className={cls} {...rest} />
    </label>
  );
}
