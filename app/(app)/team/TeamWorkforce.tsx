"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addSkill, removeSkill, addTimeOff, removeTimeOff, setPayRate, type ActionResult } from "./actions";
import { money } from "@/lib/format";
// @ts-ignore -- pure logic, proven both ways in tests/skills.test.mjs
import { certificationStatus, COMMON_SKILLS } from "@/lib/core/skills.mjs";
import type { Locale } from "@/lib/i18n";

export type WorkforceMember = { id: string; full_name: string; role: string };
export type WorkforceSkill = {
  id: string; profile_id: string; skill_code: string; label: string | null;
  certification_number: string | null; issued_on: string | null; expires_on: string | null;
};
export type WorkforceTimeOff = {
  id: string; profile_id: string | null; starts_on: string; ends_on: string;
  start_time: string | null; end_time: string | null; kind: string; note: string | null;
};
export type WorkforceRate = { profile_id: string; cost_rate_minor: number; effective_from: string };

/**
 * Certifications (6c.11), time off (6c.3) and the labour cost rate (6c.2).
 *
 * The rate is on the OWNER-ONLY team screen and comes from an owner-only table.
 * It is a wage: it is not on `profiles` (which everyone can read) and it is not
 * shown to office staff, who reach only the per-job total through
 * `job_labour_cost()`.
 */
