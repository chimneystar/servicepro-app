import { createClient } from "@/lib/supabase/server";
import Image from "next/image";
import BookingForm, { type BookingOrg } from "./BookingForm";

export const dynamic="force-dynamic";

export default async function BookingPage({params}:{params:Promise<{org:string}>}){
  const {org:orgId}=await params; const supabase=await createClient(); const {data}=await supabase.rpc("public_booking_info_v2",{p_org:orgId}); const org=data as BookingOrg|null;
  if(!org)return <main className="booking-invalid"><span aria-hidden="true">!</span><h1>Booking link unavailable</h1><p>This booking page is not active. Contact the business directly for help.</p></main>;
  return <main className="booking-page" style={{"--booking-accent":org.accent_color||"#2b66f6"} as React.CSSProperties}>
    <aside className="booking-brand"><div className="booking-logo">{org.logo_url?<Image src={org.logo_url} alt="" width={72} height={72} unoptimized/>:<span className="brand-mark"/>}</div><div><strong>{org.name}</strong><small>{org.tagline||(org.locale==="he"?"שירות מקצועי, בלי לחכות":"Professional service, without the wait")}</small></div>{org.phone&&<a href={`tel:${org.phone}`}>{org.locale==="he"?"צריכים לדבר?":"Prefer to call?"}<b>{org.phone}</b></a>}</aside>
    <section className="booking-card"><BookingForm org={org}/><p className="booking-powered">Powered by ServicePro · Secure booking</p></section>
  </main>;
}
