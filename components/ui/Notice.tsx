import type { HTMLAttributes } from "react";
import { cx } from "./cx";

export type NoticeTone = "error" | "success" | "warning" | "info";

export type NoticeProps = Omit<HTMLAttributes<HTMLDivElement>, "className"> & {
  tone?: NoticeTone;
  className?: string;
};

/**
 * The message box every form in this product hand-rolled — `const err` and
 * `const errBox`, ~22 declared copies and 53 inline uses of the #fdeaea
 * background on its own.
 *
 * `role="status"` on the non-error tones and `role="alert"` on the error one:
 * a form error that is only a red box is invisible to a screen reader, and the
 * whole point of routing these through one component is that the announcement
 * comes with the colour rather than being remembered separately.
 */
export default function Notice({ tone = "error", className, ...rest }: NoticeProps) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cx("sp-notice", tone !== "error" && `sp-notice--${tone}`, className)}
      {...rest}
    />
  );
}
