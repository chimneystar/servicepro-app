import { redirect } from "next/navigation";
import { getMembershipContext } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const context = await getMembershipContext();
  if (!context) redirect("/login");
  if (!context.profile || !context.membership) redirect("/onboarding");
  redirect("/app");
}
