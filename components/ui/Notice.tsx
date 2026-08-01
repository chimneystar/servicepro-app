import type { HTMLAttributes } from "react";
import { cx, type SpaceStep } from "./cx";

export type NoticeTone = "error" | "success" | "warning" | "info";

export type NoticeProps = Omit<HTMLAttributes<HTMLDivElement>, "className"> & {
  tone?: NoticeTone;
  /**
   * Top margin, as a step from the spacing scale. The copies this replaces
   * differed ONLY in this value — 8px, 10px and 12px — so it is a prop rather
   * than three more variant classes, and it is a token step rather than a
   * number so the scale stays the only place a spacing value is written.
   */
  mt?: SpaceStep;
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
export default function Notice({ tone = "error", mt, className, ...rest }: NoticeProps) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cx("sp-notice", tone !== "error" && `sp-notice--${tone}`, className)}
      style={mt === undefined ? undefined : ({ "--sp-mt": `var(--sp-space-${mt})` } as object)}
      {...rest}
    />
  );
}
