import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { Tables } from "@/lib/supabase/database.types";
import { getLocale } from "@/lib/locale-server";
import { money, fmtDate } from "@/lib/format";
import Link from "next/link";
import JobPhotos, { type Photo } from "@/components/JobPhotos";
import JobActions from "@/components/JobActions";
import Tabs from "@/components/Tabs";
import JobItems, { type Item } from "@/components/JobItems";
import JobParts, { type StockItem } from "./JobParts";
import JobCosting from "./JobCosting";
import JobAppointment from "./JobAppointment";
import JobTasks, { type Task } from "@/components/JobTasks";
import JobChecklist, { type Check } from "@/components/JobChecklist";
import JobEquipment, { type Equip } from "@/components/JobEquipment";
import JobPayments, { type InvPay } from "@/components/JobPayments";
import JobAddressForm from "@/components/JobAddressForm";
import JobFieldTools from "@/components/JobFieldTools";
import JobTagsEditor from "@/components/JobTagsEditor";
import JobExpensesField from "@/components/JobExpensesField";
import ReviewButton from "@/components/ReviewButton";
import DocForm from "@/components/DocForm";
import { createEstimate } from "@/app/(app)/estimates/actions";
import { createInvoice } from "@/app/(app)/invoices/actions";
import JobSummaryPanel, { type SummaryDraft } from "@/components/JobSummaryPanel";
import JobHistoryPanel from "@/components/JobHistoryPanel";
import JobWarrantyPanel, {
  type JobWarranty,
  type WarrantyCallback,
} from "@/components/JobWarrantyPanel";
import { loadJobHistory } from "@/lib/job-history";
import CustomFieldValues from "@/app/(app)/settings/custom-fields/CustomFieldValues";
import { loadCustomFields } from "@/app/(app)/settings/custom-fields/load";
import { TextLink } from "@/components/ui";
import * as jobsData from "@/lib/data/jobs";
import * as paymentsData from "@/lib/data/payments";
import * as fieldData from "@/lib/data/field";

export const dynamic = "force-dynamic";

