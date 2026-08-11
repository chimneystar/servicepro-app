"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { setJobTags } from "@/app/(app)/jobs/[id]/actions";
import { useAppLocale } from "@/components/LocaleProvider";
import { ActionError, useActionStatus } from "@/components/ActionStatus";

const SUGGESTED = {
  en: ["Follow up", "Waiting for payment", "Waiting on parts", "Urgent", "Warranty", "Callback"],
  he: ["צריך מעקב", "ממתינים לתשלום", "ממתינים לחלק", "דחוף", "אחריות", "לחזור ללקוח"],
};

export default function JobTagsEditor({ jobId, tags }: { jobId: string; tags: string[] }) {
  const router = useRouter();
  const he = useAppLocale() === "he";
  const { pending, error, run } = useActionStatus(he);
  const [list, setList] = useState<string[]>(tags ?? []);
  const [text, setText] = useState("");

  // The chips are optimistic. They used to STAY optimistic after a failed
  // write, so the job looked tagged until the next full page load.
  function save(next: string[]) {
    const previous = list;
    setList(next);
    run(
      () => setJobTags(jobId, next),
      () => router.refresh(),
      () => setList(previous),
    );
  }
  function add(tag: string) {
    const t = tag.trim();
    if (!t || list.includes(t)) return;
    save([...list, t]);
    setText("");
  }
  function remove(tag: string) {
    save(list.filter((x) => x !== tag));
  }

  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #e2e8f0",
        borderRadius: 12,
        padding: 14,
        marginTop: 12,
      }}
    >
      <div style={{ fontSize: "0.875rem", fontWeight: 700, color: "#334155", marginBottom: 8 }}>
        {he ? "תגיות" : "Tags"}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
        {list.map((t) => (
          <span
            key={t}
            className="pill"
            style={{ background: "#e0ebff", color: "#1d4ed8", gap: 6 }}
          >
            {t}
            <button
              type="button"
              onClick={() => remove(t)}
              disabled={pending}
              style={{
                border: "none",
                background: "transparent",
                color: "#1d4ed8",
                cursor: "pointer",
                fontWeight: 800,
              }}
              aria-label={he ? `הסרת התגית "${t}"` : `Remove tag "${t}"`}
            >
              ×
            </button>
          </span>
        ))}
        {list.length === 0 && (
          <span style={{ fontSize: "0.875rem", color: "#94a3b8" }}>
            {he ? "עוד אין תגיות." : "No tags yet."}
          </span>
        )}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add(text)}
          placeholder={he ? "הוספת תגית…" : "Add a tag…"}
          aria-label={he ? "הוספת תגית…" : "Add a tag…"}
          style={{
            flex: 1,
            border: "1px solid #e2e8f0",
            borderRadius: 10,
            padding: "9px 12px",
            fontSize: "1rem",
            outline: "none",
          }}
        />
        <button
          type="button"
          onClick={() => add(text)}
          disabled={pending}
          style={{
            background: "#2563eb",
            color: "#fff",
            border: "none",
            borderRadius: 10,
            padding: "9px 14px",
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          {he ? "הוספה" : "Add"}
        </button>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
        {(he ? SUGGESTED.he : SUGGESTED.en)
          .filter((s) => !list.includes(s))
          .map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => add(s)}
              disabled={pending}
              style={{
                background: "#f1f5fb",
                color: "#5c6675",
                border: "none",
                borderRadius: 20,
                padding: "4px 10px",
                fontSize: "0.875rem",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              + {s}
            </button>
          ))}
      </div>
      <ActionError error={error} />
    </div>
  );
}
