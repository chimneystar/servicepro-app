import { createClient } from "@/lib/supabase/server";
import { money } from "@/lib/format";
import { submitPortalRequest } from "./actions";

export const dynamic = "force-dynamic";
const SC: Record<string, string> = {
  draft: "#eef1f6|#57606f",
  sent: "#e0ebff|#2563eb",
  approved: "#e8efff|#2458c9",
  rejected: "#fdeaea|#dc2626",
  unpaid: "#fff5c9|#735b00",
  paid: "#e6f6ec|#15803d",
  scheduled: "#e0ebff|#2563eb",
  in_progress: "#fff5c9|#735b00",
  done: "#e6f6ec|#15803d",
  cancelled: "#eef1f6|#57606f",
};

export default async function PortalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = await createClient();
  const { data } = await supabase.rpc("public_customer_portal", { p_token: token });
  const d: any = data;
  if (!d)
    return (
      <Wrap accent="#102a56">
        <p className="portal-empty">
          This portal link is not valid.
          <br />
          <span dir="rtl">הקישור לאזור הלקוח אינו תקין.</span>
        </p>
      </Wrap>
    );
  const he = d.org?.locale === "he";
  const accent = d.org?.accent_color || "#2463eb";
  const cur = d.org?.currency ?? "USD";
  const now = new Date().toISOString().slice(0, 10);
  const upcoming = (d.jobs ?? [])
    .filter((job: any) => job.date >= now && !["done", "cancelled"].includes(job.status))
    .sort((a: any, b: any) => a.date.localeCompare(b.date));
  return (
    <Wrap accent={accent}>
      <div
        className="customer-portal"
        style={{ "--portal-accent": accent } as React.CSSProperties}
        dir={he ? "rtl" : "ltr"}
      >
        <header className="portal-brand">
          <div>{d.org?.logo_url ? <img src={d.org.logo_url} alt="" /> : <span>SP</span>}</div>
          <div>
            <strong>{d.org?.name}</strong>
            <small>
              {he
                ? `טוב לראות אותך, ${String(d.customer?.name ?? "").split(" ")[0]}`
                : `Welcome back, ${String(d.customer?.name ?? "").split(" ")[0]}`}
            </small>
          </div>
        </header>
        <main>
          {upcoming.length > 0 && (
            <Section title={he ? "התור הבא" : "Next appointment"}>
              <article className="portal-next">
                <div>
                  <small>
                    {new Intl.DateTimeFormat(he ? "he-IL" : "en-US", {
                      weekday: "long",
                      month: "long",
                      day: "numeric",
                    }).format(new Date(`${upcoming[0].date}T12:00:00`))}
                  </small>
                  <strong>{upcoming[0].service}</strong>
                  <p>
                    {[
                      (upcoming[0].start_time ?? "").slice(0, 5),
                      upcoming[0].address,
                      upcoming[0].city,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <Pill s={upcoming[0].status} />
                <details>
                  <summary>{he ? "בקשה לשינוי מועד" : "Request a different date"}</summary>
                  <form action={submitPortalRequest.bind(null, token)}>
                    <input type="hidden" name="type" value="reschedule" />
                    <input type="hidden" name="jobId" value={upcoming[0].id} />
                    <input
                      type="date"
                      name="date"
                      min={now}
                      required
                      aria-label={he ? "תאריך מבוקש" : "Requested date"}
                    />
                    <textarea
                      name="message"
                      placeholder={
                        he
                          ? "שעה מועדפת או משהו שחשוב שנדע"
                          : "Preferred time or anything we should know"
                      }
                      aria-label={
                        he
                          ? "שעה מועדפת או משהו שחשוב שנדע"
                          : "Preferred time or anything we should know"
                      }
                    />
                    <button type="submit">{he ? "שליחת הבקשה" : "Send request"}</button>
                  </form>
                </details>
              </article>
            </Section>
          )}
          <div className="portal-two">
            <Section title={he ? "חשבוניות" : "Invoices"}>
              {(d.invoices ?? []).length ? (
                (d.invoices ?? []).map((row: any, index: number) => (
                  <Doc key={index} kind={he ? "חשבונית" : "Invoice"} row={row} cur={cur} />
                ))
              ) : (
                <Empty he={he} />
              )}
            </Section>
            <Section title={he ? "הצעות מחיר" : "Estimates"}>
              {(d.estimates ?? []).length ? (
                (d.estimates ?? []).map((row: any, index: number) => (
                  <Doc key={index} kind={he ? "הצעה" : "Estimate"} row={row} cur={cur} />
                ))
              ) : (
                <Empty he={he} />
              )}
            </Section>
          </div>
          <Section title={he ? "היסטוריית שירות" : "Service history"}>
            <div className="portal-history">
              {(d.jobs ?? []).length ? (
                (d.jobs ?? []).map((job: any, index: number) => (
                  <div key={index}>
                    <div>
                      <strong>{job.service}</strong>
                      <small>
                        {new Intl.DateTimeFormat(he ? "he-IL" : "en-US", {
                          dateStyle: "medium",
                        }).format(new Date(`${job.date}T12:00:00`))}
                      </small>
                    </div>
                    <Pill s={job.status} />
                  </div>
                ))
              ) : (
                <Empty he={he} />
              )}
            </div>
          </Section>
          <Section title={he ? "איך נוח לקבל עדכונים?" : "How should we keep you updated?"}>
            <form className="portal-preferences" action={submitPortalRequest.bind(null, token)}>
              <input type="hidden" name="type" value="preferences" />
              <label>
                <input
                  type="checkbox"
                  name="emailOptIn"
                  defaultChecked={d.customer?.email_opt_in}
                />
                <span>
                  <strong>Email</strong>
                  <small>{d.customer?.email || (he ? "לא הוגדר" : "Not provided")}</small>
                </span>
              </label>
              <label>
                <input type="checkbox" name="smsOptIn" defaultChecked={d.customer?.sms_opt_in} />
                <span>
                  <strong>SMS</strong>
                  <small>{d.customer?.phone}</small>
                </span>
              </label>
              <button type="submit">{he ? "שמירת העדפות" : "Save preferences"}</button>
            </form>
          </Section>
          <p className="portal-contact">
            {he ? "יש שאלה? אפשר לפנות אלינו" : "Questions? Contact us"}:{" "}
            {d.org?.phone || d.org?.email}.
          </p>
        </main>
      </div>
    </Wrap>
  );
}

function Doc({ kind, row, cur }: { kind: string; row: any; cur: string }) {
  return (
    <a className="portal-doc" href={`/p/${row.token}`} target="_blank">
      <div>
        <strong>
          {kind} #{row.number}
        </strong>
        <small>{row.issue_date}</small>
      </div>
      <b>{money(row.total_minor, cur)}</b>
      <Pill s={row.status} />
    </a>
  );
}
function Pill({ s }: { s: string }) {
  const [bg, fg] = (SC[s] ?? "#eef1f6|#57606f").split("|");
  return (
    <span className="portal-pill" style={{ background: bg, color: fg }}>
      {s?.replaceAll("_", " ")}
    </span>
  );
}
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="portal-section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}
function Empty({ he }: { he: boolean }) {
  return <div className="portal-empty">{he ? "עוד אין כאן פריטים." : "Nothing here yet."}</div>;
}
function Wrap({ children, accent }: { children: React.ReactNode; accent: string }) {
  return (
    <div className="portal-wrap" style={{ borderColor: accent }}>
      {children}
    </div>
  );
}
