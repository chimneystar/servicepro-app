import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import MessageTemplatesEditor, { type Template } from "@/components/MessageTemplatesEditor";
import { getLocale } from "@/lib/locale-server";
import * as operationsRepo from "@/lib/data/operations";

export const dynamic = "force-dynamic";

export default async function MessagesSettingsPage() {
  const profile = await requireProfile();
  if (profile.role !== "owner") redirect("/");
  const locale = await getLocale();
  const he = locale === "he";
  const supabase = await createClient();
  const templates = (await operationsRepo.listMessageTemplates(supabase)) as Template[];

  return (
    <div style={{ maxWidth: 640 }}>
      <Link
        href="/settings"
        style={{ color: "#2b66f6", fontWeight: 700, fontSize: "0.875rem", textDecoration: "none" }}
      >
        {he ? "חזרה להגדרות" : "Back to settings"}
      </Link>
      <h1 style={{ fontSize: "1.5rem", fontWeight: 800, margin: "8px 0 4px" }}>
        {he ? "הודעות ללקוחות" : "Customer messages"}
      </h1>
      <p style={{ color: "#66728a", fontSize: "0.8125rem", marginBottom: 16 }}>
        {he
          ? "הודעות אוטומטיות שנשלחות ללקוחות לפני העבודה ואחריה."
          : "Automatic messages customers receive before and after an appointment."}
      </p>
      <MessageTemplatesEditor locale={locale} templates={templates} />
    </div>
  );
}
