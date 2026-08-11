import type { ActivityEntry } from "@/lib/activity";
import type { Locale } from "@/lib/i18n";

const hiddenFields = new Set([
  "updated_at",
  "created_at",
  "organization_id",
  "public_token",
  "portal_token",
  "deleted_at",
]);

function changedFields(entry: ActivityEntry, locale: Locale) {
  if (entry.action !== "UPDATE" || !entry.old_data || !entry.new_data) return [];
  return Object.keys(entry.new_data)
    .filter(
      (key) =>
        !hiddenFields.has(key) &&
        JSON.stringify(entry.old_data?.[key]) !== JSON.stringify(entry.new_data?.[key]),
    )
    .slice(0, 4)
    .map((key) => key.replaceAll("_", " "));
}

export default function ActivityTimeline({
  entries,
  locale,
}: {
  entries: ActivityEntry[];
  locale: Locale;
}) {
  const he = locale === "he";
  const action = (value: string) =>
    ({
      INSERT: he ? "נוצר" : "Created",
      UPDATE: he ? "עודכן" : "Updated",
      DELETE: he ? "נמחק" : "Deleted",
    })[value] ?? value;
  return (
    <section className="activity-card">
      <div className="activity-heading">
        <div>
          <span>{he ? "היסטוריית פעילות" : "Activity history"}</span>
          <small>{he ? "מי שינה מה ומתי" : "Who changed what and when"}</small>
        </div>
        <b>{entries.length}</b>
      </div>
      {entries.length === 0 ? (
        <div className="activity-empty">
          {he ? "עדיין אין שינויים מתועדים." : "No recorded changes yet."}
        </div>
      ) : (
        <ol className="activity-list">
          {entries.map((entry) => {
            const fields = changedFields(entry, locale);
            return (
              <li key={entry.id}>
                <span className="activity-dot" />
                <div>
                  <strong>{action(entry.action)}</strong>
                  <p>
                    {entry.actor_name || (he ? "המערכת" : "System")}
                    {fields.length ? ` · ${he ? "שדות" : "Fields"}: ${fields.join(", ")}` : ""}
                  </p>
                  <time dateTime={entry.at}>
                    {new Intl.DateTimeFormat(he ? "he-IL" : "en-US", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    }).format(new Date(entry.at))}
                  </time>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
