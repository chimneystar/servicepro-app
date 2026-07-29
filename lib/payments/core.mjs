/** Normalize Helcim card and ACH responses without treating ACH submission as settlement. */
export function normalizeHelcimTransaction(data) {
  const isAch = data?.statusAuth !== undefined || String(data?.type ?? "").toUpperCase() === "WITHDRAWAL";
  if (isAch) {
    const authorization = String(data?.statusAuth ?? "").toUpperCase();
    const clearing = String(data?.statusClearing ?? "").toUpperCase();
    const settled = clearing === "1" || clearing === "APPROVED" || clearing === "CLOSED";
    const failed = authorization === "2" || authorization === "DECLINED" || clearing === "4" || clearing === "DECLINED";
    return { method: "ach", status: failed ? "failed" : settled ? "settled" : "processing" };
  }
  const status = String(data?.status ?? "").toUpperCase();
  return { method: "card", status: status === "APPROVED" || status === "APPROVAL" ? "settled" : "failed" };
}
/** Validate the base amount while allowing Helcim's eligible Fee Saver surcharge. */
export function paymentAmountParts(requestedMinor, actualAmount, feeSaverRequested) {
  const actualMinor = Math.round(Number(actualAmount) * 100);
  const maxWithFee = feeSaverRequested ? Math.ceil(Number(requestedMinor) * 1.06) + 1 : Number(requestedMinor);
  if (!Number.isSafeInteger(actualMinor) || actualMinor < requestedMinor || actualMinor > maxWithFee) {
    throw new Error("payment amount mismatch");
  }
  return { actualMinor, surchargeMinor: Math.max(0, actualMinor - requestedMinor) };
}
