import type { InvoiceStatus, JobStatus, UserRole } from "@/lib/types";

export const roleLabels: Record<UserRole, string> = {
  owner: "בעלים",
  office: "משרד",
  technician: "שטח",
};

export const jobStatusLabels: Record<JobStatus, string> = {
  scheduled: "מתוכננת",
  on_way: "בדרך",
  in_progress: "בעבודה",
  completed: "הסתיימה",
  cancelled: "בוטלה",
};

export const invoiceStatusLabels: Record<InvoiceStatus, string> = {
  draft: "טיוטה",
  sent: "נשלחה",
  overdue: "עדיין לא שולם",
  paid: "שולם",
  cancelled: "בוטלה",
};

export function formatMoney(agorot: number) {
  return new Intl.NumberFormat("he-IL", {
    style: "currency",
    currency: "ILS",
    maximumFractionDigits: agorot % 100 === 0 ? 0 : 2,
  }).format(agorot / 100);
}

export function formatTime(value: string) {
  return new Intl.DateTimeFormat("he-IL", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function formatDate(value: string) {
  const safeValue = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value;
  return new Intl.DateTimeFormat("he-IL", {
    day: "numeric",
    month: "long",
  }).format(new Date(safeValue));
}

export function formatFullDate(value: string) {
  return new Intl.DateTimeFormat("he-IL", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(value));
}

export function localDateKey(value: string | Date) {
  const date = typeof value === "string" ? new Date(value) : value;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] ?? "")
    .join("");
}

export function normalizeIsraeliPhone(phone: string) {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("0")) return `972${digits.slice(1)}`;
  if (digits.startsWith("972")) return digits;
  return digits;
}