export default async function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const profile = await requireProfile();
  const locale = await getLocale();
  const he = locale === "he";
  const supabase = await createClient();
  const canEdit = profile.role !== "tech";

  const { data: job } = await supabase
    .from("jobs")
    .select(
      "id, service, status, stage, tags, job_expenses_minor, price_minor, scheduled_date, start_time, end_time, notes, customer_id, job_address, job_city, on_my_way_at, arrived_at, started_at, completed_at, completion_signed_by, labour_minutes, labour_cost_minor, labour_costed_at, required_skills, customer_confirmation_status, customer_confirmed_at, customer_declined_at, customer_confirmation_note, customers!jobs_customer_org_fk(name, phone, address, city, billing_address, billing_city), profiles!jobs_assigned_to_fkey(full_name)",
    )
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  const [{ data: org }, stageRows] = await Promise.all([
    supabase.from("organizations").select("currency,phone").single(),
    jobsData.listStatuses(supabase),
  ]);
  const cur = org?.currency ?? "USD";
  const stages = stageRows as { name: string; color: string }[];
  const stageColor = stages.find((s) => s.name === job?.stage)?.color ?? "#2563eb";

  if (!job)
    return (
      <div>
        <Link href="/schedule" style={back}>
          {he ? "חזרה ליומן" : "Back to schedule"}
        </Link>
        <div className="sp-empty">{he ? "העבודה לא נמצאה." : "Job not found."}</div>
      </div>
    );
  const history = await loadJobHistory(id, locale, profile.id);
  const customFields = await loadCustomFields("job", id); // ledger 5.10

  const [
    photoRows,
    invoices,
    estimates,
    items,
    tasks,
    checklist,
    equipment,
    catalog,
    summaries,
    teamRows,
    { data: warranty },
    callbacks,
    stock,
  ] = await Promise.all([
    fieldData.listPhotosForJob(supabase, id),
    fieldData.listInvoicesForJobSummary(supabase, id),
    fieldData.listEstimatesForCustomerSummary(supabase, job.customer_id),
    fieldData.listItemsWithIdForJob(supabase, id),
    fieldData.listTasksWithIdForJob(supabase, id),
    fieldData.listChecklistWithIdForJob(supabase, id),
    fieldData.listEquipmentForJob(supabase, id),
    fieldData.listPriceBook(supabase),
    fieldData.listRecentSummaryDrafts(supabase, id, 10),
    fieldData.listTeamNamesForJob(supabase),
    supabase
      .from("job_warranties")
      .select("id,coverage_type,starts_on,expires_on,terms,status")
      .eq("job_id", id)
      .maybeSingle(),
    fieldData.listWarrantyCallbacksForOriginalJob(supabase, id),
    fieldData.listInventoryPickerForJob(supabase, 500),
  ]);

  const invList = invoices;
  const invIds = invList.map((i) => i.id);
  let paidByInvoice: Record<string, number> = {};
  /** The payment columns this page renders, per invoice. */
  type PaymentLine = Pick<Tables<"payments">, "amount_minor" | "method" | "reference" | "paid_at">;
  let paysByInvoice: Record<string, PaymentLine[]> = {};
  if (invIds.length) {
    const pays = await paymentsData.listForInvoices(supabase, invIds);
    pays.forEach((p) => {
      if (!p.invoice_id) return;
      paidByInvoice[p.invoice_id] = (paidByInvoice[p.invoice_id] ?? 0) + p.amount_minor;
      (paysByInvoice[p.invoice_id] ??= []).push({
        amount_minor: p.amount_minor,
        method: p.method,
        reference: p.reference,
        paid_at: p.paid_at,
      });
    });
  }

  const photos: Photo[] = await Promise.all(
    photoRows.map(async (r) => {
      const { data } = await supabase.storage
        .from("job-photos")
        .createSignedUrl(r.storage_path, 3600);
      return {
        id: r.id,
        path: r.storage_path,
        url: data?.signedUrl ?? null,
        label: r.label,
        mediaType: r.media_type === "video" ? "video" : "image",
        parentPhotoId: r.parent_photo_id,
        customerVisible: r.customer_visible,
      };
    }),
  );

  // Time tracking summary
  const timeEntries = await jobsData.listTimeEntries(supabase, id);
  // Server-rendered request timestamp; it is intentionally fixed for this response.
  // eslint-disable-next-line react-hooks/purity
  const nowMs = Date.now();
  const totalMinutes = Math.round(
    timeEntries.reduce((s: number, e) => {
      const st = new Date(e.started_at).getTime();
      const en = e.ended_at ? new Date(e.ended_at).getTime() : nowMs;
      return s + Math.max(0, en - st);
    }, 0) / 60000,
  );
  const clockedIn = timeEntries.some((e) => e.user_id === profile.id && !e.ended_at);

  // 6c.2 — job costing including labour, and 6c.8 — the customer's appointment
  // link. Both are management information, so they are loaded only for
  // owner/office: `job_labour_cost` refuses a technician outright (db/039 §1)
  // and `appointment_tokens` is owner/office by RLS.
  let labourFigures = {
    minutes: 0,
    costMinor: 0,
    unpriced: 0,
    openEntries: 0,
    available: false,
    costedAt: null as string | null,
  };
  let appointmentLink: { token: string; expiresAt: string } | null = null;
  if (canEdit) {
    const [{ data: labourRow }, { data: tokenRow }] = await Promise.all([
      supabase.rpc("job_labour_cost", { p_job: id }),
      supabase
        .from("appointment_tokens")
        .select("token, expires_at")
        .eq("job_id", id)
        .is("revoked_at", null)
        .maybeSingle(),
    ]);
    // `job_labour_cost` returns jsonb, so it arrives as `Json` — which may be
    // a scalar or an array as well as an object. Narrowing to an object is the
    // shape the reads below actually need; `as any` asserted it instead.
    const row =
      labourRow !== null && typeof labourRow === "object" && !Array.isArray(labourRow)
        ? labourRow
        : null;
    if (row) {
      labourFigures = {
        minutes: Number(row.minutes ?? 0),
        costMinor: Number(row.cost_minor ?? 0),
        unpriced: Number(row.unpriced_technicians ?? 0),
        openEntries: Number(row.open_entries ?? 0),
        available: true,
        costedAt: job.labour_costed_at ?? null,
      };
    }
    if (tokenRow)
      appointmentLink = {
        token: tokenRow.token as string,
        expiresAt: tokenRow.expires_at as string,
      };
  }
  // Revenue and materials for the job's own P&L. The job's items are the sale
  // when it has them; otherwise the quoted price is.
  const jobItemRows = items as any[];
  const lineTotal = (qtyMilli: number, minor: number) =>
    Math.floor((Math.max(0, qtyMilli) * Math.max(0, minor) + 500) / 1000);
  const jobRevenueMinor = jobItemRows.length
    ? jobItemRows.reduce(
        (sum, row) => sum + lineTotal(row.qty_milli ?? 0, row.unit_price_minor ?? 0),
        0,
      )
    : (job.price_minor ?? 0);
  const jobMaterialsMinor = jobItemRows.reduce(
    (sum, row) => sum + lineTotal(row.qty_milli ?? 0, row.cost_minor ?? 0),
    0,
  );

  const c = job.customers;
  const techName = job.profiles?.full_name;
  const custOpt = [{ id: job.customer_id, label: c?.name ?? (he ? "לקוח" : "Customer") }];
  const serviceAddr = [job.job_address || c?.address, job.job_city || c?.city]
    .filter(Boolean)
    .join(", ");
  const billingAddr = [c?.billing_address || c?.address, c?.billing_city || c?.city]
    .filter(Boolean)
    .join(", ");

  const payInvoices: InvPay[] = invList.map((i) => ({
    id: i.id,
    number: i.number,
    total_minor: i.total_minor,
    status: i.status,
    paid_minor: paidByInvoice[i.id] ?? 0,
    payments: paysByInvoice[i.id] ?? [],
  }));

  const Details = (
    <div>
      <JobFieldTools
        jobId={job.id}
        onMyWayAt={job.on_my_way_at}
        startedAt={job.started_at}
        completedAt={job.completed_at}
        clockedIn={clockedIn}
        totalMinutes={totalMinutes}
        signedBy={job.completion_signed_by}
      />
      <div style={{ display: "flex", gap: 18, justifyContent: "center", margin: "2px 0 16px" }}>
        <TextLink href={"tel:" + (c?.phone ?? "").replace(/[^0-9+]/g, "")}>
          {he ? "התקשרות" : "Call"}
        </TextLink>
        <TextLink href={"sms:" + (c?.phone ?? "")}>{he ? "הודעה" : "Text"}</TextLink>
        <TextLink href={"https://maps.google.com/?q=" + encodeURIComponent(serviceAddr)}>
          {he ? "ניווט" : "Navigate"}
        </TextLink>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))",
          gap: 12,
          marginBottom: 16,
        }}
      >
        <Item2 label={he ? "לקוח" : "Customer"} value={c?.name ?? "—"} />
        <Item2
          label={he ? "טכנאי" : "Technician"}
          value={techName || (he ? "לא שובץ" : "Unassigned")}
        />
        <Item2
          label={he ? "מועד" : "When"}
          value={`${fmtDate(job.scheduled_date)} · ${(job.start_time ?? "").slice(0, 5)}–${(job.end_time ?? "").slice(0, 5)}`}
        />
        <Item2 label={he ? "מחיר" : "Price"} value={money(job.price_minor, cur)} />
        <Item2 label={he ? "טלפון" : "Phone"} value={c?.phone || "—"} />
        <Item2 label={he ? "כתובת העבודה" : "Service address"} value={serviceAddr || "—"} />
        <Item2 label={he ? "כתובת לחיוב" : "Billing address"} value={billingAddr || "—"} />
      </div>
      <CustomFieldValues
        locale={locale}
        entityType="job"
        entityId={job.id}
        definitions={customFields.definitions}
        values={customFields.values}
        canEdit={canEdit}
      />
      {canEdit && (
        <JobAddressForm jobId={job.id} jobAddress={job.job_address} jobCity={job.job_city} />
      )}
      {job.notes && (
        <div
          style={{
            background: "#f4f7fb",
            borderRadius: 12,
            padding: "12px 14px",
            margin: "12px 0",
            fontSize: "0.875rem",
          }}
        >
          <b className="sp-text-muted-xs">{he ? "הערות" : "Notes"}</b>
          <br />
          {job.notes}
        </div>
      )}
      <div
        style={{
          background: "#fff",
          border: "1px solid #e2e8f0",
          borderRadius: 14,
          padding: 16,
          marginTop: 12,
        }}
      >
        <JobActions
          jobId={job.id}
          stage={job.stage ?? "Scheduled"}
          stages={stages}
          canInvoice={canEdit}
        />
      </div>
      {canEdit && (
        <JobAppointment
          locale={locale}
          jobId={job.id}
          confirmation={job.customer_confirmation_status ?? "pending"}
          confirmedAt={job.customer_confirmed_at ?? null}
          declinedAt={job.customer_declined_at ?? null}
          note={job.customer_confirmation_note ?? null}
          link={appointmentLink}
          arrivedAt={job.arrived_at ?? null}
          onMyWayAt={job.on_my_way_at}
        />
      )}
      {(job.required_skills ?? []).length > 0 && (
        <div
          style={{
            background: "#e0ebff",
            color: "#1d4ed8",
            borderRadius: 12,
            padding: "10px 14px",
            marginTop: 12,
            fontSize: "0.875rem",
          }}
        >
          <b>{he ? "הסמכות נדרשות" : "Certifications required"}:</b>{" "}
          {(job.required_skills as string[]).join(", ")}
        </div>
      )}
      {canEdit && (
        <JobCosting
          locale={locale}
          currency={cur}
          jobId={job.id}
          revenueMinor={jobRevenueMinor}
          materialsMinor={jobMaterialsMinor}
          expensesMinor={job.job_expenses_minor ?? 0}
          labour={labourFigures}
        />
      )}
      {canEdit && <JobTagsEditor jobId={job.id} tags={job.tags ?? []} />}
      {canEdit && <JobExpensesField jobId={job.id} value={job.job_expenses_minor ?? 0} />}
      {job.completed_at && canEdit && <ReviewButton jobId={job.id} />}
      <a
        href={`/jobs/${job.id}/report`}
        style={{
          display: "block",
          textAlign: "center",
          marginTop: 12,
          color: "#2563eb",
          fontWeight: 700,
          fontSize: "0.875rem",
          textDecoration: "none",
        }}
      >
        {he ? "פתיחת דוח סיום עבודה" : "Open job completion report"}
      </a>
    </div>
  );

  // Parts come from stock and take stock with them: JobParts writes the line
  // AND the inventory movement (remediation plan 5.11). Technicians get it too —
  // they are the ones who actually fit the parts.
  const ItemsTab = (
    <div>
      <JobItems jobId={job.id} items={items as Item[]} currency={cur} canEdit={canEdit} />
      <JobParts jobId={job.id} stock={stock as StockItem[]} />
    </div>
  );

  const EstimatesTab = (
    <div>
      {canEdit && (
        <div style={{ marginBottom: 12 }}>
          <DocForm
            locale={locale}
            customers={custOpt}
            action={createEstimate}
            newKey="est.new"
            catalog={catalog}
            orgId={profile.organization_id!}
          />
        </div>
      )}
      <div className="rlist">
        {estimates.map((d) => (
          <DocRow key={d.id} kind={he ? "הצעת מחיר" : "Estimate"} d={d} cur={cur} he={he} />
        ))}
        {estimates.length === 0 && (
          <div className="rempty">
            {he ? "עוד אין הצעות מחיר ללקוח הזה." : "No estimates for this customer yet."}
          </div>
        )}
      </div>
    </div>
  );

  const InvoicesTab = (
    <div>
      {canEdit && (
        <div style={{ marginBottom: 12 }}>
          <DocForm
            locale={locale}
            customers={custOpt}
            action={createInvoice}
            newKey="inv.new"
            catalog={catalog}
            orgId={profile.organization_id!}
          />
        </div>
      )}
      <div className="rlist">
        {invList.map((d) => (
          <DocRow key={d.id} kind={he ? "חשבונית" : "Invoice"} d={d} cur={cur} he={he} />
        ))}
        {invList.length === 0 && (
          <div className="rempty">
            {he
              ? "עוד אין חשבוניות. אפשר ליצור אחת כאן או מלשונית הפריטים."
              : "No invoices yet. Create one here or from the Items tab."}
          </div>
        )}
      </div>
    </div>
  );

  const PaymentsTab = (
    <JobPayments jobId={job.id} invoices={payInvoices} currency={cur} canRecord={canEdit} />
  );
  const AttachmentsTab = (
    <JobPhotos jobId={job.id} orgId={profile.organization_id!} photos={photos} />
  );
  const TasksTab = <JobTasks jobId={job.id} tasks={tasks as Task[]} />;
  const EquipmentTab = <JobEquipment jobId={job.id} equipment={equipment as Equip[]} />;
  const ChecklistsTab = <JobChecklist jobId={job.id} items={checklist as Check[]} />;
  const team = teamRows.map((person) => ({
    id: person.id,
    name: person.full_name || (he ? "ללא שם" : "Unnamed"),
  }));
  const HistoryTab = (
    <JobHistoryPanel
      jobId={job.id}
      locale={locale}
      entries={history}
      team={team}
      customerPhone={c?.phone ?? ""}
      businessPhone={org?.phone ?? ""}
      canManage={canEdit}
    />
  );
  const WarrantyTab = (
    <JobWarrantyPanel
      jobId={job.id}
      locale={locale}
      warranty={(warranty as JobWarranty | null) ?? null}
      callbacks={callbacks as WarrantyCallback[]}
      team={team}
      completedOn={job.completed_at}
      scheduledOn={job.scheduled_date}
      canManage={canEdit}
      currency={cur}
    />
  );

  const openTasks = tasks.filter((t) => !t.done).length;

  return (
    <div style={{ maxWidth: 860 }}>
      <Link href="/jobs" style={back}>
        {he ? "חזרה לעבודות" : "Back to jobs"}
      </Link>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
          margin: "8px 0 2px",
        }}
      >
        <h1 className="sp-heading sp-heading--lg">{job.service}</h1>
        <span className="pill" style={{ background: stageColor + "22", color: stageColor }}>
          {job.stage ?? "Scheduled"}
        </span>
      </div>
      <p style={{ color: "#5c6675", marginBottom: 6 }}>{c?.name ?? "—"}</p>
      {(job.tags ?? []).length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
          {(job.tags as string[]).map((t) => (
            <span key={t} className="pill" style={{ background: "#eef2f8", color: "#5c6675" }}>
              {t}
            </span>
          ))}
        </div>
      )}
      <Tabs
        tabs={[
          { label: he ? "פרטים" : "Details", content: Details },
          {
            label: he ? "פריטים" : "Items",
            badge: items.length ? String(items.length) : undefined,
            content: ItemsTab,
          },
          { label: he ? "תשלומים" : "Payments", content: PaymentsTab },
          {
            label: he ? "הצעות מחיר" : "Estimates",
            badge: estimates.length ? String(estimates.length) : undefined,
            content: EstimatesTab,
          },
          {
            label: he ? "חשבוניות" : "Invoices",
            badge: invList.length ? String(invList.length) : undefined,
            content: InvoicesTab,
          },
          {
            label: he ? "קבצים ותמונות" : "Attachments",
            badge: photos.length ? String(photos.length) : undefined,
            content: AttachmentsTab,
          },
          {
            label: he ? "היסטוריה" : "History",
            badge: history.length ? String(history.length) : undefined,
            content: HistoryTab,
          },
          {
            label: he ? "אחריות וחזרות" : "Warranty",
            badge: callbacks.filter((row) => !["resolved", "denied"].includes(row.status)).length
              ? String(
                  callbacks.filter((row) => !["resolved", "denied"].includes(row.status)).length,
                )
              : undefined,
            content: WarrantyTab,
          },
          {
            label: he ? "משימות" : "Tasks",
            badge: openTasks ? String(openTasks) : undefined,
            content: TasksTab,
          },
          {
            label: he ? "ציוד אצל הלקוח" : "Equipment",
            badge: equipment.length ? String(equipment.length) : undefined,
            content: EquipmentTab,
          },
          {
            label: he ? "רשימות בדיקה" : "Checklists",
            badge: checklist.length ? String(checklist.length) : undefined,
            content: ChecklistsTab,
          },
        ]}
      />
      <JobSummaryPanel jobId={job.id} locale={locale} drafts={summaries as SummaryDraft[]} />
    </div>
  );
}

