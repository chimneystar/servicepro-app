import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import MessageTemplatesEditor, { type Template } from "@/components/MessageTemplatesEditor";

export const dynamic = "force-dynamic";

export default async function MessagesSettingsPage() {
  const profile = await requireProfile();
  if (profile.role !== "owner") redirect("/");
  const supabase = createClient();
  const { data } = await supabase.from("message_templates").select("trigger, enabled, body");
  const templates = (data ?? []) as Template[];

  return (
    <div style={{ maxWidth: 640 }}>
      <Link href="/settings" style={{ color: "#2563eb", fontWeight: 700, fontSize: 14, textDecoration: "none" }}>‹ Settings</Link>
      <h1 style={{ fontSize: 24, fontWeight: 800, margin: "8px 0 4px" }}>Client messages</h1>
      <p style={{ color: "#5c6675", fontSize: 13, marginBottom: 16 }}>Automatic text messages your clients receive around each appointment.</p>
      <MessageTemplatesEditor templates={templates} />
    </div>
  );
}
