"use client";

import { useEffect, useMemo, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  advanceJobAction,
  deleteCustomerAction,
  deleteJobAction,
  logReminderAction,
  markInvoicePaidAction,
  saveCustomerAction,
  saveExpenseAction,
  saveInvoiceAction,
  saveJobAction,
  signOutAction,
  updateSettingsAction,
} from "@/app/app/actions";
import { Icon, type IconName } from "@/components/icons";
import {
  formatDate,
  formatFullDate,
  formatMoney,
  formatTime,
  initials,
  invoiceStatusLabels,
  jobStatusLabels,
  localDateKey,
  normalizeIsraeliPhone,
  roleLabels,
} from "@/lib/format";
import type { ActionResult, AppData, Customer, Expense, Invoice, Job, TeamMember } from "@/lib/types";

type ViewName = "today" | "calendar" | "customers" | "money" | "more";
type ModalState =
  | { kind: "customer"; customer?: Customer }
  | { kind: "job"; job?: Job }
  | { kind: "invoice" }
  | { kind: "expense" }
  | null;

const navItems: { id: ViewName; label: string; icon: IconName }[] = [
  { id: "today", label: "היום", icon: "today" },
  { id: "calendar", label: "יומן", icon: "calendar" },
  { id: "customers", label: "לקוחות", icon: "customers" },
  { id: "money", label: "כספים", icon: "money" },
  { id: "more", label: "עוד", icon: "more" },
];

