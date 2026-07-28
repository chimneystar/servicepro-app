import { ServiceProApp } from "@/components/servicepro-app";
import { loadAppData } from "@/lib/data";

export const metadata = { title: "העסק שלי" };
export const dynamic = "force-dynamic";

export default async function AppPage() {
  const data = await loadAppData();
  return <ServiceProApp data={data} />;
}