/**
 * One estimate or invoice, as a link to the customer's public copy.
 *
 * `d` used to be `any`. Estimates and invoices are different tables with
 * different status enums, so the shared shape is spelled out: exactly the four
 * columns this component reads, and a `status` wide enough for both.
 */
function DocRow({
  kind,
  d,
  cur,
  he,
}: {
  kind: string;
  d: {
    id: string;
    number: number;
    public_token: string | null;
    total_minor: number;
    status: Tables<"estimates">["status"] | Tables<"invoices">["status"];
  };
  cur: string;
  he: boolean;
}) {
  const colors: Record<string, string> = {
    draft: "#eef1f6|#57606f",
    sent: "#e0ebff|#2563eb",
    approved: "#e6f6ec|#15803d",
    rejected: "#fdeaea|#dc2626",
    unpaid: "#fdf1dc|#b45309",
    paid: "#e6f6ec|#15803d",
    void: "#eef1f6|#57606f",
  };
  const [bg, fg] = (colors[d.status] ?? "#eef1f6|#57606f").split("|");
  return (
    <a className="ritem" href={`/p/${d.public_token}`} target="_blank">
      <div className="rmain">
        <div className="rtitle">
          {kind} #{d.number}
        </div>
        <div className="rsub">{he ? "פתיחת הקישור של הלקוח" : "Open customer link"}</div>
      </div>
      <div className="rend">
        <b style={{ fontSize: "0.9375rem" }}>{money(d.total_minor, cur)}</b>
        <span className="pill" style={{ background: bg, color: fg }}>
          {d.status}
        </span>
      </div>
    </a>
  );
}
function Item2({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #e2e8f0",
        borderRadius: 12,
        padding: "11px 14px",
      }}
    >
      <div style={{ fontSize: "0.875rem", color: "#5c6675", fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: "0.9375rem", fontWeight: 700, marginTop: 2 }}>{value}</div>
    </div>
  );
}
const back: React.CSSProperties = {
  color: "#2563eb",
  fontWeight: 700,
  fontSize: "0.875rem",
  textDecoration: "none",
};
