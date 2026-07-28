"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getMembershipContext } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult, UserRole } from "@/lib/types";

type MutationContext = {
  organizationId: number;
  role: UserRole;
  userId: string;
};

async function mutationContext(): Promise<MutationContext | null> {
  const context = await getMembershipContext();
  if (!context?.profile || !context.membership) return null;
  return {
    organizationId: Number(context.membership.organization_id),
    role: context.membership.role as UserRole,
    userId: context.userId,
  };
}

function canManage(role: UserRole) {
  return role === "owner" || role === "office";
}

function textOrNull(value: FormDataEntryValue | null) {
  const valueText = typeof value === "string" ? value.trim() : "";
  return valueText || null;
}

function agorot(value: FormDataEntryValue | null) {
  const amount = Number(typeof value === "string" ? value : "");
  return Number.isFinite(amount) ? Math.round(amount * 100) : Number.NaN;
}

function failed(error: unknown, fallback: string): ActionResult {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("jobs_no_technician_overlap") || message.includes("exclusion")) {
    return { ok: false, error: "כבר יש לטכנאי הזה עבודה בשעה שבחרת" };
  }
  if (message.includes("invoices_number_per_org") || message.includes("duplicate")) {
    return { ok: false, error: "כבר קיימת חשבונית עם המספר הזה" };
  }
  return { ok: false, error: fallback };
}

const customerSchema = z.object({
  name: z.string().trim().min(2, "צריך לכתוב שם לקוח").max(120),
  email: z.union([z.literal(""), z.email("כתובת המייל לא נראית תקינה")]),
});

export async function saveCustomerAction(formData: FormData): Promise<ActionResult> {
  try {
    const context = await mutationContext();
    if (!context) return { ok: false, error: "צריך להיכנס מחדש" };
    if (!canManage(context.role)) return { ok: false, error: "אין הרשאה לשנות לקוחות" };

    const parsed = customerSchema.safeParse({
      name: formData.get("name"),
      email: String(formData.get("email") ?? "").trim(),
    });
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "צריך לבדוק את הפרטים" };

    const supabase = await createClient();
    const customerId = Number(formData.get("customer_id"));
    const values = {
      name: parsed.data.name,
      phone: textOrNull(formData.get("phone")),
      email: parsed.data.email || null,
      address: textOrNull(formData.get("address")),
      notes: textOrNull(formData.get("notes")),
    };

    const result = Number.isInteger(customerId) && customerId > 0
      ? await supabase.from("sp_customers").update(values).eq("id", customerId).eq("organization_id", context.organizationId)
      : await supabase.from("sp_customers").insert({
          ...values,
          organization_id: context.organizationId,
          created_by: context.userId,
        });

    if (result.error) throw result.error;
    revalidatePath("/app");
    return { ok: true, message: customerId ? "פרטי הלקוח נשמרו" : "הלקוח נוסף" };
  } catch (error) {
    return failed(error, "לא הצלחנו לשמור את הלקוח. כדאי לנסות שוב");
  }
}

export async function deleteCustomerAction(customerId: number): Promise<ActionResult> {
  try {
    const context = await mutationContext();
    if (!context || !canManage(context.role)) return { ok: false, error: "אין הרשאה למחוק לקוחות" };
    const supabase = await createClient();
    const { error } = await supabase.from("sp_customers").delete().eq("id", customerId).eq("organization_id", context.organizationId);
    if (error) {
      if (error.code === "23503") return { ok: false, error: "יש ללקוח עבודות או חשבוניות, ולכן אי אפשר למחוק אותו" };
      throw error;
    }
    revalidatePath("/app");
    return { ok: true, message: "הלקוח נמחק" };
  } catch (error) {
    return failed(error, "לא הצלחנו למחוק את הלקוח");
  }
}

const jobSchema = z.object({
  customerId: z.coerce.number().int().positive("צריך לבחור לקוח"),
  title: z.string().trim().min(2, "צריך לכתוב מה עושים בעבודה").max(140),
  startsAt: z.iso.datetime("צריך לבחור שעת התחלה"),
  endsAt: z.iso.datetime("צריך לבחור שעת סיום"),
  priceAgorot: z.number().int().nonnegative("המחיר לא יכול להיות שלילי"),
});

