import crypto from "crypto";
// @ts-ignore — shared pure ESM helpers are also exercised by Node's test runner.
import { normalizeHelcimTransaction as normalizeTransaction } from "@/lib/payments/core.mjs";

const HELCIM_API = "https://api.helcim.com/v2";

export type HelcimPaymentMethod = "cc" | "ach" | "cc-ach";

export type HelcimCheckoutTokens = {
  checkoutToken: string;
  secretToken: string;
};

export type HelcimTransactionData = {
  transactionId?: string | number;
  amount?: string | number;
  currency?: string;
  status?: string;
  statusAuth?: string | number;
  statusClearing?: string | number;
  type?: string;
  approvalCode?: string;
  cardType?: string;
  cardNumber?: string;
  customerCode?: string;
  invoiceNumber?: string;
  warning?: string;
  [key: string]: unknown;
};

export async function initializeHelcimCheckout(opts: {
  apiToken: string;
  amountMinor: number;
  paymentMethod: HelcimPaymentMethod;
  feeSaver: boolean;
}): Promise<HelcimCheckoutTokens> {
  const partnerToken = process.env.HELCIM_PARTNER_TOKEN?.trim();
  const body: Record<string, unknown> = {
    paymentType: "purchase",
    amount: Number((opts.amountMinor / 100).toFixed(2)),
    currency: "USD",
    paymentMethod: opts.paymentMethod,
  };
  if (opts.feeSaver) body.hasConvenienceFee = 1;

  const headers: Record<string, string> = {
    accept: "application/json",
    "api-token": opts.apiToken,
    "content-type": "application/json",
  };
  if (partnerToken) headers["partner-token"] = partnerToken;
  const response = await fetch(`${HELCIM_API}/helcim-pay/initialize`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const data = await response.json().catch(() => null) as Partial<HelcimCheckoutTokens> & { errors?: unknown } | null;
  if (!response.ok || !data?.checkoutToken || !data.secretToken) {
    throw new Error(`Helcim checkout initialization failed (${response.status})`);
  }
  return { checkoutToken: data.checkoutToken, secretToken: data.secretToken };
}

export function helcimRegistrationUrl(connectedAccountId: string): string | null {
  const partnerToken = process.env.HELCIM_PARTNER_TOKEN?.trim();
  if (!partnerToken) return null;
  const url = new URL("https://hub.helcim.com/signup/register");
  url.searchParams.set("pt", partnerToken);
  url.searchParams.set("cid", connectedAccountId);
  return url.toString();
}

export async function getHelcimTransaction(apiToken: string, transactionId: string, method: "card" | "ach") {
  const path = method === "ach" ? `/ach/transactions/${encodeURIComponent(transactionId)}` : `/card-transactions/${encodeURIComponent(transactionId)}`;
  const response = await fetch(`${HELCIM_API}${path}`, {
    headers: { accept: "application/json", "api-token": apiToken },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Helcim transaction lookup failed (${response.status})`);
  return response.json() as Promise<HelcimTransactionData>;
}

function unicodeEscapedJson(value: unknown): string {
  return JSON.stringify(value).replace(/[\u007f-\uffff]/g, (character) =>
    `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`
  );
}

export function verifyHelcimPaymentHash(data: unknown, secretToken: string, providedHash: string): boolean {
  if (!providedHash || !secretToken) return false;
  const expected = crypto.createHash("sha256").update(unicodeEscapedJson(data) + secretToken).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(providedHash, "hex"));
  } catch {
    return false;
  }
}

export function verifyHelcimWebhook(opts: {
  rawBody: string;
  webhookId: string | null;
  timestamp: string | null;
  signature: string | null;
  verifierToken: string;
}): boolean {
  if (!opts.webhookId || !opts.timestamp || !opts.signature || !opts.verifierToken) return false;
  const timestampMs = Number(opts.timestamp) * 1000;
  if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > 5 * 60 * 1000) return false;
  const signedContent = `${opts.webhookId}.${opts.timestamp}.${opts.rawBody}`;
  const key = Buffer.from(opts.verifierToken.replace(/^whsec_/, ""), "base64");
  if (key.length === 0) return false;
  const expected = crypto.createHmac("sha256", key).update(signedContent).digest("base64");
  return opts.signature.split(/\s+/).some((signature) => {
    const provided = signature.replace(/^v1,/, "");
    try { return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(provided)); }
    catch { return false; }
  });
}

export function normalizeHelcimTransaction(data: HelcimTransactionData) {
  return normalizeTransaction(data) as { method: "card" | "ach"; status: "settled" | "processing" | "failed" };
}

export function safeHelcimTransaction(data: HelcimTransactionData) {
  return {
    transactionId: String(data.transactionId ?? ""),
    amount: String(data.amount ?? ""),
    currency: String(data.currency ?? ""),
    status: data.status ? String(data.status) : undefined,
    statusAuth: data.statusAuth !== undefined ? String(data.statusAuth) : undefined,
    statusClearing: data.statusClearing !== undefined ? String(data.statusClearing) : undefined,
    type: data.type ? String(data.type) : undefined,
    approvalCode: data.approvalCode ? String(data.approvalCode) : undefined,
    cardType: data.cardType ? String(data.cardType) : undefined,
    cardNumber: data.cardNumber ? String(data.cardNumber).slice(-4) : undefined,
    customerCode: data.customerCode ? String(data.customerCode) : undefined,
    invoiceNumber: data.invoiceNumber ? String(data.invoiceNumber) : undefined,
    warning: data.warning ? String(data.warning) : undefined,
  };
}
