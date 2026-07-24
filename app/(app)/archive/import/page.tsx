import { requireProfile } from "@/lib/auth";
import { redirect } from "next/navigation";
import LegacyImportClient from "../LegacyImportClient";

export const dynamic = "force-dynamic";

export default async function ArchiveImportPage() {
  const profile = await requireProfile();
  if (profile.role === "tech") redirect("/");
  return <LegacyImportClient />;
}
