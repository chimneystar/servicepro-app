"use client";

import { useCallback, useEffect, useId, useRef } from "react";

/**
 * The one dialog in the app.
 *
 * THE DEFECT THIS EXISTS FOR: thirteen screens each hand-rolled the same
 * `<div style={overlay}>` — byte-identical style objects, copied. None of them
 * was a dialog to anything that is not a pair of eyes:
 *   - no `role="dialog"` / `aria-modal`, so a screen reader announced nothing
 *     and kept reading the page underneath as if the overlay were not there;
 *   - no focus move, so a keyboard user opening a modal was still focused on the
 *     button behind it and tabbed *into the page*, not into the form;
 *   - no focus trap, so Tab walked straight out of the dialog and left the user
 *     operating a page they could no longer see;
 *   - no Escape handler, so the only way out was to find and click the overlay;
 *   - no focus restore, so closing it dropped focus back to `<body>` and the
 *     next Tab started again from the top of the document.
 *
 * Every one of those is fixed here once, so the copies cannot disagree.
 *
 * `labelledBy` should be the id of the dialog's own heading. If a screen has no
 * heading, pass `label` instead — a dialog with no accessible name is announced
 * as just "dialog", which is the same as nothing.
 */
export default function Modal({
  onClose,
  children,
  labelledBy,
  label,
  className,
  contentStyle,
  width = 480,
}: {
  onClose: () => void;
  children: React.ReactNode;
  labelledBy?: string;
  label?: string;
  className?: string;
  contentStyle?: React.CSSProperties;
  width?: number;
}) {
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const restoreTo = useRef<HTMLElement | null>(null);
  const titleFallbackId = useId();

  const focusables = useCallback(() => {
    const root = surfaceRef.current;
    if (!root) return [] as HTMLElement[];
    return [
      ...root.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ].filter((el) => el.offsetParent !== null || el === document.activeElement);
  }, []);

  // Remember who opened us, move focus in, put it back on the way out.
  useEffect(() => {
    restoreTo.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const first = focusables()[0] ?? surfaceRef.current;
    first?.focus({ preventScroll: true });
    return () => {
      // The opener is often unmounted along with the dialog (a row that was
      // deleted). Only restore to something still in the document, otherwise
      // focus lands nowhere and the next Tab restarts from the top of the page.
      const target = restoreTo.current;
      if (target && target.isConnected) target.focus({ preventScroll: true });
    };
  }, [focusables]);

  // The page behind must not scroll under the dialog.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  // Escape closes; Tab cycles inside.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) {
        event.preventDefault();
        surfaceRef.current?.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (event.shiftKey && (active === first || !surfaceRef.current?.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [focusables, onClose]);

  return (
    <div
      className="modal-overlay"
      // Clicking the backdrop closes, exactly as the hand-rolled copies did.
      // `role="presentation"` is the honest description: the backdrop carries
      // no meaning and is not a control. It is not the only way out any more —
      // Escape closes from the keyboard — so it does not need to be one.
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={surfaceRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={label ? undefined : (labelledBy ?? titleFallbackId)}
        aria-label={label}
        tabIndex={-1}
        className={`modal-surface${className ? ` ${className}` : ""}`}
        style={{ maxWidth: width, ...contentStyle }}
      >
        {children}
      </div>
    </div>
  );
}