function dateTimeLocal(value?: string, plusHours = 0) {
  const date = value ? new Date(value) : new Date(Date.now() + plusHours * 60 * 60 * 1000);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function dateInput(value?: string, plusDays = 0) {
  const date = value ? new Date(value) : new Date(Date.now() + plusDays * 86_400_000);
  return localDateKey(date);
}

function firstName(name: string) {
  return name.trim().split(/\s+/)[0] || name;
}

export function ServiceProApp({ data }: { data: AppData }) {
  const router = useRouter();
  const [view, setView] = useState<ViewName>("today");
  const [modal, setModal] = useState<ModalState>(null);
  const [quickOpen, setQuickOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const canManage = data.role === "owner" || data.role === "office";

  useEffect(() => {
    if (!modal && !quickOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setModal(null);
        setQuickOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [modal, quickOpen]);

  const customersById = useMemo(
    () => new Map(data.customers.map((customer) => [customer.id, customer])),
    [data.customers],
  );
  const teamById = useMemo(
    () => new Map(data.team.map((member) => [member.id, member])),
    [data.team],
  );
  const technicians = data.team.filter((member) => member.role === "technician" && member.active);
  const today = localDateKey(new Date());
  const todayJobs = data.jobs
    .filter((job) => localDateKey(job.starts_at) === today && job.status !== "cancelled")
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const completedToday = todayJobs.filter((job) => job.status === "completed").length;
  const nextJob = todayJobs.find((job) => !["completed", "cancelled"].includes(job.status));
  const unassignedJobs = data.jobs.filter(
    (job) => !job.technician_user_id && job.status === "scheduled" && new Date(job.starts_at) >= new Date(),
  );
  const unpaidInvoices = data.invoices.filter((invoice) => ["sent", "overdue"].includes(invoice.status));
  const overdueInvoices = unpaidInvoices.filter((invoice) => invoice.status === "overdue" || invoice.due_date < today);
  const monthKey = today.slice(0, 7);
  const paidThisMonth = data.invoices
    .filter((invoice) => invoice.status === "paid" && invoice.paid_at?.slice(0, 7) === monthKey)
    .reduce((sum, invoice) => sum + invoice.total_agorot, 0);
  const expensesThisMonth = data.expenses
    .filter((expense) => expense.spent_on.slice(0, 7) === monthKey)
    .reduce((sum, expense) => sum + expense.amount_agorot, 0);

  const normalizedQuery = query.trim().toLocaleLowerCase("he");
  const customerMatches = (customer: Customer) => !normalizedQuery || [customer.name, customer.phone, customer.email, customer.address]
    .some((value) => value?.toLocaleLowerCase("he").includes(normalizedQuery));
  const filteredCustomers = data.customers.filter(customerMatches);
  const filteredJobs = data.jobs.filter((job) => {
    if (!normalizedQuery) return true;
    const customer = customersById.get(job.customer_id);
    return [job.title, job.address, customer?.name, customer?.phone]
      .some((value) => value?.toLocaleLowerCase("he").includes(normalizedQuery));
  });
  const filteredInvoices = data.invoices.filter((invoice) => {
    if (!normalizedQuery) return true;
    const customer = customersById.get(invoice.customer_id);
    return [invoice.invoice_number, customer?.name]
      .some((value) => value?.toLocaleLowerCase("he").includes(normalizedQuery));
  });

  const showToast = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 3200);
  };

  const run = (action: Promise<ActionResult>, after?: () => void) => {
    setError(null);
    startTransition(() => {
      void (async () => {
        const result = await action;
        if (!result.ok) {
          setError(result.error);
          return;
        }
        after?.();
        if (result.message) showToast(result.message);
        router.refresh();
      })();
    });
  };

  const submitJob = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    for (const field of ["starts_at", "ends_at"]) {
      const value = String(formData.get(field) ?? "");
      if (value) formData.set(field, new Date(value).toISOString());
    }
    run(saveJobAction(formData), () => setModal(null));
  };

  const openReminder = (invoice: Invoice) => {
    const customer = customersById.get(invoice.customer_id);
    if (!customer?.phone) {
      setError("לא שמור מספר טלפון ללקוח הזה");
      return;
    }
    const message = `היי ${firstName(customer.name)}, מזכירים שחשבונית ${invoice.invoice_number} על סך ${formatMoney(invoice.total_agorot)} עדיין לא שולמה. אפשר לעדכן אותנו אחרי התשלום? תודה, ${data.organization.name}`;
    const popup = window.open("about:blank", "_blank");
    const formData = new FormData();
    formData.set("customer_id", String(customer.id));
    formData.set("invoice_id", String(invoice.id));
    formData.set("message", message);
    startTransition(() => {
      void (async () => {
        const result = await logReminderAction(formData);
        if (!result.ok) {
          popup?.close();
          setError(result.error);
          return;
        }
        const url = `https://wa.me/${normalizeIsraeliPhone(customer.phone!)}?text=${encodeURIComponent(message)}`;
        if (popup) popup.location.href = url;
        else window.location.href = url;
        if (result.message) showToast(result.message);
      })();
    });
  };

  const visibleNav = navItems.filter((item) => item.id !== "money" || canManage);
  const pageTitle = navItems.find((item) => item.id === view)?.label ?? "היום";

  return (
    <div className="app-shell">
      <aside className="rail">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <span className="brand-copy"><strong>ServicePro</strong><small>{data.organization.name}</small></span>
        </div>
        {canManage && (
          <button className="rail-create" onClick={() => setQuickOpen(true)}>
            <Icon name="plus" /> הוספה חדשה
          </button>
        )}
        <nav className="side-nav" aria-label="ניווט ראשי">
          {visibleNav.map((item) => (
            <button key={item.id} className={view === item.id ? "nav-btn active" : "nav-btn"} onClick={() => setView(item.id)}>
              <Icon name={item.icon} /><span>{item.label}</span>
              {item.id === "today" && (unassignedJobs.length + overdueInvoices.length) > 0 && canManage && (
                <em>{unassignedJobs.length + overdueInvoices.length}</em>
              )}
            </button>
          ))}
        </nav>
        <div className="rail-profile">
          <span className="avatar">{initials(data.profile.display_name)}</span>
          <span><strong>{data.profile.display_name}</strong><small>{roleLabels[data.role]}</small></span>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="mobile-brand"><span className="brand-mark" aria-hidden="true" /><strong>ServicePro</strong></div>
          <div className="topbar-title"><span>{pageTitle}</span><small>{data.organization.name}</small></div>
          <label className="search-box">
            <Icon name="search" />
            <span className="sr-only">חיפוש</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="חיפוש לקוח, עבודה או חשבונית" />
            {query && <button type="button" onClick={() => setQuery("")} aria-label="ניקוי החיפוש"><Icon name="close" /></button>}
          </label>
          <span className="topbar-role">{roleLabels[data.role]}</span>
        </header>

        {error && (
          <div className="inline-error" role="alert">
            <Icon name="alert" /><span>{error}</span><button onClick={() => setError(null)} aria-label="סגירה"><Icon name="close" /></button>
          </div>
        )}

        <div className="page-wrap" key={view}>
          {view === "today" && (
            <TodayView
              data={data}
              todayJobs={todayJobs}
              nextJob={nextJob}
              completedToday={completedToday}
              unassignedJobs={unassignedJobs}
              overdueInvoices={overdueInvoices}
              customersById={customersById}
              teamById={teamById}
              canManage={canManage}
              pending={pending}
              paidThisMonth={paidThisMonth}
              expensesThisMonth={expensesThisMonth}
              onAdvance={(id) => run(advanceJobAction(id))}
              onEditJob={(job) => setModal({ kind: "job", job })}
              onNewJob={() => setModal({ kind: "job" })}
              onNewCustomer={() => setModal({ kind: "customer" })}
              onReminder={openReminder}
              onNavigate={setView}
            />
          )}
          {view === "calendar" && (
            <CalendarView jobs={filteredJobs} customersById={customersById} teamById={teamById} canManage={canManage} onNew={() => setModal({ kind: "job" })} onEdit={(job) => setModal({ kind: "job", job })} />
          )}
          {view === "customers" && (
            <CustomersView customers={filteredCustomers} jobs={data.jobs} canManage={canManage} onNew={() => setModal({ kind: "customer" })} onEdit={(customer) => setModal({ kind: "customer", customer })} onDelete={(id) => run(deleteCustomerAction(id))} />
          )}
          {view === "money" && canManage && (
            <MoneyView invoices={filteredInvoices} expenses={data.expenses} customersById={customersById} paidThisMonth={paidThisMonth} expensesThisMonth={expensesThisMonth} pending={pending} onNewInvoice={() => setModal({ kind: "invoice" })} onNewExpense={() => setModal({ kind: "expense" })} onPaid={(id) => run(markInvoicePaidAction(id))} onReminder={openReminder} />
          )}
          {view === "more" && <MoreView data={data} pending={pending} run={run} />}
        </div>
      </main>

      <nav className="mobile-nav" aria-label="ניווט ראשי">
        {visibleNav.map((item) => (
          <button key={item.id} className={view === item.id ? "mobile-nav-btn active" : "mobile-nav-btn"} onClick={() => setView(item.id)}>
            <Icon name={item.icon} /><span>{item.label}</span>
          </button>
        ))}
      </nav>
      {canManage && <button className="mobile-add" onClick={() => setQuickOpen(true)} aria-label="הוספה חדשה"><Icon name="plus" /></button>}

      {quickOpen && (
        <Overlay onClose={() => setQuickOpen(false)} title="מה מוסיפים?" className="quick-sheet">
          <div className="quick-grid">
            <QuickButton icon="customers" label="לקוח" detail="פרטים וכתובת" onClick={() => { setQuickOpen(false); setModal({ kind: "customer" }); }} />
            <QuickButton icon="briefcase" label="עבודה" detail="שיבוץ ביומן" onClick={() => { setQuickOpen(false); setModal({ kind: "job" }); }} />
            <QuickButton icon="invoice" label="חשבונית" detail="סכום ותאריך" onClick={() => { setQuickOpen(false); setModal({ kind: "invoice" }); }} />
            <QuickButton icon="expense" label="הוצאה" detail="רישום מהיר" onClick={() => { setQuickOpen(false); setModal({ kind: "expense" }); }} />
          </div>
        </Overlay>
      )}

      {modal?.kind === "customer" && (
        <CustomerModal customer={modal.customer} pending={pending} onClose={() => setModal(null)} onSubmit={(formData) => run(saveCustomerAction(formData), () => setModal(null))} />
      )}
      {modal?.kind === "job" && (
        <JobModal job={modal.job} customers={data.customers} technicians={technicians} pending={pending} onClose={() => setModal(null)} onSubmit={submitJob} onDelete={modal.job && data.role === "owner" ? () => run(deleteJobAction(modal.job!.id), () => setModal(null)) : undefined} />
      )}
      {modal?.kind === "invoice" && (
        <InvoiceModal customers={data.customers} jobs={data.jobs} vat={data.organization.default_vat_basis_points / 100} pending={pending} onClose={() => setModal(null)} onSubmit={(formData) => run(saveInvoiceAction(formData), () => setModal(null))} />
      )}
      {modal?.kind === "expense" && (
        <ExpenseModal pending={pending} onClose={() => setModal(null)} onSubmit={(formData) => run(saveExpenseAction(formData), () => setModal(null))} />
      )}

      {toast && <div className="toast" role="status"><Icon name="check" />{toast}</div>}
    </div>
  );
}

function TodayView({ data, todayJobs, nextJob, completedToday, unassignedJobs, overdueInvoices, customersById, teamById, canManage, pending, paidThisMonth, expensesThisMonth, onAdvance, onEditJob, onNewJob, onNewCustomer, onReminder, onNavigate }: {
  data: AppData; todayJobs: Job[]; nextJob?: Job; completedToday: number; unassignedJobs: Job[]; overdueInvoices: Invoice[];
  customersById: Map<number, Customer>; teamById: Map<string, TeamMember>; canManage: boolean; pending: boolean;
  paidThisMonth: number; expensesThisMonth: number; onAdvance: (id: number) => void; onEditJob: (job: Job) => void;
  onNewJob: () => void; onNewCustomer: () => void; onReminder: (invoice: Invoice) => void; onNavigate: (view: ViewName) => void;
}) {
  const first = firstName(data.profile.display_name);
  const heading = data.role === "technician"
    ? nextJob ? `העבודה הבאה שלך ב־${formatTime(nextJob.starts_at)}.` : "סיימת את העבודות להיום."
    : unassignedJobs.length || overdueInvoices.length
      ? `היום מתקדם כמתוכנן. נשארו ${unassignedJobs.length + overdueInvoices.length} דברים לטיפול.`
      : "הכול מסודר להיום.";
  const subheading = data.role === "technician"
    ? nextJob ? `${customersById.get(nextJob.customer_id)?.name ?? "הלקוח"} מחכה לך. כל הפרטים נמצאים כאן.` : "אין כרגע עוד עבודה שצריך להגיע אליה."
    : todayJobs.length ? `בוקר טוב, ${first}. ${todayJobs.length} עבודות ביומן, ${completedToday} כבר הסתיימו.` : `בוקר טוב, ${first}. היומן עדיין פנוי להיום.`;

  return (
    <>
      <section className="hero-row">
        <div>
          <p className="eyebrow">{formatFullDate(new Date().toISOString())}</p>
          <h1>{heading}</h1>
          <p>{subheading}</p>
        </div>
        {canManage && <button className="primary-btn" onClick={onNewJob}><Icon name="plus" />שיבוץ עבודה</button>}
      </section>

      <section className="dashboard-grid">
        <div className="route-card panel">
          <div className="panel-head">
            <div><span className="section-kicker"><Icon name="route" />מסלול היום</span><h2>{todayJobs.length ? `${completedToday} מתוך ${todayJobs.length} הסתיימו` : "אין עבודות ביומן"}</h2></div>
            {todayJobs.length > 0 && <span className="progress-number">{Math.round((completedToday / todayJobs.length) * 100)}%</span>}
          </div>
          {todayJobs.length > 0 && <div className="progress-track"><span style={{ width: `${Math.max(5, (completedToday / todayJobs.length) * 100)}%` }} /></div>}
          <div className="route-list">
            {todayJobs.length === 0 ? (
              <EmptyState icon="calendar" title="היומן פנוי" text={canManage ? "אפשר לשבץ מכאן את העבודה הראשונה להיום." : "כשתשובץ עבודה, היא תופיע כאן עם כל הפרטים."} action={canManage ? <button className="secondary-btn" onClick={onNewJob}>שיבוץ עבודה</button> : undefined} />
            ) : todayJobs.map((job, index) => {
              const customer = customersById.get(job.customer_id);
              const technician = job.technician_user_id ? teamById.get(job.technician_user_id) : undefined;
              const current = job.id === nextJob?.id;
              const actionLabel = job.status === "scheduled" ? "יצאתי לדרך" : job.status === "on_way" ? "הגעתי ללקוח" : job.status === "in_progress" ? "סיימתי את העבודה" : null;
              return (
                <article className={`route-stop ${current ? "current" : ""} ${job.status === "completed" ? "done" : ""}`} key={job.id}>
                  <div className="route-time"><strong>{formatTime(job.starts_at)}</strong><span>{index + 1}</span></div>
                  <div className="route-copy">
                    <div className="route-title"><h3>{job.title}</h3><span className={`status ${job.status}`}>{jobStatusLabels[job.status]}</span></div>
                    <p>{customer?.name ?? "לקוח"}{job.address ? ` · ${job.address}` : ""}</p>
                    {technician && <small>{technician.display_name}</small>}
                  </div>
                  <div className="route-actions">
                    {actionLabel && <button className="primary-btn compact" disabled={pending} onClick={() => onAdvance(job.id)}>{actionLabel}</button>}
                    {canManage && <button className="icon-btn" onClick={() => onEditJob(job)} aria-label="עריכת העבודה"><Icon name="edit" /></button>}
                  </div>
                </article>
              );
            })}
          </div>
        </div>

        <aside className="dashboard-side">
          {canManage && (
            <div className="panel attention-card">
              <div className="panel-head"><div><span className="section-kicker"><Icon name="alert" />צריך טיפול</span><h2>{unassignedJobs.length + overdueInvoices.length ? "נשארו כמה דברים" : "הכול מסודר"}</h2></div></div>
              {unassignedJobs.slice(0, 2).map((job) => (
                <button className="attention-row" key={job.id} onClick={() => onEditJob(job)}>
                  <span className="attention-icon amber"><Icon name="calendar" /></span>
                  <span><strong>העבודה עדיין לא שובצה</strong><small>{customersById.get(job.customer_id)?.name} · {formatDate(job.starts_at)}</small></span>
                  <Icon name="arrow" />
                </button>
              ))}
              {overdueInvoices.slice(0, 2).map((invoice) => (
                <button className="attention-row" key={invoice.id} onClick={() => onReminder(invoice)}>
                  <span className="attention-icon coral"><Icon name="invoice" /></span>
                  <span><strong>{formatMoney(invoice.total_agorot)} עדיין לא שולמו</strong><small>{customersById.get(invoice.customer_id)?.name} · חשבונית {invoice.invoice_number}</small></span>
                  <Icon name="whatsapp" />
                </button>
              ))}
              {!unassignedJobs.length && !overdueInvoices.length && <p className="all-clear"><Icon name="check" />אין כרגע משהו שמחכה לטיפול.</p>}
            </div>
          )}

          {canManage && (
            <button className="money-snapshot" onClick={() => onNavigate("money")}>
              <span><small>נכנס החודש</small><strong>{formatMoney(paidThisMonth)}</strong></span>
              <span><small>אחרי הוצאות</small><strong>{formatMoney(paidThisMonth - expensesThisMonth)}</strong></span>
              <Icon name="arrow" />
            </button>
          )}

          {canManage && (
            <div className="quick-actions panel">
              <span className="section-kicker">פעולות מהירות</span>
              <div><button onClick={onNewCustomer}><Icon name="customers" />לקוח חדש</button><button onClick={onNewJob}><Icon name="briefcase" />עבודה חדשה</button></div>
            </div>
          )}
        </aside>
      </section>
    </>
  );
}

function CalendarView({ jobs, customersById, teamById, canManage, onNew, onEdit }: { jobs: Job[]; customersById: Map<number, Customer>; teamById: Map<string, TeamMember>; canManage: boolean; onNew: () => void; onEdit: (job: Job) => void }) {
  const upcoming = jobs.filter((job) => job.status !== "cancelled" && new Date(job.ends_at) >= new Date(Date.now() - 86_400_000));
  const groups = Array.from(upcoming.reduce((map, job) => {
    const key = localDateKey(job.starts_at);
    map.set(key, [...(map.get(key) ?? []), job]);
    return map;
  }, new Map<string, Job[]>()).entries()).sort(([a], [b]) => a.localeCompare(b));

  return (
    <section>
      <PageHeading eyebrow="כל מה שמשובץ" title="היומן" text="עוברים על היום בשניות ורואים מי מגיע לכל לקוח." action={canManage ? <button className="primary-btn" onClick={onNew}><Icon name="plus" />שיבוץ עבודה</button> : undefined} />
      <div className="calendar-board panel">
        {groups.length === 0 ? <EmptyState icon="calendar" title="אין עבודות ביומן" text={canManage ? "שיבוץ חדש יופיע כאן מיד." : "עבודות שישובצו לך יופיעו כאן."} action={canManage ? <button className="secondary-btn" onClick={onNew}>שיבוץ עבודה</button> : undefined} /> : groups.map(([date, dayJobs]) => (
          <div className="day-group" key={date}>
            <div className="day-label"><strong>{formatFullDate(`${date}T12:00:00`)}</strong><span>{dayJobs.length} עבודות</span></div>
            <div className="day-jobs">
              {dayJobs.map((job) => {
                const customer = customersById.get(job.customer_id);
                const tech = job.technician_user_id ? teamById.get(job.technician_user_id) : null;
                return (
                  <button className="calendar-job" key={job.id} onClick={() => canManage && onEdit(job)}>
                    <span className={`job-color ${job.status}`} />
                    <span className="job-hours"><strong>{formatTime(job.starts_at)}</strong><small>{formatTime(job.ends_at)}</small></span>
                    <span className="job-main"><strong>{job.title}</strong><small>{customer?.name}{job.address ? ` · ${job.address}` : ""}</small></span>
                    <span className="job-tech">{tech?.display_name ?? "עדיין לא שובצה"}</span>
                    <span className={`status ${job.status}`}>{jobStatusLabels[job.status]}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function CustomersView({ customers, jobs, canManage, onNew, onEdit, onDelete }: { customers: Customer[]; jobs: Job[]; canManage: boolean; onNew: () => void; onEdit: (customer: Customer) => void; onDelete: (id: number) => void }) {
  return (
    <section>
      <PageHeading eyebrow="הכול במקום אחד" title="לקוחות" text={`${customers.length} לקוחות מוצגים`} action={canManage ? <button className="primary-btn" onClick={onNew}><Icon name="plus" />לקוח חדש</button> : undefined} />
      <div className="customer-grid">
        {customers.length === 0 ? <div className="panel"><EmptyState icon="customers" title="עוד אין כאן לקוחות" text="מוסיפים לקוח פעם אחת, ומכאן כל העבודה נשארת מסודרת." action={canManage ? <button className="secondary-btn" onClick={onNew}>הוספת לקוח</button> : undefined} /></div> : customers.map((customer) => {
          const customerJobs = jobs.filter((job) => job.customer_id === customer.id && job.status !== "cancelled");
          const lastJob = [...customerJobs].sort((a, b) => b.starts_at.localeCompare(a.starts_at))[0];
          return (
            <article className="customer-card panel" key={customer.id}>
              <div className="customer-head"><span className="avatar large">{initials(customer.name)}</span><div><h3>{customer.name}</h3><p>{customer.address || "עוד לא נשמרה כתובת"}</p></div></div>
              <div className="customer-meta"><span><Icon name="briefcase" />{customerJobs.length} עבודות</span><span><Icon name="clock" />{lastJob ? formatDate(lastJob.starts_at) : "אין עבודה קודמת"}</span></div>
              <div className="customer-contact">
                {customer.phone ? <a href={`tel:${customer.phone}`}><Icon name="phone" />{customer.phone}</a> : <span>אין מספר טלפון</span>}
                {customer.phone && <a className="whatsapp-link" href={`https://wa.me/${normalizeIsraeliPhone(customer.phone)}`} target="_blank" rel="noreferrer"><Icon name="whatsapp" />WhatsApp</a>}
              </div>
              {canManage && <div className="card-actions"><button onClick={() => onEdit(customer)}><Icon name="edit" />עריכה</button><button className="danger-text" onClick={() => { if (window.confirm("למחוק את הלקוח?")) onDelete(customer.id); }}><Icon name="trash" />מחיקה</button></div>}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function MoneyView({ invoices, expenses, customersById, paidThisMonth, expensesThisMonth, pending, onNewInvoice, onNewExpense, onPaid, onReminder }: { invoices: Invoice[]; expenses: Expense[]; customersById: Map<number, Customer>; paidThisMonth: number; expensesThisMonth: number; pending: boolean; onNewInvoice: () => void; onNewExpense: () => void; onPaid: (id: number) => void; onReminder: (invoice: Invoice) => void }) {
  const stillOpen = invoices.filter((invoice) => ["sent", "overdue"].includes(invoice.status)).reduce((sum, invoice) => sum + invoice.total_agorot, 0);
  return (
    <section>
      <PageHeading eyebrow="בלי לחפש בניירות" title="כספים" text="מה נכנס, מה יצא ומה עדיין לא שולם." action={<div className="heading-actions"><button className="secondary-btn" onClick={onNewExpense}><Icon name="expense" />רישום הוצאה</button><button className="primary-btn" onClick={onNewInvoice}><Icon name="invoice" />חשבונית חדשה</button></div>} />
      <div className="money-stats">
        <Stat label="נכנס החודש" value={formatMoney(paidThisMonth)} tone="mint" />
        <Stat label="עדיין לא שולם" value={formatMoney(stillOpen)} tone="amber" />
        <Stat label="הוצאות החודש" value={formatMoney(expensesThisMonth)} tone="coral" />
        <Stat label="נשאר אחרי הוצאות" value={formatMoney(paidThisMonth - expensesThisMonth)} tone="blue" />
      </div>
      <div className="finance-grid">
        <div className="panel finance-list">
          <div className="panel-head"><div><span className="section-kicker">חשבוניות</span><h2>חשבוניות אחרונות</h2></div><button className="text-btn" onClick={onNewInvoice}>חדשה</button></div>
          {invoices.length === 0 ? <EmptyState icon="invoice" title="עוד אין חשבוניות" text="חשבונית חדשה תופיע כאן יחד עם מצב התשלום." /> : invoices.slice(0, 30).map((invoice) => {
            const customer = customersById.get(invoice.customer_id);
            const needsPayment = ["sent", "overdue"].includes(invoice.status);
            const shownStatus = invoice.status === "sent" && invoice.due_date < localDateKey(new Date()) ? "overdue" : invoice.status;
            return (
              <div className="invoice-row" key={invoice.id}>
                <span className={`invoice-dot ${shownStatus}`} />
                <span className="invoice-copy"><strong>{customer?.name ?? "לקוח"}</strong><small>חשבונית {invoice.invoice_number} · לתשלום עד {formatDate(invoice.due_date)}</small></span>
                <span className="invoice-amount"><strong>{formatMoney(invoice.total_agorot)}</strong><small>{invoiceStatusLabels[shownStatus]}</small></span>
                {needsPayment && <div className="row-actions"><button className="icon-btn" disabled={pending} onClick={() => onReminder(invoice)} aria-label="תזכורת בוואטסאפ"><Icon name="whatsapp" /></button><button className="secondary-btn compact" disabled={pending} onClick={() => onPaid(invoice.id)}>התשלום התקבל</button></div>}
              </div>
            );
          })}
        </div>
        <div className="panel expense-list">
          <div className="panel-head"><div><span className="section-kicker">הוצאות</span><h2>מה יצא מהעסק</h2></div><button className="text-btn" onClick={onNewExpense}>הוספה</button></div>
          {expenses.length === 0 ? <EmptyState icon="expense" title="עוד לא נרשמו הוצאות" text="רושמים הוצאה בכמה שניות ורואים תמונה אמיתית של החודש." /> : expenses.slice(0, 20).map((expense) => (
            <div className="expense-row" key={expense.id}><span className="attention-icon soft"><Icon name="expense" /></span><span><strong>{expense.vendor || expense.category}</strong><small>{expense.category} · {formatDate(expense.spent_on)}</small></span><b>{formatMoney(expense.amount_agorot)}</b></div>
          ))}
        </div>
      </div>
    </section>
  );
}

function MoreView({ data, pending, run }: { data: AppData; pending: boolean; run: (action: Promise<ActionResult>, after?: () => void) => void }) {
  return (
    <section>
      <PageHeading eyebrow="כל מה שלא צריך כל יום" title="עוד" text="הצוות, פרטי העסק והחשבון נמצאים כאן." />
      <div className="more-grid">
        <form className="panel settings-card" onSubmit={(event) => { event.preventDefault(); run(updateSettingsAction(new FormData(event.currentTarget))); }}>
          <div className="panel-head"><div><span className="section-kicker"><Icon name="settings" />פרטים</span><h2>העסק והחשבון שלך</h2></div></div>
          <div className="form-grid">
            <label>השם שלך<input name="display_name" defaultValue={data.profile.display_name} required /></label>
            <label>טלפון<input name="phone" defaultValue={data.profile.phone ?? ""} inputMode="tel" /></label>
            <label className="full">שם העסק<input name="business_name" defaultValue={data.organization.name} disabled={data.role !== "owner"} required /></label>
          </div>
          <button className="primary-btn" disabled={pending} type="submit">{pending ? "שומרים…" : "שמירת הפרטים"}</button>
        </form>
        <div className="panel team-card">
          <div className="panel-head"><div><span className="section-kicker"><Icon name="team" />הצוות</span><h2>מי עובד בעסק</h2></div></div>
          <div className="team-list">{data.team.map((member) => <div className="team-row" key={member.id}><span className="avatar">{initials(member.display_name)}</span><span><strong>{member.display_name}</strong><small>{member.phone || "לא נשמר טלפון"}</small></span><em>{roleLabels[member.role]}</em></div>)}</div>
        </div>
        <div className="panel install-card">
          <span className="attention-icon blue"><Icon name="phone" /></span>
          <div><h2>גם באייפון</h2><p>פותחים את האתר ב‑Safari, לוחצים על שיתוף ואז על „הוספה למסך הבית”. האפליקציה נפתחת במסך מלא.</p></div>
        </div>
        <form action={signOutAction} className="logout-card"><button type="submit"><Icon name="logout" />יציאה מהחשבון</button></form>
      </div>
    </section>
  );
}

function PageHeading({ eyebrow, title, text, action }: { eyebrow: string; title: string; text: string; action?: ReactNode }) {
  return <div className="page-heading"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{text}</p></div>{action}</div>;
}

function Stat({ label, value, tone }: { label: string; value: string; tone: string }) {
  return <div className={`stat-card ${tone}`}><small>{label}</small><strong>{value}</strong></div>;
}

function EmptyState({ icon, title, text, action }: { icon: IconName; title: string; text: string; action?: ReactNode }) {
  return <div className="empty-state"><span><Icon name={icon} /></span><h3>{title}</h3><p>{text}</p>{action}</div>;
}

function QuickButton({ icon, label, detail, onClick }: { icon: IconName; label: string; detail: string; onClick: () => void }) {
  return <button className="quick-button" onClick={onClick}><span><Icon name={icon} /></span><strong>{label}</strong><small>{detail}</small></button>;
}

function Overlay({ title, onClose, children, className = "" }: { title: string; onClose: () => void; children: ReactNode; className?: string }) {
  return (
    <div className="overlay" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
      <section className={`modal ${className}`} role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div className="modal-head"><h2 id="modal-title">{title}</h2><button className="icon-btn" onClick={onClose} aria-label="סגירה"><Icon name="close" /></button></div>
        {children}
      </section>
    </div>
  );
}

function CustomerModal({ customer, pending, onClose, onSubmit }: { customer?: Customer; pending: boolean; onClose: () => void; onSubmit: (data: FormData) => void }) {
  return (
    <Overlay title={customer ? "עריכת לקוח" : "לקוח חדש"} onClose={onClose}>
      <form className="modal-form" onSubmit={(event) => { event.preventDefault(); onSubmit(new FormData(event.currentTarget)); }}>
        {customer && <input type="hidden" name="customer_id" value={customer.id} />}
        <label>שם הלקוח<input name="name" defaultValue={customer?.name ?? ""} autoFocus required /></label>
        <div className="form-grid"><label>טלפון<input name="phone" defaultValue={customer?.phone ?? ""} inputMode="tel" /></label><label>מייל<input name="email" defaultValue={customer?.email ?? ""} type="email" dir="ltr" /></label></div>
        <label>כתובת<input name="address" defaultValue={customer?.address ?? ""} /></label>
        <label>מה חשוב לדעת?<textarea name="notes" defaultValue={customer?.notes ?? ""} rows={3} placeholder="קוד כניסה, חניה, העדפה של הלקוח…" /></label>
        <div className="modal-actions"><button type="button" className="text-btn" onClick={onClose}>ביטול</button><button type="submit" className="primary-btn" disabled={pending}>{pending ? "שומרים…" : "שמירת הלקוח"}</button></div>
      </form>
    </Overlay>
  );
}

function JobModal({ job, customers, technicians, pending, onClose, onSubmit, onDelete }: { job?: Job; customers: Customer[]; technicians: TeamMember[]; pending: boolean; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void; onDelete?: () => void }) {
  return (
    <Overlay title={job ? "עריכת עבודה" : "שיבוץ עבודה"} onClose={onClose}>
      <form className="modal-form" onSubmit={onSubmit}>
        {job && <input type="hidden" name="job_id" value={job.id} />}
        <label>לקוח<select name="customer_id" defaultValue={job?.customer_id ?? ""} autoFocus required><option value="" disabled>בחירת לקוח</option>{customers.map((customer) => <option value={customer.id} key={customer.id}>{customer.name}</option>)}</select></label>
        <label>מה עושים?<input name="title" defaultValue={job?.title ?? ""} placeholder="למשל: טיפול תקופתי למזגן" required /></label>
        <div className="form-grid"><label>התחלה<input name="starts_at" type="datetime-local" defaultValue={dateTimeLocal(job?.starts_at, 1)} required /></label><label>סיום<input name="ends_at" type="datetime-local" defaultValue={dateTimeLocal(job?.ends_at, 2)} required /></label></div>
        <div className="form-grid"><label>למי משבצים?<select name="technician_user_id" defaultValue={job?.technician_user_id ?? ""}><option value="">עוד לא שובצה</option>{technicians.map((member) => <option key={member.id} value={member.id}>{member.display_name}</option>)}</select></label><label>מחיר משוער<input name="price" type="number" inputMode="decimal" min="0" step="0.01" defaultValue={job ? job.price_agorot / 100 : ""} placeholder="0" /></label></div>
        <label>כתובת העבודה<input name="address" defaultValue={job?.address ?? ""} /></label>
        <label>הערה לצוות<textarea name="notes" defaultValue={job?.notes ?? ""} rows={3} /></label>
        <div className="modal-actions split">{onDelete ? <button type="button" className="danger-btn" onClick={() => { if (window.confirm("למחוק את העבודה?")) onDelete(); }}><Icon name="trash" />מחיקה</button> : <span />}<span><button type="button" className="text-btn" onClick={onClose}>ביטול</button><button type="submit" className="primary-btn" disabled={pending || customers.length === 0}>{pending ? "שומרים…" : job ? "שמירת העבודה" : "שיבוץ העבודה"}</button></span></div>
        {customers.length === 0 && <p className="form-hint">לפני שמשבצים עבודה צריך להוסיף לקוח.</p>}
      </form>
    </Overlay>
  );
}

function InvoiceModal({ customers, jobs, vat, pending, onClose, onSubmit }: { customers: Customer[]; jobs: Job[]; vat: number; pending: boolean; onClose: () => void; onSubmit: (data: FormData) => void }) {
  return (
    <Overlay title="חשבונית חדשה" onClose={onClose}>
      <form className="modal-form" onSubmit={(event) => { event.preventDefault(); onSubmit(new FormData(event.currentTarget)); }}>
        <div className="form-grid"><label>לקוח<select name="customer_id" required autoFocus><option value="">בחירת לקוח</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></label><label>מספר חשבונית<input name="invoice_number" placeholder="למשל: 1042" required /></label></div>
        <label>עבודה קשורה<select name="job_id"><option value="">בלי עבודה קשורה</option>{jobs.filter((job) => job.status !== "cancelled").map((job) => <option key={job.id} value={job.id}>{formatDate(job.starts_at)} · {job.title}</option>)}</select></label>
        <div className="form-grid"><label>סכום לפני מע״מ<input name="subtotal" type="number" inputMode="decimal" min="0" step="0.01" required /></label><label>הנחה<input name="discount" type="number" inputMode="decimal" min="0" step="0.01" defaultValue="0" /></label></div>
        <div className="form-grid"><label>מע״מ באחוזים<input name="vat_percent" type="number" min="0" max="100" step="0.01" defaultValue={vat} required /></label><label>לתשלום עד<input name="due_date" type="date" defaultValue={dateInput(undefined, 14)} required /></label></div>
        <label>מצב<select name="status" defaultValue="sent"><option value="draft">טיוטה</option><option value="sent">נשלחה ללקוח</option><option value="paid">כבר שולמה</option></select></label>
        <label>הערה<textarea name="notes" rows={2} /></label>
        <div className="modal-actions"><button type="button" className="text-btn" onClick={onClose}>ביטול</button><button type="submit" className="primary-btn" disabled={pending || customers.length === 0}>{pending ? "שומרים…" : "שמירת החשבונית"}</button></div>
      </form>
    </Overlay>
  );
}

function ExpenseModal({ pending, onClose, onSubmit }: { pending: boolean; onClose: () => void; onSubmit: (data: FormData) => void }) {
  return (
    <Overlay title="רישום הוצאה" onClose={onClose}>
      <form className="modal-form" onSubmit={(event) => { event.preventDefault(); onSubmit(new FormData(event.currentTarget)); }}>
        <div className="form-grid"><label>קטגוריה<select name="category" defaultValue="ציוד וחומרים" autoFocus><option>ציוד וחומרים</option><option>דלק ונסיעות</option><option>פרסום</option><option>תוכנות</option><option>שכר מקצועי</option><option>אחר</option></select></label><label>סכום<input name="amount" type="number" inputMode="decimal" min="0.01" step="0.01" required /></label></div>
        <div className="form-grid"><label>למי שילמת?<input name="vendor" placeholder="שם הספק" /></label><label>תאריך<input name="spent_on" type="date" defaultValue={dateInput()} required /></label></div>
        <label>הערה<textarea name="description" rows={3} placeholder="מה קנית או על מה שילמת" /></label>
        <div className="modal-actions"><button type="button" className="text-btn" onClick={onClose}>ביטול</button><button type="submit" className="primary-btn" disabled={pending}>{pending ? "שומרים…" : "שמירת ההוצאה"}</button></div>
      </form>
    </Overlay>
  );
}
