import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { addMinutes, buildBookingSlots, createBookingReference, matchesServiceArea, type BookingHours, type ServiceArea } from "@/lib/booking";

export const dynamic = "force-dynamic";
const clean = (value: unknown, max: number) => String(value ?? "").trim().slice(0,max);

export async function POST(request: Request, { params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  let body: Record<string,unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ ok:false,error:"invalid_request" },{status:400}); }
  const name=clean(body.name,120), phone=clean(body.phone,40), email=clean(body.email,160), serviceId=clean(body.serviceId,60), date=clean(body.date,10), start=clean(body.start,5);
  const address=clean(body.address,200), city=clean(body.city,80), postalCode=clean(body.postalCode,20), notes=clean(body.notes,2000), source=clean(body.source,80)||"Online booking", campaign=clean(body.campaign,120), contactPreference=clean(body.contactPreference,20)||"phone", urgency=clean(body.urgency,20)||"standard";
  if (!name || !phone || !serviceId || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(start)) return NextResponse.json({ok:false,error:"missing_fields"},{status:400});
  try {
    const admin=createAdminClient();
    const [{data:settings},{data:service},{data:areas},{data:jobs},{count:capacity},{count:recent}] = await Promise.all([
      admin.from("booking_settings").select("*").eq("organization_id",org).single(),
      admin.from("booking_services").select("*").eq("organization_id",org).eq("id",serviceId).eq("active",true).single(),
      admin.from("service_areas").select("area_type,values_json,active").eq("organization_id",org).eq("active",true),
      admin.from("jobs").select("start_time,end_time").eq("organization_id",org).eq("scheduled_date",date).is("deleted_at",null).neq("status","cancelled"),
      admin.from("profiles").select("id",{count:"exact",head:true}).eq("organization_id",org).eq("active",true).in("role",["owner","tech"]),
      admin.from("leads").select("id",{count:"exact",head:true}).eq("organization_id",org).not("booking_reference","is",null).gte("created_at",new Date(Date.now()-10*60_000).toISOString()),
    ]);
    if (!settings?.enabled || !service) return NextResponse.json({ok:false,error:"booking_unavailable"},{status:404});
    if ((recent??0)>=25) return NextResponse.json({ok:false,error:"try_later"},{status:429});
    if (settings.enforce_service_area && !matchesServiceArea(postalCode,city,(areas??[]) as ServiceArea[])) return NextResponse.json({ok:false,error:"outside_area"},{status:422});
    const available=buildBookingSlots({date,hours:settings.hours_json as BookingHours,intervalMin:settings.slot_interval_min,durationMin:service.duration_min,arrivalWindowMin:settings.arrival_window_min,minNoticeHours:settings.min_notice_hours,maxDaysAhead:settings.max_days_ahead,capacity:settings.use_team_capacity?Math.max(1,capacity??1):1,busy:(jobs??[]).map((row)=>({start:row.start_time,end:row.end_time}))});
    if (!available.some((slot)=>slot.start===start)) return NextResponse.json({ok:false,error:"slot_taken"},{status:409});
    const reference=createBookingReference();
    const answers=typeof body.answers==="object"&&body.answers?body.answers:{};
    const leadPayload={organization_id:org,name,phone,email:email||null,address:address||null,city:city||null,postal_code:postalCode||null,service:service.name_en,notes:notes||null,status:"new",source,preferred_date:date,preferred_start_time:start,preferred_window_min:settings.arrival_window_min,booking_service_id:service.id,booking_answers:answers,booking_reference:reference,booking_status:settings.approval_required?"requested":"confirmed",campaign:campaign||null,contact_preference:contactPreference,urgency};
    const {data:lead,error:leadError}=await admin.from("leads").insert(leadPayload).select("id").single();
    if(leadError) throw leadError;
    let status="requested";
    if(!settings.approval_required&&service.book_as==="job"){
      let customer=null;
      if(email){const {data}=await admin.from("customers").select("id").eq("organization_id",org).ilike("email",email).is("deleted_at",null).limit(1).maybeSingle();customer=data;}
      if(!customer){const {data}=await admin.from("customers").select("id").eq("organization_id",org).eq("phone",phone).is("deleted_at",null).limit(1).maybeSingle();customer=data;}
      if(!customer){const {data,error}=await admin.from("customers").insert({organization_id:org,name,phone,email:email||null,address:address||null,city:city||null,source,notes:notes||null}).select("id").single();if(error)throw error;customer=data;}
      const {error:jobError}=await admin.from("jobs").insert({organization_id:org,customer_id:customer.id,assigned_to:null,service:service.name_en,status:"scheduled",price_minor:service.price_minor,scheduled_date:date,start_time:start,end_time:addMinutes(start,service.duration_min),source,notes:notes||null});
      if(jobError)throw jobError;
      await admin.from("leads").update({status:"won",converted_customer_id:customer.id,booking_status:"confirmed"}).eq("id",lead.id);
      status="confirmed";
    }
    return NextResponse.json({ok:true,reference,status,paymentMode:settings.payment_mode,depositValue:settings.deposit_value},{headers:{"cache-control":"no-store"}});
  } catch { return NextResponse.json({ok:false,error:"server_error"},{status:500}); }
}
