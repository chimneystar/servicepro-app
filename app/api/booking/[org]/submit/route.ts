import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { addMinutes, buildBookingSlots, createBookingReference, evaluateServiceArea, type BookingHours, type ServiceArea } from "@/lib/booking";
import { raiseBookingDeposit } from "@/lib/payments/booking-deposit";
// @ts-ignore — proven both ways in tests/rate-limit.test.mjs
import { consume, clientKey } from "@/lib/core/rate-limit.mjs";
// @ts-ignore — proven both ways in tests/deposits.test.mjs
import { bookingDepositMinor } from "@/lib/core/deposits.mjs";
// @ts-ignore — proven both ways in tests/availability.test.mjs
import { bookingCapacity } from "@/lib/core/availability.mjs";

export const dynamic = "force-dynamic";
const clean = (value: unknown, max: number) => String(value ?? "").trim().slice(0,max);

export async function POST(request: Request, { params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  let body: Record<string,unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ ok:false,error:"invalid_request" },{status:400}); }
  const name=clean(body.name,120), phone=clean(body.phone,40), email=clean(body.email,160), serviceId=clean(body.serviceId,60), date=clean(body.date,10), start=clean(body.start,5);
  const address=clean(body.address,200), city=clean(body.city,80), postalCode=clean(body.postalCode,20), notes=clean(body.notes,2000), source=clean(body.source,80)||"Online booking", campaign=clean(body.campaign,120), contactPreference=clean(body.contactPreference,20)||"phone", urgency=clean(body.urgency,20)||"standard";
  if (!name || !phone || !serviceId || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(start)) return NextResponse.json({ok:false,error:"missing_fields"},{status:400});

  // Per-caller throttle, in ADDITION to the existing per-organisation counter
  // below. That counter is global to the business, so it is itself a denial of
  // service: anyone with the org UUID could saturate it and block genuine
  // customers from booking. This one stops the abuser without touching anyone
  // else's allowance.
  const perCaller = consume(`booking:submit:${clientKey(request.headers)}:${org}`, 5, 600_000);
  if (!perCaller.allowed) {
    return NextResponse.json({ ok: false, error: "try_later" }, {
      status: 429,
      headers: { "retry-after": String(perCaller.retryAfterSeconds) },
    });
  }

  try {
    const admin=createAdminClient();
    const [{data:settings},{data:service},{data:areas},{data:jobs},{count:capacity},{count:recent},{data:timeOff}] = await Promise.all([
      admin.from("booking_settings").select("*").eq("organization_id",org).single(),
      admin.from("booking_services").select("*").eq("organization_id",org).eq("id",serviceId).eq("active",true).single(),
      admin.from("service_areas").select("area_type,values_json,active").eq("organization_id",org).eq("active",true),
      admin.from("jobs").select("start_time,end_time").eq("organization_id",org).eq("scheduled_date",date).is("deleted_at",null).neq("status","cancelled"),
      admin.from("profiles").select("id",{count:"exact",head:true}).eq("organization_id",org).eq("active",true).in("role",["owner","tech"]),
      admin.from("leads").select("id",{count:"exact",head:true}).eq("organization_id",org).not("booking_reference","is",null).gte("created_at",new Date(Date.now()-10*60_000).toISOString()),
      // 6c.3 — the SAME availability inputs the slots route uses. Without this
      // the slot list would hide a holiday and this endpoint would still accept
      // a hand-crafted POST for it, which is the shape of every "the UI checks
      // it" defect this branch exists to remove.
      admin.from("technician_time_off").select("profile_id,starts_on,ends_on,start_time,end_time,status")
        .eq("organization_id",org).eq("status","approved").lte("starts_on",date).gte("ends_on",date),
    ]);
    if (!settings?.enabled || !service) return NextResponse.json({ok:false,error:"booking_unavailable"},{status:404});
    if ((recent??0)>=25) return NextResponse.json({ok:false,error:"try_later"},{status:429});
    // Service area, as a TRI-STATE. "outside" is refused. "unevaluable" means the
    // org configured enforcement using only polygon areas, which cannot be tested
    // without a geocoded point this product never produces (no PostGIS, no
    // geocoder, addresses are free text). Previously that case returned true and
    // every address sailed through while the toggle claimed enforcement.
    //
    // We neither accept it silently nor reject every customer of a
    // misconfigured business: the booking is taken but is NOT auto-confirmed —
    // it lands in Leads as "requested" for a human to approve, and carries a
    // marker saying why. The owner is warned about the same condition on
    // /settings/booking. See docs/REMEDIATION-PLAN.md item 4.8.
    const verdict=settings.enforce_service_area?evaluateServiceArea(postalCode,city,(areas??[]) as ServiceArea[]):"match";
    if (verdict==="outside") return NextResponse.json({ok:false,error:"outside_area"},{status:422});
    const areaUnverified=verdict==="unevaluable";
    if (areaUnverified) console.warn(JSON.stringify({event:"booking.service_area_unevaluable",organizationId:org,reason:"polygon_only_areas_cannot_be_evaluated_without_geocoding"}));
    const needsReview=Boolean(settings.approval_required)||areaUnverified;
    const availability=bookingCapacity({teamSize:settings.use_team_capacity?Math.max(1,capacity??1):1,rows:timeOff??[],day:date});
    const available=buildBookingSlots({date,hours:settings.hours_json as BookingHours,intervalMin:settings.slot_interval_min,durationMin:service.duration_min,arrivalWindowMin:settings.arrival_window_min,minNoticeHours:settings.min_notice_hours,maxDaysAhead:settings.max_days_ahead,capacity:availability.capacity,busy:(jobs??[]).map((row)=>({start:row.start_time,end:row.end_time})),timeZone:settings.timezone,closedWindows:availability.closedWindows,awayWindows:availability.awayWindows});
    if (!available.some((slot)=>slot.start===start)) return NextResponse.json({ok:false,error:"slot_taken"},{status:409});
    const reference=createBookingReference();
    const answers=typeof body.answers==="object"&&body.answers?body.answers:{};
    // The marker rides on booking_answers (jsonb, already on the row) so the
    // office can see WHY this request needs a look instead of guessing.
    // The booking deposit. booking_settings.payment_mode and deposit_value were
    // stored, echoed to the customer as "a secure payment link will be sent
    // after confirmation", and CHARGED NOTHING — no link was ever produced. A
    // deposit now makes the booking deposit-gated: it is taken as a real
    // estimate on the existing /p/<token> payment screen, and the job is not
    // created until the money is in (or, if the business turned
    // ach_hold_until_settled off, as soon as an ACH transfer is submitted).
    const depositMinor=bookingDepositMinor({mode:settings.payment_mode,value:settings.deposit_value,servicePriceMinor:service.price_minor});
    const depositDue=depositMinor>0;
    // Whether this booking would have been auto-confirmed but for the deposit.
    // Carried on booking_answers rather than as a new booking_status value, so
    // no existing screen meets a status string it does not know, and so a
    // business that requires approval still gets to approve.
    const autoRelease=!needsReview&&service.book_as==="job";
    const bookingAnswers={...(areaUnverified?{...answers,service_area_unverified:true}:answers),...(depositDue?{deposit_required_minor:depositMinor,auto_release_on_deposit:autoRelease}:{})};
    const leadPayload={organization_id:org,name,phone,email:email||null,address:address||null,city:city||null,postal_code:postalCode||null,service:service.name_en,notes:notes||null,status:"new",source,preferred_date:date,preferred_start_time:start,preferred_window_min:settings.arrival_window_min,booking_service_id:service.id,booking_answers:bookingAnswers,booking_reference:reference,booking_status:(needsReview||depositDue)?"requested":"confirmed",campaign:campaign||null,contact_preference:contactPreference,urgency};
    const {data:lead,error:leadError}=await admin.from("leads").insert(leadPayload).select("id").single();
    if(leadError) throw leadError;

    // A customer record is needed both to schedule the job and to raise the
    // deposit estimate against, so resolving it is shared rather than copied.
    const resolveCustomer=async()=>{
      let customer=null;
      if(email){const {data}=await admin.from("customers").select("id").eq("organization_id",org).ilike("email",email).is("deleted_at",null).limit(1).maybeSingle();customer=data;}
      if(!customer){const {data}=await admin.from("customers").select("id").eq("organization_id",org).eq("phone",phone).is("deleted_at",null).limit(1).maybeSingle();customer=data;}
      if(!customer){const {data,error}=await admin.from("customers").insert({organization_id:org,name,phone,email:email||null,address:address||null,city:city||null,source,notes:notes||null}).select("id").single();if(error)throw error;customer=data;}
      return customer;
    };

    let status="requested";
    let deposit:{amountMinor:number;url:string}|null=null;

    if(depositDue){
      const customer=await resolveCustomer();
      await admin.from("leads").update({converted_customer_id:customer.id}).eq("id",lead.id);
      const {data:organization}=await admin.from("organizations").select("tax_rate_bps").eq("id",org).single();
      const raised=await raiseBookingDeposit(admin,{
        organizationId:org,customerId:customer.id,leadId:lead.id,customerName:name,
        serviceName:service.name_en,servicePriceMinor:service.price_minor,
        paymentMode:settings.payment_mode,depositValue:settings.deposit_value,
        taxRateBps:Number(organization?.tax_rate_bps??0),notes:notes||null,
      });
      if(raised) { deposit={amountMinor:raised.amountMinor,url:`/p/${raised.publicToken}`}; status="deposit_due"; }
    } else if(autoRelease){
      const customer=await resolveCustomer();
      // end_date must be set. It is nullable with no default, and the dispatch
      // board matches `scheduled_date <= day AND (end_date >= day OR end_date IS
      // NULL)` — so a job left with a null end_date reappears on EVERY future
      // day, forever. Same defect as the recurring generators.
      const {error:jobError}=await admin.from("jobs").insert({organization_id:org,customer_id:customer.id,assigned_to:null,service:service.name_en,status:"scheduled",price_minor:service.price_minor,scheduled_date:date,end_date:date,start_time:start,end_time:addMinutes(start,service.duration_min),source,notes:notes||null});
      if(jobError)throw jobError;
      await admin.from("leads").update({status:"won",converted_customer_id:customer.id,booking_status:"confirmed"}).eq("id",lead.id);
      status="confirmed";
    }
    return NextResponse.json({ok:true,reference,status,paymentMode:settings.payment_mode,depositValue:settings.deposit_value,deposit},{headers:{"cache-control":"no-store"}});
  } catch { return NextResponse.json({ok:false,error:"server_error"},{status:500}); }
}
