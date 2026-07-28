import { notFound } from "next/navigation";
import { ServiceProApp } from "@/components/servicepro-app";
import { makeMockData } from "@/lib/mock-data";

export const dynamic = "force-dynamic";
export const metadata = { title: "תצוגה מקדימה" };

export default function PreviewPage() {
  if (process.env.SERVICEPRO_PREVIEW !== "true") notFound();
  return <ServiceProApp data={makeMockData()} />;
}
