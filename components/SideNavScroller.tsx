"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The sidebar's scroll port, and the visible proof that it scrolls.
 *
 * AUDIT A3: expanding the "Tools" group put all of its destinations below the
 * fold of this column — `.side-nav` scrollHeight 1162px in a 738px well — and
 * the owner reported them as unreachable. They were not unreachable; they were
 * INVISIBLE, which for a user is the same thing. macOS and iOS draw OVERLAY
 * scrollbars: nothing at all is painted until something is already scrolling,
 * so a column that is twice as tall as its well looks exactly like a column
 * that ends where it ends. There was no cue of any kind that more existed.
 *
 * Styling the scrollbar is not enough on its own — a browser in overlay mode
 * ignores `scrollbar-color` at rest (verified in Chromium with
 * `--enable-features=OverlayScrollbar`: zero pixels differ). So the cue is an
 * explicit element: a gradient at whichever edge has content beyond it, driven
 * by measurement rather than by CSS that cannot see the scroll position.
 *
 * It is `aria-hidden` — it is a cue for eyes only. A screen reader was never
 * affected by this bug, because the links were always in the accessibility tree.
 */
export default function SideNavScroller({ label, children }: { label: string; children: React.ReactNode }) {
  const navRef = useRef<HTMLElement | null>(null);
  const innerRef = useRef<HTMLDivElement | null>(null);
  const [edges, setEdges] = useState({ up: false, down: false });

  const measure = useCallback(() => {
    const nav = navRef.current;
    if (!nav) return;
    // 2px of slack: sub-pixel layout makes an exactly-scrolled-to-the-end
    // container report a 0.5px remainder, which would leave the cue stuck on.
    const up = nav.scrollTop > 2;
    const down = nav.scrollTop + nav.clientHeight < nav.scrollHeight - 2;
    setEdges((prev) => (prev.up === up && prev.down === down ? prev : { up, down }));
  }, []);

  useEffect(() => {
    measure();
    const targets = [navRef.current, innerRef.current].filter(Boolean) as Element[];
    // The nav is observed for viewport resize, the inner wrapper for content
    // growth — opening Tools changes the CONTENT height, which a ResizeObserver
    // on the scroll port alone would never see.
    const observer = new ResizeObserver(measure);
    for (const target of targets) observer.observe(target);
    return () => observer.disconnect();
  }, [measure]);

  return (
    <div className={`side-nav-wrap${edges.up ? " can-scroll-up" : ""}${edges.down ? " can-scroll-down" : ""}`}>
      <nav ref={navRef} className="side-nav" aria-label={label} onScroll={measure}>
        <div ref={innerRef} className="side-nav-inner">{children}</div>
      </nav>
      <span className="side-nav-fade side-nav-fade-top" aria-hidden="true" />
      <span className="side-nav-fade side-nav-fade-bottom" aria-hidden="true" />
    </div>
  );
}