export async function saveJobAction(formData: FormData): Promise<ActionResult> {
  try {
    const context = await mutationContext();
    if (!context || !canManage(context.role)) return { ok: false, error: "אין הרשאה לשבץ עבודות" };
    const parsed = jobSchema.safeParse({
      customerId: formData.get("customer_id"),
      title: formData.get("title"),
      startsAt: formData.get("starts_at"),
      endsAt: formData.get("ends_at"),
      priceAgorot: agorot(formData.get("price")),
    });
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "צריך לבדוק את פרטי העבודה" };
    if (new Date(parsed.data.endsAt) <= new Date(parsed.data.startsAt)) {
      return { ok: false, error: "שעת הסיום צריכה להיות אחרי שעת ההתחלה" };
    }

    const supabase = await createClient();
    const jobId = Number(formData.get("job_id"));
    const technician = textOrNull(formData.get("technician_user_id"));
    const values = {
      customer_id: parsed.data.customerId,
      technician_user_id: technician,
      title: parsed.data.title,
      starts_at: parsed.data.startsAt,
      ends_at: parsed.data.endsAt,
      address: textOrNull(formData.get("address")),
      price_agorot: parsed.data.priceAgorot,
      notes: textOrNull(formData.get("notes")),
    };

    const result = Number.isInteger(jobId) && jobId > 0
      ? await supabase.from("sp_jobs").update(values).eq("id", jobId).eq("organization_id", context.organizationId)
      : await supabase.from("sp_jobs").insert({
          ...values,
          organization_id: context.organizationId,
          created_by: context.userId,
          status: "scheduled",
        });

    if (result.error) throw result.error;
    revalidatePath("/app");
    return { ok: true, message: jobId ? "העבודה עודכנה" : "העבודה שובצה" };
  } catch (error) {
    return failed(error, "לא הצלחנו לשמור את העבודה. כדאי לנסות שוב");
  }
}

export async function advanceJobAction(jobId: number): Promise<ActionResult> {
  try {
    const context = await mutationContext();
    if (!context) return { ok: false, error: "צריך להיכנס מחדש" };
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("sp_advance_job_status", { p_job_id: jobId });
    if (error) throw error;
    revalidatePath("/app");
    const messages: Record<string, string> = {
      on_way: "הנסיעה התחילה",
      in_progress: "העבודה התחילה",
      completed: "העבודה הסתיימה",
    };
    return { ok: true, message: messages[String(data)] ?? "העבודה עודכנה" };
  } catch (error) {
    return failed(error, "לא הצלחנו לעדכן את העבודה");
  }
}

export async function deleteJobAction(jobId: number): Promise<ActionResult> {
  try {
    const context = await mutationContext();
    if (!context || context.role !== "owner") return { ok: false, error: "רק בעלי העסק יכולים למחוק עבודה" };
    const supabase = await createClient();
    const { error } = await supabase.from("sp_jobs").delete().eq("id", jobId).eq("organization_id", context.organizationId);
    if (error) throw error;
    revalidatePath("/app");
    return { ok: true, message: "העבודה נמחקה" };
  } catch (error) {
    return failed(error, "לא הצלחנו למחוק את העבודה");
  }
}

const invoiceSchema = z.object({
  customerId: z.coerce.number().int().positive("צריך לבחור לקוח"),
  invoiceNumber: z.string().trim().min(1, "צריך לכתוב מספר חשבונית").max(40),
  subtotalAgorot: z.number().int().nonnegative("צריך לכתוב סכום תקין"),
  discountAgorot: z.number().int().nonnegative(),
  vatBasisPoints: z.coerce.number().int().min(0).max(10000),
  dueDate: z.iso.date("צריך לבחור תאריך לתשלום"),
});

export async function saveInvoiceAction(formData: FormData): Promise<ActionResult> {
  try {
    const context = await mutationContext();
    if (!context || !canManage(context.role)) return { ok: false, error: "אין הרשאה לשנות חשבוניות" };
    const parsed = invoiceSchema.safeParse({
      customerId: formData.get("customer_id"),
      invoiceNumber: formData.get("invoice_number"),
      subtotalAgorot: agorot(formData.get("subtotal")),
      discountAgorot: agorot(formData.get("discount") || "0"),
      vatBasisPoints: Math.round(Number(formData.get("vat_percent")) * 100),
      dueDate: formData.get("due_date"),
    });
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "צריך לבדוק את החשבונית" };
    if (parsed.data.discountAgorot > parsed.data.subtotalAgorot) {
      return { ok: false, error: "ההנחה לא יכולה להיות גבוהה מסכום החשבונית" };
    }

    const supabase = await createClient();
    const { error } = await supabase.from("sp_invoices").insert({
      organization_id: context.organizationId,
      customer_id: parsed.data.customerId,
      job_id: Number(formData.get("job_id")) || null,
      invoice_number: parsed.data.invoiceNumber,
      status: String(formData.get("status") || "sent"),
      subtotal_agorot: parsed.data.subtotalAgorot,
      discount_agorot: parsed.data.discountAgorot,
      vat_basis_points: parsed.data.vatBasisPoints,
      due_date: parsed.data.dueDate,
      notes: textOrNull(formData.get("notes")),
      created_by: context.userId,
    });
    if (error) throw error;
    revalidatePath("/app");
    return { ok: true, message: "החשבונית נשמרה" };
  } catch (error) {
    return failed(error, "לא הצלחנו לשמור את החשבונית");
  }
}

