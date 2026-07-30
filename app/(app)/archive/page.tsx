import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import ArchiveList, { type ArchRow } from "./ArchiveList";

export const dynamic = "force-dynamic";

export default async function ArchivePage() {
  const profile = await requireProfile();
  if (profile.role === "tech") redirect("/");
  const supabase = await createClient();
  const { data } = await supabase.from("customers")
    .select("id, name, phone, email, address, city, legacy_note")
    .is("deleted_at", null).eq("archived", true).order("name");

  return (
    <div style={{ maxWidth: 760 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 6, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800 }}>Archive (legacy records)</h1>
          <p style={{ color: "#5c6675", fontSize: 14 }}>{(data ?? []).length} archived · kept separate from your active data</p>
        </div>
        <Link href="/archive/import" style={{ background: "#9a3412", color: "#fff", borderRadius: 10, padding: "10px 14px", fontWeight: 700, fontSize: 14, textDecoration: "none" }}>⬆ Import old records</Link>
      </div>
      <div style={{ background: "#fff7ed", border: "1px solid #fed7aa", color: "#9a3412", borderRadius: 12, padding: "11px 14px", fontSize: 14, margin: "10px 0 16px" }}>
        🗄️ This is your records-only area. Archived clients don’t show in active customers, scheduling, or reports. Use <b>Restore</b> to bring one back into active use.
      </div>
      <ArchiveList records={(data ?? []) as ArchRow[]} />
    </div>
  );
}
