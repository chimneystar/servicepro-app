import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getLocale } from "@/lib/locale-server";
import * as techniciansData from "@/lib/data/technicians";
import * as fieldData from "@/lib/data/field";

export const dynamic = "force-dynamic";
export default async function FleetPage() {
  const profile = await requireProfile();
  if (profile.role === "tech") redirect("/tech");
  const locale = await getLocale();
  const he = locale === "he";
  const supabase = await createClient();
  const [team, locations, consents] = await Promise.all([
    fieldData.listTechProfiles(supabase),
    fieldData.listLatestTechLocations(supabase, 500),
    techniciansData.listLocationConsents(supabase),
  ]);
  const latest = new Map<string, any>();
  for (const row of locations) if (!latest.has(row.profile_id)) latest.set(row.profile_id, row);
  const active = team.map((tech) => ({
    ...tech,
    location: latest.get(tech.id) ?? null,
    consented: consents.some((row) => row.profile_id === tech.id && row.consented),
  }));
  const mapped = active.filter((row) => row.location);
  const lats = mapped.map((row) => row.location.latitude);
  const lngs = mapped.map((row) => row.location.longitude);
  const minLat = Math.min(...lats, 0),
    maxLat = Math.max(...lats, 0),
    minLng = Math.min(...lngs, 0),
    maxLng = Math.max(...lngs, 0);
  const pos = (value: number, min: number, max: number) =>
    max === min ? 50 : ((value - min) / (max - min)) * 80 + 10;
  return (
    <div className="fleet-page">
      <header className="ops-hero">
        <span>{he ? "צוות בשטח" : "Field team"}</span>
        <h1>{he ? "מיקום אחרון — רק בהסכמה" : "Latest location—with clear consent"}</h1>
        <p>
          {he
            ? "המיקום מוצג רק כשטכנאי הפעיל שיתוף. השעה האחרונה תמיד מופיעה כדי שלא תטעו לחשוב שזה מיקום חי."
            : "A location appears only when a technician turns sharing on. The last update time is always visible so stale data is never mistaken for live data."}
        </p>
      </header>
      <div className="fleet-grid">
        <section className="fleet-map">
          {mapped.length ? (
            mapped.map((tech) => (
              <a
                key={tech.id}
                href={`https://maps.google.com/?q=${tech.location.latitude},${tech.location.longitude}`}
                target="_blank"
                style={{
                  insetInlineStart: `${pos(tech.location.longitude, minLng, maxLng)}%`,
                  bottom: `${pos(tech.location.latitude, minLat, maxLat)}%`,
                }}
              >
                <b>{tech.full_name.slice(0, 1)}</b>
                <span>{tech.full_name}</span>
              </a>
            ))
          ) : (
            <div>{he ? "עוד לא שותף מיקום." : "No location has been shared yet."}</div>
          )}
        </section>
        <section className="fleet-list">
          {active.map((tech) => (
            <article key={tech.id}>
              <div className="dispatch-avatar">{tech.full_name.slice(0, 1)}</div>
              <div>
                <strong>{tech.full_name}</strong>
                <small>
                  {tech.location
                    ? `${he ? "עודכן" : "Updated"} ${new Intl.DateTimeFormat(he ? "he-IL" : "en-US", { dateStyle: "short", timeStyle: "short" }).format(new Date(tech.location.recorded_at))}`
                    : tech.consented
                      ? he
                        ? "ממתין למיקום ראשון"
                        : "Waiting for first location"
                      : he
                        ? "השיתוף כבוי"
                        : "Sharing is off"}
                </small>
              </div>
              {tech.location && (
                <a
                  href={`https://maps.google.com/?q=${tech.location.latitude},${tech.location.longitude}`}
                  target="_blank"
                >
                  {he ? "פתיחה במפה" : "Open map"}
                </a>
              )}
            </article>
          ))}
        </section>
      </div>
    </div>
  );
}
