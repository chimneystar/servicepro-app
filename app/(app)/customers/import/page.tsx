import { requireProfile } from "@/lib/auth";
import { redirect } from "next/navigation";
import ImportClient from "./ImportClient";

export const dynamic = "force-dynamic";

export default async function ImportPage() {
  const profile = await requireProfile();
  if (profile.role === "tech") redirect("/");
  return <ImportClient />;
}
