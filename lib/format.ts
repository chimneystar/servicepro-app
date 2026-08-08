const SYM: Record<string, string> = { USD: "$", ILS: "₪", EUR: "€" };

/** Format integer minor units (cents) as currency. */
export function money(minor: number, currency = "USD"): string {
  const sym = SYM[currency] ?? "$";
  return (
    sym +
    ((minor ?? 0) / 100).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}
/** Compact money, e.g. $18.2K */
export function moneyShort(minor: number, currency = "USD"): string {
  const sym = SYM[currency] ?? "$";
  const v = (minor ?? 0) / 100;
  if (Math.abs(v) >= 1000) return sym + (v / 1000).toFixed(1).replace(/\.0$/, "") + "K";
  return sym + v.toFixed(0);
}
export function fmtDate(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00");
  return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
}
export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}
export function monthBounds(d = new Date()): { start: string; end: string; y: number; m: number } {
  const y = d.getFullYear(),
    m = d.getMonth();
  const start = new Date(y, m, 1).toISOString().slice(0, 10);
  const end = new Date(y, m + 1, 0).toISOString().slice(0, 10);
  return { start, end, y, m };
}
