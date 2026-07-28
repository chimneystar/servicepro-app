export type UserRole = "owner" | "office" | "technician";
export type JobStatus = "scheduled" | "on_way" | "in_progress" | "completed" | "cancelled";
export type InvoiceStatus = "draft" | "sent" | "overdue" | "paid" | "cancelled";

export type Organization = {
  id: number;
  name: string;
  timezone: string;
  default_vat_basis_points: number;
};

export type Profile = {
  id: string;
  display_name: string;
  phone: string | null;
};

export type TeamMember = Profile & {
  role: UserRole;
  active: boolean;
};

export type Customer = {
  id: number;
  organization_id: number;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type Job = {
  id: number;
  organization_id: number;
  customer_id: number;
  technician_user_id: string | null;
  title: string;
  starts_at: string;
  ends_at: string;
  address: string | null;
  status: JobStatus;
  price_agorot: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type Invoice = {
  id: number;
  organization_id: number;
  customer_id: number;
  job_id: number | null;
  invoice_number: string;
  status: InvoiceStatus;
  subtotal_agorot: number;
  discount_agorot: number;
  vat_basis_points: number;
  total_agorot: number;
  due_date: string;
  paid_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type Expense = {
  id: number;
  organization_id: number;
  category: string;
  vendor: string | null;
  description: string | null;
  amount_agorot: number;
  spent_on: string;
  created_at: string;
};

export type AppData = {
  userId: string;
  organization: Organization;
  profile: Profile;
  role: UserRole;
  customers: Customer[];
  jobs: Job[];
  invoices: Invoice[];
  expenses: Expense[];
  team: TeamMember[];
};

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };
