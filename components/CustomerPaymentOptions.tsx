"use client";

import { useEffect, useMemo, useState } from "react";
import type { Locale } from "@/lib/i18n";
import type { PublicPaymentOptions } from "@/lib/payments/types";
import { money } from "@/lib/format";

declare global {
  interface Window {
    appendHelcimPayIframe?: (checkoutToken: string, allowExit?: boolean) => void;
    removeHelcimPayIframe?: () => void;
  }
}

type Method = "helcim" | "zelle" | "check";
type FlowState = "idle" | "starting" | "processing" | "processing_ach" | "paid" | "manual_pending" | "error";

export default function CustomerPaymentOptions({ token, locale, options, accent }: { token: string; locale: Locale; options: PublicPaymentOptions; accent: string }) {
  const he = locale === "he";
  const [signed, setSigned] = useState(!!options.signed);
  const paymentMethods = options.methods ?? { helcim: false, card: false, ach: false, zelle: false, check: false };
  const methods = useMemo(() => ([
    paymentMethods.helcim ? "helcim" as const : null,
    paymentMethods.zelle ? "zelle" as const : null,
    paymentMethods.check ? "check" as const : null,
  ].filter(Boolean) as Method[]), [options.methods]);
  const [method, setMethod] = useState<Method>(methods[0] ?? "helcim");
  const [state, setState] = useState<FlowState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [reference, setReference] = useState("");
  const [mailedOn, setMailedOn] = useState(() => new Date().toISOString().slice(0, 10));

  useEffect(() => {
    const approved = () => setSigned(true);
    window.addEventListener("servicepro:document-approved", approved);
    return () => window.removeEventListener("servicepro:document-approved", approved);
  }, []);

  if (options.reason === "payment_processing") {
    return <section className="customer-payment-success" style={{ "--pay-accent": accent } as React.CSSProperties} aria-live="polite"><span>◷</span><div><strong>{he ? "תשלום ה־ACH עדיין בבדיקה" : "ACH payment is still processing"}</strong><p>{he ? "אין צורך לשלם שוב. היתרה תתעדכן אוטומטית לאחר אישור הבנק." : "Do not pay again. The balance will update automatically after bank confirmation."}</p></div></section>;
  }
  if (!options.available || methods.length === 0 || !options.amount_minor) return null;
  const amount = money(options.amount_minor, options.currency ?? "USD");
  const onlineMethodLabel = paymentMethods.card && paymentMethods.ach
    ? (he ? "כרטיס או ACH" : "Card or ACH")
    : paymentMethods.card ? (he ? "כרטיס אשראי" : "Credit card") : "ACH";

  async function startHelcim() {
    setState("starting"); setError(null);
    try {
      await loadHelcimScript();
      const response = await fetch("/api/pay/helcim/initialize", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(`customer:${customerPaymentError(data.code, he)}`);

      const checkoutToken = String(data.checkoutToken);
      const requestToken = String(data.requestToken);
      const eventName = `helcim-pay-js-${checkoutToken}`;
      const listener = async (event: MessageEvent) => {
        if (event.data?.eventName !== eventName) return;
        if (event.data.eventStatus === "HIDE") {
          setState("idle"); window.removeEventListener("message", listener); return;
        }
        if (event.data.eventStatus === "ABORTED") {
          setState("error"); setError(he ? "התשלום לא אושר. אפשר לנסות שוב או לבחור דרך אחרת." : "The payment was not approved. Try again or choose another method.");
          window.removeEventListener("message", listener); return;
        }
        if (event.data.eventStatus !== "SUCCESS") return;
        setState("processing");
        try {
          const confirmation = await fetch("/api/pay/helcim/confirm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestToken, checkoutToken, eventMessage: event.data.eventMessage }) });
          const result = await confirmation.json();
          if (!confirmation.ok || !result.ok) throw new Error(result.error || "confirmation failed");
          setState(result.status === "processing" ? "processing_ach" : result.status === "settled" ? "paid" : "error");
          window.removeHelcimPayIframe?.();
        } catch {
          setState("error"); setError(he ? "התשלום נקלט, אבל האישור מתעכב. אין לשלם שוב—העסק יבדוק את הסטטוס." : "The payment was submitted, but confirmation is delayed. Do not pay again—the business will verify it.");
        } finally { window.removeEventListener("message", listener); }
      };
      window.addEventListener("message", listener);
      window.appendHelcimPayIframe?.(checkoutToken, true);
      setState("processing");
    } catch (caught) {
      const message = caught instanceof Error && caught.message.startsWith("customer:") ? caught.message.slice(9) : customerPaymentError("unexpected", he);
      setState("error"); setError(message);
    }
  }

  async function submitManual(chosen: "zelle" | "check") {
    setState("processing"); setError(null);
    try {
      const response = await fetch("/api/pay/manual", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, method: chosen, reference, mailedOn: chosen === "check" ? mailedOn : undefined }) });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(`customer:${customerPaymentError(data.code, he)}`);
      setState("manual_pending");
    } catch (caught) {
      const message = caught instanceof Error && caught.message.startsWith("customer:") ? caught.message.slice(9) : customerPaymentError("unexpected", he);
      setState("error"); setError(message);
    }
  }

  if (state === "paid" || state === "processing_ach" || state === "manual_pending") {
    const ach = state === "processing_ach";
    return <section className="customer-payment-success" style={{ "--pay-accent": accent } as React.CSSProperties} aria-live="polite"><span>{ach || state === "manual_pending" ? "◷" : "✓"}</span><div><strong>{ach ? (he ? "תשלום ה־ACH נשלח" : "ACH payment submitted") : state === "manual_pending" ? (he ? "העדכון נשלח לעסק" : "The business has been notified") : (he ? "התשלום התקבל" : "Payment received")}</strong><p>{ach ? (he ? "העבודה תישאר בהמתנה עד שהבנק יאשר את התשלום." : "The job remains on hold until the bank confirms settlement.") : state === "manual_pending" ? (he ? "התשלום יסומן כשולם לאחר שהעסק יאשר שהוא התקבל." : "The payment will be marked paid after the business verifies receipt.") : (he ? "קבלה תישלח לפי פרטי הקשר שלך." : "A receipt will be sent using your contact details.")}</p></div></section>;
  }

  return <section className="customer-payment-panel" style={{ "--pay-accent": accent } as React.CSSProperties}>
    <div className="customer-payment-title"><div><span>{he ? "השלב הבא" : "Next step"}</span><h3>{he ? `תשלום ${amount}` : `Pay ${amount}`}</h3></div><b>{options.kind === "estimate_deposit" ? (he ? "מקדמה" : "Deposit") : (he ? "יתרה לתשלום" : "Balance due")}</b></div>

    {!signed ? <div className="payment-sign-lock"><span>1</span><div><strong>{he ? "קודם מאשרים וחותמים" : "Approve and sign first"}</strong><small>{he ? "מיד לאחר החתימה אפשר יהיה לבחור דרך תשלום." : "Payment choices unlock immediately after signing."}</small></div></div> : <>
      <div className="customer-payment-tabs" role="tablist" aria-label={he ? "בחירת אמצעי תשלום" : "Choose a payment method"}>
        {methods.map((item) => <button type="button" role="tab" aria-selected={method === item} className={method === item ? "active" : ""} onClick={() => { setMethod(item); setError(null); }} key={item}>{item === "helcim" ? onlineMethodLabel : item === "zelle" ? "Zelle" : (he ? "צ׳ק בדואר" : "Mail a check")}</button>)}
      </div>

      {method === "helcim" && <div className="customer-payment-method-body pop-in"><div className="customer-pay-explainer"><span>H</span><div><strong>{he ? "תשלום מאובטח דרך Helcim" : "Secure payment through Helcim"}</strong><small>{options.fee_saver ? (he ? "עמלת כרטיס זכאית תוצג לפני האישור. תשלום ACH ללא עמלת כרטיס." : "Any eligible card fee appears before confirmation. ACH has no card fee.") : (he ? "פרטי הכרטיס או הבנק אינם נשמרים ב־ServicePro." : "ServicePro never stores your card or bank credentials.")}</small></div></div><button type="button" className="customer-pay-button" onClick={startHelcim} disabled={state === "starting" || state === "processing"}>{state === "starting" ? (he ? "פותחים תשלום…" : "Opening secure checkout…") : (he ? `לתשלום ${amount}` : `Pay ${amount}`)}</button></div>}

      {method === "zelle" && options.zelle && <div className="customer-payment-method-body pop-in"><PaymentLine label={he ? "לשלוח אל" : "Send to"} value={options.zelle.recipient_name || options.zelle.email || options.zelle.phone || ""} copyLabel={he ? "העתקה" : "Copy"} /><PaymentLine label={he ? "אימייל / טלפון" : "Email / mobile"} value={[options.zelle.email, options.zelle.phone].filter(Boolean).join(" · ")} copyLabel={he ? "העתקה" : "Copy"} /><PaymentLine label={he ? "הערה לתשלום" : "Payment memo"} value={options.zelle.memo ?? ""} copyLabel={he ? "העתקה" : "Copy"} />{options.zelle.qr_url && <img className="zelle-qr" src={options.zelle.qr_url} alt={he ? "קוד QR לתשלום ב־Zelle" : "Zelle payment QR code"} />}{options.zelle.instructions && <p className="customer-payment-note">{options.zelle.instructions}</p>}<label className="customer-reference-field"><span>{he ? "מספר אישור, אם יש" : "Confirmation number, if available"}</span><input value={reference} onChange={(event) => setReference(event.target.value)} /></label><button type="button" className="customer-pay-button" onClick={() => submitManual("zelle")} disabled={state === "processing"}>{he ? "שלחתי את התשלום" : "I sent the payment"}</button></div>}

      {method === "check" && options.check && <div className="customer-payment-method-body pop-in"><PaymentLine label={he ? "לפקודת" : "Payable to"} value={options.check.payee ?? ""} copyLabel={he ? "העתקה" : "Copy"} /><PaymentLine label={he ? "כתובת למשלוח" : "Mail to"} value={[options.check.address, options.check.city_state_zip].filter(Boolean).join(", ")} copyLabel={he ? "העתקה" : "Copy"} /><PaymentLine label={he ? "שורת הערה" : "Memo"} value={options.check.memo ?? ""} copyLabel={he ? "העתקה" : "Copy"} />{options.check.memo_instructions && <p className="customer-payment-note">{options.check.memo_instructions}</p>}<div className="customer-check-fields"><label className="customer-reference-field"><span>{he ? "מספר צ׳ק, אם ידוע" : "Check number, if known"}</span><input value={reference} onChange={(event) => setReference(event.target.value)} /></label><label className="customer-reference-field"><span>{he ? "תאריך משלוח" : "Date mailed"}</span><input type="date" value={mailedOn} onChange={(event) => setMailedOn(event.target.value)} /></label></div><button type="button" className="customer-pay-button" onClick={() => submitManual("check")} disabled={state === "processing"}>{he ? "שלחתי את הצ׳ק" : "I mailed the check"}</button></div>}
    </>}
    {error && <div className="customer-payment-error" role="alert">{error}</div>}
  </section>;
}

function PaymentLine({ label, value, copyLabel }: { label: string; value: string; copyLabel?: string }) {
  const [copied, setCopied] = useState(false);
  if (!value) return null;
  return <div className="customer-payment-line"><span>{label}</span><strong>{value}</strong>{copyLabel && <button type="button" onClick={async () => { await navigator.clipboard.writeText(value); setCopied(true); window.setTimeout(() => setCopied(false), 1400); }}>{copied ? "✓" : copyLabel}</button>}</div>;
}

function loadHelcimScript() {
  if (window.appendHelcimPayIframe) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-helcim-pay="true"]');
    if (existing) { existing.addEventListener("load", () => resolve(), { once: true }); existing.addEventListener("error", () => reject(new Error("Helcim failed to load")), { once: true }); return; }
    const script = document.createElement("script");
    script.src = "https://secure.helcim.app/helcim-pay/services/start.js";
    script.async = true;
    script.dataset.helcimPay = "true";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Helcim failed to load"));
    document.head.appendChild(script);
  });
}

function customerPaymentError(code: unknown, he: boolean) {
  const key = typeof code === "string" ? code : "unexpected";
  const messages: Record<string, [string, string]> = {
    invalid_token: ["קישור התשלום אינו תקין.", "This payment link is invalid."],
    not_found: ["קישור התשלום כבר אינו זמין.", "This payment link is no longer available."],
    signature_required: ["יש לאשר ולחתום לפני התשלום.", "Approve and sign before paying."],
    nothing_due: ["לא נותרה יתרה לתשלום.", "There is no remaining balance to pay."],
    merchant_not_ready: ["התשלום המקוון עדיין לא הופעל אצל העסק.", "Online payment is not active for this business yet."],
    methods_disabled: ["אמצעי התשלום המקוונים אינם זמינים כרגע.", "Online payment methods are not available right now."],
    method_disabled: ["אמצעי התשלום שבחרת אינו זמין כרגע.", "That payment method is not available right now."],
    session_expired: ["חלון התשלום פג. אפשר לפתוח אותו מחדש.", "The payment session expired. Open it again to continue."],
    session_busy: ["חלון התשלום כבר נפתח. המתינו רגע ונסו שוב.", "The payment window is already opening. Wait a moment and try again."],
    payment_pending: ["תשלום ה־ACH עדיין בבדיקה. אין צורך לשלם שוב.", "The ACH payment is still processing. Do not pay again."],
    amount_mismatch: ["לא הצלחנו לאמת את סכום התשלום. העסק יעזור להשלים אותו.", "We couldn't verify the payment amount. The business can help complete it."],
    provider_unavailable: ["שירות התשלום אינו זמין כרגע. נסו שוב בעוד רגע.", "Payment service is temporarily unavailable. Please try again shortly."],
    balance_unavailable: ["לא הצלחנו לבדוק את היתרה כרגע. נסו שוב בעוד רגע.", "We couldn't check the balance right now. Please try again shortly."],
    request_failed: ["לא הצלחנו להכין את התשלום. נסו שוב בעוד רגע.", "We couldn't prepare the payment. Please try again shortly."],
    submission_failed: ["לא הצלחנו לשמור את העדכון. נסו שוב בעוד רגע.", "We couldn't save the update. Please try again shortly."],
    unexpected: ["משהו השתבש. לא בוצע חיוב—אפשר לנסות שוב.", "Something went wrong. You were not charged—please try again."],
  };
  const [hebrew, english] = messages[key] ?? messages.unexpected;
  return he ? hebrew : english;
}
