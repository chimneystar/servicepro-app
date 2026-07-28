import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type {
  AppData,
  Customer,
  Expense,
  Invoice,
  Job,
  Organization,
  Profile,
  TeamMember,
  UserRole,
} from "@/lib/types";

export async function getAuthenticatedUserId() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (error || !userId || typeof userId !== "string") return null;
  return userId;
}

export async function getMembershipContext() {
  const supabase = await createClient();
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (claimsError || !userId || typeof userId !== "string") return null;

  const { data: profile, error: profileError } = await supabase
    .from("sp_profiles")
    .select("id, display_name, phone, default_organization_id")
    .eq("id", userId)
    .maybeSingle();

  if (profileError || !profile) return { userId, profile: null, membership: null };

  let membershipQuery = supabase
    .from("sp_organization_members")
    .select("organization_id, role, active")
    .eq("user_id", userId)
    .eq("active", true);

  if (profile.default_organization_id) {
    membershipQuery = membershipQuery.eq("organization_id", profile.default_organization_id);
  }

  let { data: membership } = await membershipQuery.limit(1).maybeSingle();

  if (!membership && profile.default_organization_id) {
    const fallback = await supabase
      .from("sp_organization_members")
      .select("organization_id, role, active")
      .eq("user_id", userId)
      .eq("active", true)
      .limit(1)
      .maybeSingle();
    membership = fallback.data;
  }

  return { userId, profile, membership };
}

export async function loadAppData(): Promise<AppData> {
  const context = await getMembershipContext();
  if (!context) redirect("/login");
  if (!context.profile || !context.membership) redirect("/onboarding");

  const supabase = await createClient();
  const organizationId = Number(context.membership.organization_id);
  const role = context.membership.role as UserRole;
  const now = new Date();
  const from = new Date(now);
  from.setDate(from.getDate() - 45);
  const to = new Date(now);
  to.setDate(to.getDate() + 120);

  const [organizationResult, customersResult, jobsResult, invoicesResult, expensesResult, membersResult] =
    await Promise.all([
      supabase
        .from("sp_organizations")
        .select("id, name, timezone, default_vat_basis_points")
        .eq("id", organizationId)
        .single(),
      supabase
        .from("sp_customers")
        .select("id, organization_id, name, phone, email, address, notes, created_at, updated_at")
        .eq("organization_id", organizationId)
        .order("updated_at", { ascending: false })
        .limit(500),
      supabase
        .from("sp_jobs")
        .select("id, organization_id, customer_id, technician_user_id, title, starts_at, ends_at, address, status, price_agorot, notes, created_at, updated_at")
        .eq("organization_id", organizationId)
        .gte("starts_at", from.toISOString())
        .lte("starts_at", to.toISOString())
        .order("starts_at", { ascending: true })
        .limit(1000),
      role === "technician"
        ? Promise.resolve({ data: [], error: null })
        : supabase
            .from("sp_invoices")
            .select("id, organization_id, customer_id, job_id, invoice_number, status, subtotal_agorot, discount_agorot, vat_basis_points, total_agorot, due_date, paid_at, notes, created_at, updated_at")
            .eq("organization_id", organizationId)
            .order("created_at", { ascending: false })
            .limit(500),
      role === "technician"
        ? Promise.resolve({ data: [], error: null })
        : supabase
            .from("sp_expenses")
            .select("id, organization_id, category, vendor, description, amount_agorot, spent_on, created_at")
            .eq("organization_id", organizationId)
            .order("spent_on", { ascending: false })
            .limit(500),
      supabase
        .from("sp_organization_members")
        .select("user_id, role, active")
        .eq("organization_id", organizationId)
        .eq("active", true),
    ]);

  const firstError = [
    organizationResult.error,
    customersResult.error,
    jobsResult.error,
    invoicesResult.error,
    expensesResult.error,
    membersResult.error,
  ].find(Boolean);

  if (firstError || !organizationResult.data) {
    throw new Error(firstError?.message ?? "לא הצלחנו לטעון את נתוני העסק");
  }

  const memberRows = membersResult.data ?? [];
  const memberIds = memberRows.map((member) => member.user_id);
  const profilesResult = memberIds.length
    ? await supabase.from("sp_profiles").select("id, display_name, phone").in("id", memberIds)
    : { data: [], error: null };

  if (profilesResult.error) throw new Error(profilesResult.error.message);
  const profilesById = new Map((profilesResult.data ?? []).map((profile) => [profile.id, profile]));
  const team = memberRows.map((member) => {
    const profile = profilesById.get(member.user_id);
    return {
      id: member.user_id,
      display_name: profile?.display_name || "ללא שם",
      phone: profile?.phone ?? null,
      role: member.role as UserRole,
      active: Boolean(member.active),
    } satisfies TeamMember;
  });

  return {
    userId: context.userId,
    organization: organizationResult.data as Organization,
    profile: {
      id: context.profile.id,
      display_name: context.profile.display_name,
      phone: context.profile.phone,
    } as Profile,
    role,
    customers: (customersResult.data ?? []) as Customer[],
    jobs: (jobsResult.data ?? []) as Job[],
    invoices: (invoicesResult.data ?? []) as Invoice[],
    expenses: (expensesResult.data ?? []) as Expense[],
    team,
  };
}
