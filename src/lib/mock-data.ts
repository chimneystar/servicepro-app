import type { AppData, JobStatus } from "@/lib/types";

function at(hour: number, minute = 0, dayOffset = 0) {
  const date = new Date();
  date.setDate(date.getDate() + dayOffset);
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
}

function day(dayOffset = 0) {
  const date = new Date();
  date.setDate(date.getDate() + dayOffset);
  return date.toISOString().slice(0, 10);
}

export function makeMockData(): AppData {
  const organizationId = 1;
  const ownerId = "11111111-1111-1111-1111-111111111111";
  const techId = "22222222-2222-2222-2222-222222222222";
  const customers = [
    { id: 1, organization_id: organizationId, name: "דנה כהן", phone: "050-123-4567", email: "dana@example.com", address: "הגפן 12, רמת גן", notes: "חניה בחצר", created_at: at(8, 0, -20), updated_at: at(8, 0) },
    { id: 2, organization_id: organizationId, name: "יוסי לוי", phone: "052-987-6543", email: "yossi@example.com", address: "ויצמן 8, גבעתיים", notes: null, created_at: at(8, 0, -15), updated_at: at(8, 0, -1) },
    { id: 3, organization_id: organizationId, name: "מיכל אדרי", phone: "054-555-1234", email: null, address: "אחד העם 41, תל אביב", notes: null, created_at: at(8, 0, -10), updated_at: at(8, 0, -2) },
    { id: 4, organization_id: organizationId, name: "בית קפה נונה", phone: "03-555-0199", email: "office@nona.example", address: "ביאליק 19, רמת גן", notes: "להיכנס מהמחסן", created_at: at(8, 0, -30), updated_at: at(8, 0, -3) },
  ];
  const jobs = [
    { id: 1, customer_id: 1, technician_user_id: techId, title: "טיפול תקופתי למזגן", starts_at: at(8, 30), ends_at: at(9, 30), address: customers[0].address, status: "completed" as JobStatus, price_agorot: 42000, notes: null },
    { id: 2, customer_id: 2, technician_user_id: techId, title: "בדיקת תקלה במזגן", starts_at: at(10, 30), ends_at: at(11, 30), address: customers[1].address, status: "scheduled" as JobStatus, price_agorot: 35000, notes: "להתקשר כשמגיעים" },
    { id: 3, customer_id: 3, technician_user_id: techId, title: "התקנת מזגן עילי", starts_at: at(13, 0), ends_at: at(15, 0), address: customers[2].address, status: "scheduled" as JobStatus, price_agorot: 240000, notes: null },
    { id: 4, customer_id: 4, technician_user_id: null, title: "ניקוי ארבעה מזגנים", starts_at: at(9, 0, 1), ends_at: at(11, 0, 1), address: customers[3].address, status: "scheduled" as JobStatus, price_agorot: 88000, notes: null },
  ].map((job) => ({ ...job, organization_id: organizationId, created_at: at(8, 0, -5), updated_at: at(8, 0) }));

  return {
    userId: ownerId,
    organization: { id: organizationId, name: "רון מיזוג אוויר", timezone: "Asia/Jerusalem", default_vat_basis_points: 1800 },
    profile: { id: ownerId, display_name: "אברהם רון", phone: "050-555-0111" },
    role: "owner",
    customers,
    jobs,
    invoices: [
      { id: 1, organization_id: organizationId, customer_id: 1, job_id: 1, invoice_number: "1042", status: "overdue", subtotal_agorot: 42000, discount_agorot: 0, vat_basis_points: 1800, total_agorot: 49560, due_date: day(-4), paid_at: null, notes: null, created_at: at(12, 0, -18), updated_at: at(12, 0, -4) },
      { id: 2, organization_id: organizationId, customer_id: 4, job_id: null, invoice_number: "1041", status: "paid", subtotal_agorot: 120000, discount_agorot: 0, vat_basis_points: 1800, total_agorot: 141600, due_date: day(-8), paid_at: at(14, 0, -7), notes: null, created_at: at(12, 0, -15), updated_at: at(14, 0, -7) },
      { id: 3, organization_id: organizationId, customer_id: 2, job_id: null, invoice_number: "1040", status: "sent", subtotal_agorot: 68000, discount_agorot: 0, vat_basis_points: 1800, total_agorot: 80240, due_date: day(5), paid_at: null, notes: null, created_at: at(12, 0, -3), updated_at: at(12, 0, -3) },
    ],
    expenses: [
      { id: 1, organization_id: organizationId, category: "ציוד וחומרים", vendor: "א.ל. ציוד", description: "צנרת וחיבורים", amount_agorot: 128900, spent_on: day(-2), created_at: at(8, 0, -2) },
      { id: 2, organization_id: organizationId, category: "דלק ונסיעות", vendor: "פז", description: null, amount_agorot: 36400, spent_on: day(-5), created_at: at(8, 0, -5) },
    ],
    team: [
      { id: ownerId, display_name: "אברהם רון", phone: "050-555-0111", role: "owner", active: true },
      { id: techId, display_name: "נועם ישראלי", phone: "052-555-0222", role: "technician", active: true },
    ],
  };
}