export default function TeamWorkforce({ locale, currency, members, skills, timeOff, rates, canSeePay }: {
  locale: Locale; currency: string; members: WorkforceMember[];
  skills: WorkforceSkill[]; timeOff: WorkforceTimeOff[]; rates: WorkforceRate[]; canSeePay: boolean;
}) {
  const he = locale === "he";
  const router = useRouter();
  const [busy, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const today = new Date().toISOString().slice(0, 10);
  const run = (fn: () => Promise<ActionResult>) => start(async () => {
    const result = await fn();
    setMessage(result.ok ? null : (result.error ?? (he ? "לא הצלחנו לשמור" : "Couldn't save")));
    if (result.ok) router.refresh();
  });

  const [skillFor, setSkillFor] = useState<string>(members[0]?.id ?? "");
  const [skillCode, setSkillCode] = useState("");
  const [skillNumber, setSkillNumber] = useState("");
  const [skillExpires, setSkillExpires] = useState("");

  const [offFor, setOffFor] = useState<string>("");
  const [offStart, setOffStart] = useState(today);
  const [offEnd, setOffEnd] = useState(today);
  const [offKind, setOffKind] = useState("time_off");
  const [offNote, setOffNote] = useState("");

  const nameOf = (id: string | null) => members.find((m) => m.id === id)?.full_name || (he ? "כל העסק" : "Whole business");
  const currentRate = (id: string) => {
    const applicable = rates.filter((r) => r.profile_id === id && r.effective_from <= today)
      .sort((a, b) => (a.effective_from < b.effective_from ? 1 : -1));
    return applicable[0] ?? null;
  };

  return (
    <div style={{ maxWidth: 720 }}>
      {message && <div style={err}>{message}</div>}

      {/* ---- Certifications -------------------------------------------- */}
      <div style={card}>
        <h3 style={h3}>{he ? "הסמכות ורישיונות" : "Certifications & licences"}</h3>
        <p style={hint}>
          {he
            ? "עבודה שדורשת הסמכה לא תשובץ לטכנאי שאין לו אותה — הבקשה תידחה עם ההסבר. הסמכה שפג תוקפה נחשבת כאילו אינה קיימת."
            : "A job that requires a certification cannot be assigned to somebody who does not hold it — the assignment is refused with the reason. An EXPIRED certification counts as not held, because it is exactly as illegal as none."}
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 10 }}>
          <select value={skillFor} onChange={(e) => setSkillFor(e.target.value)} style={{ ...inp, flex: "1 1 150px" }}>
            {members.map((m) => <option key={m.id} value={m.id}>{m.full_name || "—"}</option>)}
          </select>
          <input list="sp-skill-codes" value={skillCode} onChange={(e) => setSkillCode(e.target.value)} placeholder={he ? "קוד (gas, hvac…)" : "code (gas, hvac…)"} style={{ ...inp, flex: "1 1 130px" }} />
          <datalist id="sp-skill-codes">
            {(COMMON_SKILLS as { code: string; en: string; he: string }[]).map((s) => <option key={s.code} value={s.code}>{he ? s.he : s.en}</option>)}
          </datalist>
          <input value={skillNumber} onChange={(e) => setSkillNumber(e.target.value)} placeholder={he ? "מספר רישיון" : "licence no."} style={{ ...inp, flex: "1 1 130px" }} />
          <input type="date" value={skillExpires} onChange={(e) => setSkillExpires(e.target.value)} style={{ ...inp, flex: "0 0 150px" }} aria-label={he ? "תוקף עד" : "Expires"} />
          <button type="button" disabled={busy || !skillCode.trim()} style={btn}
            onClick={() => run(async () => {
              const result = await addSkill(skillFor, { skill: skillCode, certificationNumber: skillNumber, expiresOn: skillExpires });
              if (result.ok) { setSkillCode(""); setSkillNumber(""); setSkillExpires(""); }
              return result;
            })}>{he ? "הוספה" : "Add"}</button>
        </div>
        {skills.length === 0 && <div style={hint}>{he ? "עוד לא נרשמו הסמכות." : "No certifications recorded yet."}</div>}
        {skills.map((s) => {
          const status = certificationStatus(s, today) as string;
          const tone = status === "expired" ? "#dc2626" : status === "expiring" ? "#a15c07" : "#15803d";
          return (
            <div key={s.id} style={row}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <b>{nameOf(s.profile_id)}</b> · {s.label || s.skill_code}
                <div style={{ fontSize: 12, color: tone }}>
                  {status === "expired" ? (he ? "פג תוקף" : "EXPIRED") : status === "expiring" ? (he ? "עומד לפוג" : "expires soon") : (he ? "בתוקף" : "valid")}
                  {s.expires_on ? ` · ${s.expires_on}` : ""}
                  {s.certification_number ? ` · #${s.certification_number}` : ""}
                </div>
              </div>
              <button type="button" disabled={busy} style={rm} onClick={() => run(() => removeSkill(s.id))}>{he ? "הסרה" : "Remove"}</button>
            </div>
          );
        })}
      </div>

      {/* ---- Time off --------------------------------------------------- */}
      <div style={card}>
        <h3 style={h3}>{he ? "חופשות וימי אי-עבודה" : "Time off & non-working days"}</h3>
        <p style={hint}>
          {he
            ? "יומן ההזמנות המקוון ולוח השיבוץ מתעלמים מזמינות בתאריכים אלה. בחירה ב\"כל העסק\" סוגרת את היום לכולם (חג)."
            : "The online booking calendar and the dispatch board both stop offering these times. Choosing \"whole business\" closes the day for everybody — the public-holiday case."}
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 10 }}>
          <select value={offFor} onChange={(e) => setOffFor(e.target.value)} style={{ ...inp, flex: "1 1 150px" }}>
            <option value="">{he ? "כל העסק (סגור)" : "Whole business (closed)"}</option>
            {members.map((m) => <option key={m.id} value={m.id}>{m.full_name || "—"}</option>)}
          </select>
          <input type="date" value={offStart} onChange={(e) => setOffStart(e.target.value)} style={{ ...inp, flex: "0 0 150px" }} aria-label={he ? "מתאריך" : "From"} />
          <input type="date" value={offEnd} onChange={(e) => setOffEnd(e.target.value)} style={{ ...inp, flex: "0 0 150px" }} aria-label={he ? "עד תאריך" : "To"} />
          <select value={offKind} onChange={(e) => setOffKind(e.target.value)} style={{ ...inp, flex: "0 0 140px" }}>
            {["time_off", "vacation", "sick", "personal", "training", "holiday", "other"].map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
          <input value={offNote} onChange={(e) => setOffNote(e.target.value)} placeholder={he ? "הערה" : "note"} style={{ ...inp, flex: "1 1 120px" }} />
          <button type="button" disabled={busy} style={btn}
            onClick={() => run(async () => {
              const result = await addTimeOff({ memberId: offFor, startsOn: offStart, endsOn: offEnd, kind: offKind, note: offNote });
              if (result.ok) setOffNote("");
              return result;
            })}>{he ? "הוספה" : "Add"}</button>
        </div>
        {timeOff.length === 0 && <div style={hint}>{he ? "לא נרשמו ימי אי-עבודה." : "Nothing recorded."}</div>}
        {timeOff.map((row2) => (
          <div key={row2.id} style={row}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <b>{nameOf(row2.profile_id)}</b>
              <div style={{ fontSize: 12, color: "#5c6675" }}>
                {row2.starts_on}{row2.ends_on !== row2.starts_on ? ` → ${row2.ends_on}` : ""}
                {row2.start_time ? ` · ${row2.start_time.slice(0, 5)}–${(row2.end_time ?? "").slice(0, 5)}` : ` · ${he ? "כל היום" : "all day"}`}
                {` · ${row2.kind}`}{row2.note ? ` · ${row2.note}` : ""}
              </div>
            </div>
            <button type="button" disabled={busy} style={rm} onClick={() => run(() => removeTimeOff(row2.id))}>{he ? "הסרה" : "Remove"}</button>
          </div>
        ))}
      </div>

      {/* ---- Labour cost rate ------------------------------------------- */}
      {canSeePay && (
        <div style={card}>
          <h3 style={h3}>{he ? "עלות שעת עבודה" : "Labour cost rate"}</h3>
          <p style={hint}>
            {he
              ? "העלות בפועל לעסק לשעה (שכר והוצאות נלוות) — לא מחיר ללקוח. זהו מידע שכר: הוא נשמר בטבלה שרק בעלים יכולים לקרוא, ולעולם אינו מוצג לטכנאים או לצוות המשרד. שינוי תעריף חל מהתאריך שנבחר בלבד ואינו מתמחר מחדש עבודות שהסתיימו."
              : "The fully-loaded hourly COST to the business — wage plus burden, not the customer's labour price. This is payroll: it lives in an owner-only table, is never shown to technicians or office staff, and a change applies only from its effective date, so finished jobs are never re-costed."}
          </p>
          {members.map((m) => {
            const rate = currentRate(m.id);
            return <PayRateRow key={m.id} he={he} member={m} currency={currency} rate={rate} busy={busy}
              onSave={(amount, from) => run(() => setPayRate(m.id, amount, from))} />;
          })}
        </div>
      )}
    </div>
  );
}

