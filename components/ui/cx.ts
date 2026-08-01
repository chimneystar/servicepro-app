/** Join class names, dropping anything falsy. The whole of the class plumbing. */
export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

/**
 * A gap or column count from the token scale, handed to CSS as a custom
 * property. Keeping this in one place is what stops `--sp-gap` being spelled
 * three different ways across the app.
 */
export function spaceVars(gap?: SpaceStep, cols?: number): React.CSSProperties | undefined {
  if (gap === undefined && cols === undefined) return undefined;
  const style: Record<string, string> = {};
  if (gap !== undefined) style["--sp-gap"] = `var(--sp-space-${gap})`;
  if (cols !== undefined) style["--sp-cols"] = String(cols);
  return style as React.CSSProperties;
}

/** The spacing steps declared in app/globals.css. */
export type SpaceStep = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 12 | 14;