export async function markInvoicePaidAction(invoiceId: number): Promise<ActionResult> {
  try {
    const context = await mutationContext();
    if (!context || !canManage(context.role)) return { ok: false, error: "אין הרשאה לעדכן תשלום" };
    const supabase = await createClient();
    const { error } = await supabase
      .from("sp_invoices")
      .update({ status: "paid", paid_at: new Date().toISOString() })
      .eq("id", invoiceId)
      .eq("organization_id", context.organizationId);
    if (error) throw error;
    revalidatePath("/app");
    return { ok: true, message: "התשלום נרשם" };
  } catch (error) {
    return failed(error, "לא הצלחנו לרשום את התשלום");
  }
}

export async function saveExpenseAction(formData: FormData): Promise<ActionResult> {
  try {
    const context = await mutationContext();
    if (!context || !canManage(context.role)) return { ok: false, error: "אין הרשאה לשנות הוצאות" };
    const parsed = z.object({
      category: z.string().trim().min(2, "צריך לבחור או לכתוב קטגוריה").max(60),
      amountAgorot: z.number().int().positive("צריך לכתוב סכום גבוה מאפס"),
      spentOn: z.iso.date("צריך לבחור תאריך"),
    }).safeParse({
      category: formData.get("category"),
      amountAgorot: agorot(formData.get("amount")),
      spentOn: formData.get("spent_on"),
    });
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "צריך לבדוק את ההוצאה" };

    const supabase = await createClient();
    const { error } = await supabase.from("sp_expenses").insert({
      organization_id: context.organizationId,
      category: parsed.data.category,
      vendor: textOrNull(formData.get("vendor")),
      description: textOrNull(formData.get("description")),
      amount_agorot: parsed.data.amountAgorot,
      spent_on: parsed.data.spentOn,
      created_by: context.userId,
    });
    if (error) throw error;
    revalidatePath("/app");
    return { ok: true, message: "ההוצאה נרשמה" };
  } catch (error) {
    return failed(error, "לא הצלחנו לשמור את ההוצאה");
  }
}

export async function logReminderAction(formData: FormData): Promise<ActionResult> {
  try {
    const context = await mutationContext();
    if (!context || !canManage(context.role)) return { ok: false, error: "אין הרשאה לפתוח תזכורת" };
    const customerId = Number(formData.get("customer_id"));
    const message = String(formData.get("message") ?? "").trim();
    if (!Number.isInteger(customerId) || message.length < 2) return { ok: false, error: "חסרים פרטים לתזכורת" };
    const supabase = await createClient();
    const { error } = await supabase.from("sp_outreach_log").insert({
      organization_id: context.organizationId,
      customer_id: customerId,
      invoice_id: Number(formData.get("invoice_id")) || null,
      channel: "whatsapp",
      message,
      opened_by: context.userId,
    });
    if (error) throw error;
    return { ok: true, message: "התזכורת מוכנה בוואטסאפ" };
  } catch (error) {
    return failed(error, "לא הצלחנו לפתוח את התזכורת");
  }
}

export async function updateSettingsAction(formData: FormData): Promise<ActionResult> {
  try {
    const context = await mutationContext();
    if (!context) return { ok: false, error: "צריך להיכנס מחדש" };
    const displayName = String(formData.get("display_name") ?? "").trim();
    if (displayName.length < 2) return { ok: false, error: "צריך לכתוב שם" };
    const supabase = await createClient();
    const profileResult = await supabase
      .from("sp_profiles")
      .update({ display_name: displayName, phone: textOrNull(formData.get("phone")) })
      .eq("id", context.userId);
    if (profileResult.error) throw profileResult.error;

    if (context.role === "owner") {
      const businessName = String(formData.get("business_name") ?? "").trim();
      if (businessName.length < 2) return { ok: false, error: "צריך לכתוב את שם העסק" };
      const organizationResult = await supabase
        .from("sp_organizations")
        .update({ name: businessName })
        .eq("id", context.organizationId);
      if (organizationResult.error) throw organizationResult.error;
    }

    revalidatePath("/app");
    return { ok: true, message: "הפרטים נשמרו" };
  } catch (error) {
    return failed(error, "לא הצלחנו לשמור את הפרטים");
  }
}

export async function signOutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