function PayRateRow({ he, member, currency, rate, busy, onSave }: {
  he: boolean; member: WorkforceMember; currency: string; rate: WorkforceRate | null; busy: boolean;
  onSave: (amount: string, from: string) => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [amount, setAmount] = useState(rate ? (rate.cost_rate_minor / 100).toFixed(2) : "");
  const [from, setFrom] = useState(today);
  return (
    <div style={row}>
      <div style={{ flex: 1, minWidth: 140 }}>
        <b>{member.full_name || "—"}</b>
        <div style={{ fontSize: 12, color: rate ? "#5c6675" : "#a15c07" }}>
          {rate
            ? `${he ? "כעת" : "now"} ${money(rate.cost_rate_minor, currency)}/${he ? "שעה" : "h"} · ${he ? "מ-" : "from"} ${rate.effective_from}`
            : (he ? "אין תעריף — שעות העובד הזה מתומחרות באפס והמסך אומר זאת." : "No rate — this person's hours cost 0 and job costing says so rather than pretending they are free.")}
        </div>
      </div>
      <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" inputMode="decimal" style={{ ...inp, flex: "0 0 110px" }} aria-label={he ? "עלות לשעה" : "Cost per hour"} />
      <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ ...inp, flex: "0 0 150px" }} aria-label={he ? "בתוקף מ" : "Effective from"} />
      <button type="button" disabled={busy || !amount.trim()} style={btn} onClick={() => onSave(amount, from)}>{he ? "שמירה" : "Save"}</button>
    </div>
  );
}

const card: React.CSSProperties = { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: 18, marginBottom: 16, boxShadow: "0 6px 18px rgba(15,42,94,.06)" };
const h3: React.CSSProperties = { fontSize: 15, fontWeight: 800, marginBottom: 8 };
const hint: React.CSSProperties = { fontSize: 12.5, color: "#5c6675", marginBottom: 10, lineHeight: 1.5 };
const row: React.CSSProperties = { display: "flex", alignItems: "center", gap: 8, padding: "10px 0", borderTop: "1px solid #f1f4f9", flexWrap: "wrap" };
const inp: React.CSSProperties = { border: "1px solid #e2e8f0", borderRadius: 10, padding: "9px 11px", fontSize: 13.5, outline: "none", background: "#fff" };
const btn: React.CSSProperties = { background: "#2563eb", color: "#fff", border: "none", padding: "9px 14px", borderRadius: 10, fontWeight: 700, cursor: "pointer", fontSize: 13.5 };
const rm: React.CSSProperties = { background: "#fdeaea", color: "#dc2626", border: "none", padding: "7px 12px", borderRadius: 9, fontWeight: 700, fontSize: 13, cursor: "pointer" };
const err: React.CSSProperties = { background: "#fdeaea", color: "#dc2626", padding: "9px 12px", borderRadius: 10, fontSize: 13, marginBottom: 10 };
