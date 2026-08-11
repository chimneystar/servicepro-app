import { createClient } from "@/lib/supabase/server";
import BookingForm, { type BookingOrg } from "./BookingForm";

export const dynamic = "force-dynamic";

export default async function BookingPage({ params }: { params: Promise<{ org: string }> }) {
  const { org: orgId } = await params;
  const supabase = await createClient();
  const { data } = await supabase.rpc("public_booking_info_v2", { p_org: orgId });
  const org = data as BookingOrg | null;
  if (!org)
    return (
      <main className="booking-invalid">
        <span aria-hidden="true">!</span>
        <h1>Booking link unavailable</h1>
        <p>This booking page is not active. Contact the business directly for help.</p>
      </main>
    );
  return <BookingForm org={org} />;
}
