# ServicePro — UX/UI & Bug Audit

**App:** `servicepro-app` (Next.js 16 / React 19 / Supabase / Tailwind + one big global stylesheet)
**Reviewed commit:** `30ec629` — *Merge PR #9, "Add role-aware finance, privacy, team, and admin operations"* (`main`)
**Live URL tested:** `servicepro-app-git-main-chimneystar.vercel.app` — signed in as **owner**, org *Santa Chimney* (USD)
**Date:** 29 July 2026
**Method:** full source review of the cloned repo + live click-through of public and authenticated screens in both locales, with computed styles measured in-page. Every issue below is backed by either a file/line reference or a live measurement.

> **Note on the URL.** `servicepro-app.vercel.app` (no `-git-main-chimneystar`) is **not your app** — it serves a completely different "Service PRO" login page with a *Username* field. If you've been sharing that link, customers are landing on somebody else's product. Your production alias is `servicepro-app-git-main-chimneystar.vercel.app`.

---

## Health check — what's solid

Worth saying up front, because the issue list is long and the foundation is not the problem:

| Check | Result |
| --- | --- |
| Unit tests (`node --test`, 9 files) | **65/65 pass** |
| Feature-preservation / tenant-isolation / hydration guards | **13/13 pass** |
| i18n dictionary balance | **240 EN keys ≡ 240 HE keys**, zero missing, zero duplicates |
| Tables referenced in code vs live DB | 84 of 85 exist (one typo — see B1) |
| RTL in the global stylesheet | Good — 18 `inset-inline-end`, 10 `inset-inline-start`, only 3 physical `left/right` rules |
| Contrast of the main text tokens | `--muted` on white = **4.84:1** (passes AA) |
| Industry packs | 158 lines of properly bilingual trade catalogues (chimney, air-duct, dryer-vent, painting, masonry…) — genuinely good content |

The problems are concentrated in three places: **type scale**, **i18n coverage outside the dictionary**, and **navigation reachability**.

---

## P0 — Ship-blockers

### A1. The type scale is inverted: 164 CSS rules render below 12px, 55 of them below 10px

This is the single biggest UX problem in the app, and it's systemic rather than a one-off.

`app/globals.css` font-size histogram:

| Size | Rules |
| --- | --- |
| **7px** | 3 |
| **8px** | 22 |
| **9px** | 30 |
| **10px** | 59 |
| **11px** | 50 |
| 12px | 30 |
| 13px | 18 |
| 14–47px | 172 |

Meanwhile headlines are enormous. On the dashboard, `.dashboard-hero h1` is `clamp(29px, 4vw, 47px)` while the content inside the same viewport is 8–10px:

Live measurement, `/` as owner in Hebrew — **29 of 154 visible text nodes are under 12px; 12 are under 10px**:

| Rendered size | Text |
| --- | --- |
| **8px** | `מה קורה היום` (section eyebrow) |
| **8px** | `העבודה הקרובה מחכה לאיש צוות` (the actual alert copy) |
| **8px** | `AC Cleaning` (the service on the job card) |
| **9px** | `יום רביעי, 29 ביולי` |
| **9px** | `09:00` (the appointment time) |
| **9.5px** | `1 עבודות ללא שיבוץ` |
| **10px** | `Abraham Ron` (the customer's name) |
| 47px | `שלום 👋` |

So the greeting is 47px and the customer's name is 10px. Worst offenders in CSS: `.job-pulse-track small` (8px), `.dashboard-attention > a small` (8px), `.call-main > div span` (**7px**), `.warranty-queue-status span` (**7px**), `.release-checks span` (**7px**).

This is worse in Hebrew than English. Hebrew has no ascenders or descenders to help word-shape recognition, so 8px Hebrew is materially harder to read than 8px Latin at the same size.

It also hits customers, not just staff. On the **public booking page** (`/book/[org]`):

| Rendered size | Text |
| --- | --- |
| 36px | `What can we help with?` |
| **14px** | `AC Cleaning` — the thing the customer is being asked to choose |
| **9.5px** | `60 min · Service` |
| **9px** | the `EN` / `עב` language buttons |
| **8.5px** | `Powered by ServicePro · Secure booking` |

**Fix:** this needs a single deliberate type ramp (e.g. 12 / 14 / 16 / 20 / 24 / 32 / 40) applied as CSS custom properties, with a hard floor of **13px for body text and 11px for true micro-labels**. Nothing should render below 11px. Given the volume, do it as one sweep of `globals.css` rather than screen by screen.

---

### A2. The "Larger text" accessibility setting does nothing

`/appearance` offers **"טקסט גדול / Larger text — Makes text and important controls larger."** It does not.

The mechanism (`app/globals.css:69`):

```css
html[data-text-scale="large"] { font-size: 112.5%; }
```

That only scales `rem`/`em` values. But:

- `app/globals.css` has **384 `font-size` declarations and exactly 0 of them use `rem` or `em`** — 374 are hardcoded `px`, 10 are `clamp()` in px/vw.
- Components add a further **470 inline `fontSize: <px number>`** values.

Verified live on `/login` — I set `data-text-scale="large"` and re-measured:

```
root font-size: 16px → 18px   ✅ (the root did change)
h1:     47px → 47px
p:      18px → 18px
label:  12px → 12px
elements whose computed size changed: []
```

The root grows and **nothing else moves**. A user who turns this on because they can't read the 8px text gets no change at all, and reasonably concludes the app is broken.

**"High contrast" has the same shape of problem.** `html[data-contrast="high"]` remaps only `--muted` and `--line` — but there are **468 hardcoded hex colours in `globals.css` and 343 more in inline component styles** that the toggle can't touch.

**Fix:** convert `font-size` to `rem` (a scripted find-and-replace over `globals.css` is realistic; the inline `fontSize` props need to become classes). Until then, either remove the toggle or scale with `zoom`/`transform` so the promise is honest.

---

### A3. Expanding "Tools" pushes 11 of 28 nav items off-screen

`components/SidebarTools.tsx` groups 11 destinations under a collapsible **כלים / Tools**. When expanded on a standard laptop viewport, the whole group renders below the fold, behind the fixed `.side-utilities` panel.

Measured live on `/operations`, viewport 1491×812:

```
.side-nav  clientHeight: 738px   scrollHeight: 1162px   overflow: 424px
.side-utilities starts at y = 815px
nav links rendering below y=815 (i.e. behind/below the utilities block): 11
  מסלול (Route) · מחזורי (Recurring) · מלאי (Inventory) · מחירון (Price book) ·
  תפעול (Operations) · אחריות וחזרות (Warranties) · מפת צוות (Live team map) ·
  צמיחה (Growth) · ייבוא נתונים (Migration) · פרטיות ושמירת מידע (Privacy) ·
  מראה ונגישות (Appearance)
```

`overflow-y: auto` is set, so it's technically scrollable — but there's no scrollbar affordance and the user's click on "Tools" appears to do nothing. **Every single Tools item is invisible.** That's Route, Recurring, Inventory, Price book, Operations, Warranties, Fleet, Growth, Migration and Privacy — a large share of the product you've been building.

I reproduced the same clipping at 860px window height (Settings and Tools both cut off).

**Fix:** don't nest a scroll container inside a fixed-height sidebar. Either let the whole sidebar scroll as one column with the utilities block scrolling with it, or auto-scroll the expanded group into view on open.

---

### A4. Invoices is unreachable on mobile

Pure logic bug in `components/Nav.tsx:29` interacting with `app/(app)/more/page.tsx`.

```ts
// Nav.tsx:29
const tabItems = hasMore ? [...bottomItems.slice(0, 4), { href: "/more", … }] : bottomItems.slice(0, 5);
```

```ts
// more/page.tsx — only shows items that are NOT bottom
const items = NAV_ITEMS.filter((i) => … && !i.bottom && …);
```

For an **owner**, `bottomItems` resolves in order to `[/, /dispatch, /schedule, /customers, /invoices]` — five items. `slice(0, 4)` keeps the first four and drops `/invoices`. And because `/invoices` is flagged `bottom: true`, the More page filters it out too.

**Result: on a phone, owners and office staff have no route to Invoices at all** — not in the tab bar, not under More. For a field-service billing app that's a revenue-path blocker.

**Fix:** make the More page list *everything* the role can reach that isn't already in the visible tab bar, rather than keying off the `bottom` flag.

---

### A5. Hebrew customers see English service names on the public booking page

Verified live: `/book/1d51e61d-…` in Hebrew renders all the chrome correctly (`שלב 1 מתוך 5`, `במה אפשר לעזור?`, `מחיר לאחר בדיקה`, `60 דקות · שירות`) and then lists every service in English: **AC Cleaning, AC Install, AC Repair, Annual Maintenance, Plumbing, Electrical, Renovation, Other**.

Root cause, `db/020_booking_experience.sql:78` — the Hebrew column is seeded from the English one:

```sql
insert into public.booking_services(organization_id,job_type_id,name_en,name_he,duration_min,price_minor,sort)
select jt.organization_id, jt.id, jt.name, jt.name, jt.duration_min, jt.default_price_minor, jt.sort
--                                     ^^^^^^^  ^^^^^^^  name_en and name_he both get jt.name
from public.job_types jt
```

The `sync_booking_service_from_job_type()` trigger repeats it (`values(…, new.name, new.name, …)`) and its `on conflict do update` clause updates **`name_en` only** — so `name_he` can never self-correct, even if the job type is renamed.

**This is the customer-facing booking funnel.** A Hebrew-speaking customer is asked to pick from an English menu.

---

### A6. Every business publishes the same generic HVAC menu — including a chimney sweep

The public booking page for **Santa Chimney** offers *AC Cleaning, AC Install, AC Repair, Plumbing, Electrical, Renovation*. All 7 organizations in the database have exactly 8 booking services.

The chain: `booking_services` ← `job_types` ← a hardcoded default array in `db/005_more.sql:8`:

```sql
default array['AC Cleaning','AC Install','AC Repair','Annual Maintenance',
              'Plumbing','Electrical','Renovation','Other']::text[];
```

Meanwhile `lib/industry-packs.ts` contains a **fully bilingual 21-item chimney pack** (`ניקוי ארובה רגיל`, `בדיקת ארובה דרגה 1`, `הסרת קריאוזוט כבד`, `התקנת שרוול נירוסטה לארובה`…) plus air-duct, dryer-vent, painting and masonry packs. **None of it reaches `job_types`.** The good content you built is sitting unused while a chimney company advertises AC installs to the public.

The same array is *also* duplicated in `app/(app)/schedule/JobForm.tsx:11` as `DEFAULT_SERVICES`, so there are two independent copies of the wrong default.

---

## P1 — Significant

### B1. `/admin` queries a table that doesn't exist; merchant status is always wrong

`app/(app)/admin/page.tsx:9`:

```ts
admin.from("merchant_accounts").select("organization_id,status")
```

I checked all 85 table names the code references against your live database. **84 exist. `merchant_accounts` does not** — the table is `merchant_connections`.

Because the destructure takes only `data` and never `error`, the failure is silent: `merchantRows` is `null`, and `merchantStatus` falls through to its default, so the admin console reports **"not connected"** for every organization forever, including ones that are connected.

**This is a systemic pattern.** Across `app/` and `lib/`:

- **161** queries destructure `{ data }` only
- **28** also destructure and check `error`

So roughly **85% of reads fail silently.** A typo like this one can't surface as an error; it can only surface as quietly wrong numbers. Worth a lint rule.

### B2. Bidirectional text breaks wherever an English string sits in the RTL layout

No `dir="auto"` or bidi isolation anywhere. Live examples:

| Screen | DOM text | What the user sees |
| --- | --- | --- |
| `/jobs` | `9 jobs` | **`jobs 9`** |
| `/search?q=abraham` | `4 results for "abraham"` | **`"results for "abraham 4`** — count flung to the far right, opening quote orphaned |
| `/jobs` | `Search client, service, address, tag…` | ellipsis leads: **`…Search client, service, address, tag`** |
| `/reports/custom` | breadcrumb `Reports ›` | chevron points away from the content in RTL |

Fix is cheap: `dir="auto"` on any element rendering interpolated user data or an untranslated Latin string, and `‹`/`›` chosen from locale.

### B3. Search-field icons sit on the wrong side in RTL

`components/JobsList.tsx:49` and `:50`:

```tsx
<span style={{ position: "absolute", left: 12, … }}>🔍</span>
<input style={{ … padding: "11px 12px 11px 38px" … }} />
```

Physical `left` and physical left-padding. Measured live on `/jobs` with `dir="rtl"`:

```
padding-left: 38px    ← the space reserved for the icon
padding-right: 12px   ← where the Hebrew text actually starts
```

So the magnifier floats over empty space on the left while typed Hebrew runs up against a 12px edge on the right. Same pattern in `components/CustomerList.tsx:25`, `components/DocList.tsx:68`, `app/(app)/archive/ArchiveList.tsx:27`. Swap to `inset-inline-start` / `padding-inline-start`.

### B4. The `/jobs` filter strip is clipped — the first tab reads "nding approval"

Measured live:

```
.scroll-x  clientWidth: 900px   scrollWidth: 1167px   scrollLeft: 0   → 267px hidden
```

In an RTL container `scrollLeft: 0` is the *wrong* end, so **Pending approval** renders as **"nding approval"** and 267px of filters are unreachable without discovering the horizontal scroll. Initialise `scrollLeft` to the inline-start edge for RTL, or wrap the filters instead of scrolling them.

### B5. Roughly a third of the UI never goes through the translation layer

59 of ~170 `.tsx` files contain no `t()` call, no locale prop and no `he ?` ternary. Fully English screens I confirmed live in a Hebrew workspace:

- **`/search`** — `Search`, `CLIENTS`, `No matches. Try a name, phone, service, or document number.` (`app/(app)/search/page.tsx:35,37,49`)
- **`/reports/custom`** — 100% English: `Custom report`, `Save as PDF`, `From`/`To`, `Include sections`, `Generate report`, `Sales summary`, `Revenue collected`, `Profit & loss`, `Gross profit`, `Net profit`, `Sales by technician`, `No data in this period.`
- **`/jobs`** — H1 `Jobs`, all seven filter tabs, status badges (`Scheduled`), `4d in status`, search placeholder
- **`/customers`** — `Search by name, address, or phone…`, `3 matches`
- Also: `/route`, `/reports/timesheets`, `/reports/commission`, `/reports/export`, `/customers/import`, `/archive`, `/archive/import`, `/leads` board, `/messages/[phone]`, `/estimates/[id]/edit`, `/invoices/[id]/edit`, and ~40 components (`JobItems`, `JobPhotos`, `JobTasks`, `JobChecklist`, `DocEditor`, `DocView`, `InventoryClient`, `RecurringClient`, `Calendar`, `ShareDoc`…).

There are also **three competing i18n styles** in the codebase — `t(locale, "key")`, inline `he ? "…" : "…"` ternaries, and bare English. Worth standardising on `t()` before the surface grows further.

### B6. No pluralisation in either language

`app/(app)/page.tsx:89,93`:

```ts
he ? `${unassigned.length} עבודות ללא שיבוץ` : `${unassigned.length} unassigned jobs`
```

Live on the dashboard this renders **`1 עבודות ללא שיבוץ`** — "1 jobs". Hebrew needs `עבודה אחת`; English needs `1 unassigned job`. Same pattern in `CustomerList.tsx:33` (`match`/`matches` by string concat) and `search/page.tsx:37`. String concatenation can't express Hebrew's singular/dual/plural rules — this needs an `Intl.PluralRules`-backed helper in `lib/i18n.ts`.

### B7. Raw database enum values are shown to users

`/jobs` displays `Scheduled`, `Submitted`, `In Progress` straight from the column; `/search` renders `j.stage` and `i.status` (`search/page.tsx:41,45`); `/admin` falls back to the literal string `"not connected"`. These are internal identifiers leaking into the UI in English regardless of locale.

### B8. Two different date formats on one screen

`/reports/custom` shows the range pickers as **`07/01/2026` – `07/31/2026`** (US `MM/DD/YYYY`, from the native `date` input) and then prints the report header as **`Report · 1/7/2026 – 31/7/2026`** (`D/M/YYYY`). Same page, same range, contradictory formats — `07/01` and `1/7` are the same day rendered two ways. Genuinely ambiguous.

Dates elsewhere are US-English regardless of locale: `/jobs` shows `Wed, Jul 29`, `Sun, Jul 26` in the Hebrew UI.

### B9. Seven `confirm()` dialogs, all English, all unstyled

`app/(app)/leads/LeadsBoard.tsx:31` `"Delete this lead?"` · `expenses/ExpensesClient.tsx:24` `"Delete this expense?"` · `pricebook/PriceBookClient.tsx:21` `"Delete this item?"` · `archive/ArchiveList.tsx:20` `"Move this record into your active customers?"` · `components/RecurringClient.tsx:23` `"Delete this plan?"` · `components/InventoryClient.tsx:20` `"Delete this item?"` · `components/JobPhotos.tsx:49` `"Delete this photo?"`

15 files use native `confirm`/`alert` in total. Native dialogs can't be translated, can't be styled, and on the destructive ones give no indication of what will actually be lost.

---

## P2 — Worth fixing

### C1. `/expenses` is a finished feature with no way in

`app/(app)/expenses/page.tsx` works, and is **fully translated** — live it renders `הוצאות`, `הוצאה חדשה`, `רווח נקי`, `החודש`, `אין הוצאות עדיין`. Two working server actions (`addExpense`, `deleteExpense`). Translation keys exist in both dictionaries (`lib/i18n.ts:195,376` — `"nav.expenses": "Expenses"` / `"הוצאות"`).

But there is **no `NAV_ITEMS` entry**, and I found no `Link`, `href` or `router.push` to `/expenses` anywhere in the codebase — only `revalidatePath("/expenses")` calls. `/more` just re-renders `NAV_ITEMS`, so it isn't there either. The nav key was written and then the nav item was never added. Only reachable by typing the URL.

### C2. Contrast failures on small text

Computed from your tokens (WCAG AA needs 4.5:1 for text under 18.66px bold / 24px):

| Element | Colours | Ratio | Verdict |
| --- | --- | --- | --- |
| `--subtle` as body text | `#8d97a9` on `#ffffff` | **2.94:1** | **Fails** — used as a text colour in 6 rules |
| `.mobile-tabs a` (inactive, 10px) | `#8994a8` on `#fff` | **3.06:1** | **Fails** — this is the primary mobile nav |
| `.password-checks span` (9px) | `#7d8798` on `#eef2f7` | **3.23:1** | **Fails** — the signup password rules |

The mobile-tab and password-check figures are derived from `globals.css` plus contrast maths; I couldn't force a true mobile viewport in the browser session, so treat those two as high-confidence-but-unrendered rather than eyes-on.

### C3. Hebrew placeholder is clipped on the signup form

`lib/i18n.ts:265` — `"signup.businessPlaceholder": "לדוגמה: שירותי האוויר של אוסטין"`. Live on `/signup` it renders as **`לדוגמה: שירותי האוויר של אוסנ`** — the last two characters are cut.

Measured with canvas text metrics against the real computed font:

```
placeholder width: 237px    available field width: 221px    overflow: +16px
```

Also on that form: the three password-requirement pills render at **9px**, and the phone placeholder is a hardcoded `"(555) 123-4567"` (`SignUpForm.tsx:56`) rather than driven by the organisation's country — fine for your US orgs today, brittle the moment one isn't.

### C4. The show-password control is an unlabelled circle

`app/login/LoginForm.tsx:41`:

```tsx
<button … aria-label={showPassword ? t(locale,"login.hidePassword") : t(locale,"login.showPassword")}>
  {showPassword ? "◉" : "○"}
</button>
```

The `aria-label` is correct, so screen readers are fine — but sighted users see a bare blue ring inside the password field with no affordance suggesting "reveal". I zoomed in to confirm: it reads as a rendering glitch, not a button. Use an eye / eye-slash icon (you already have `components/AppIcon.tsx`).

### C5. Unlabelled colour picker on `/operations`

The "צוותים / Crews" form renders `<input type="color" name="color" value="#2463eb">` with **no label, no `aria-label`, no `title`** — I inspected the DOM to confirm. It appears as an unexplained grey-bordered blue square between the name field and the Add button. Nothing tells the user it sets the crew's colour.

Same card: the service-area form labels a field **`ZIP`** in English inside an otherwise-Hebrew form, with `78701,78702` and `למשל: צפון אוסטין` as examples.

### C6. Permission denials render as a generic crash screen

`lib/auth.ts:45` — `assertRole` throws `new Error("forbidden")`, and `assertCapability` does the same. There's no permission-specific boundary, so this bubbles to `app/error.tsx` and the user gets **"משהו השתבש / Something went wrong — Your information is safe. Try again."** plus an error reference code.

For an office user who clicked something an owner-only page, that's actively misleading: it looks like a bug in your app rather than a deliberate boundary. Needs a 403 state that says *you don't have access to this* and offers a way back.

### C7. `app/error.tsx` reads direction from `document` during render

```tsx
const he = typeof document !== "undefined" && document.documentElement.dir === "rtl";
```

`app/layout.tsx` already resolves the locale server-side from the cookie. Reading `document` here means any server-rendered pass of the error boundary evaluates `he` as `false` and shows English to a Hebrew user. Pass `locale` down instead.

### C8. Browser tab title and meta description are Hebrew-only

`app/layout.tsx:9-10`:

```ts
title: "ServicePro | ניהול עסקי שירות",
description: "לקוחות, עבודות, צוות וכספים במקום אחד",
```

Static, not locale-aware. Every English user gets a Hebrew tab title — visible in every screenshot I took, including the English-locale ones. `metadata` can be a function of the locale cookie.

### C9. Duplicate records suggest missing de-duplication

Observed live rather than inferred, so worth a look:

- `/search?q=abraham` returns **four identical** `Abraham Ron · Pflugerville · 8182109775` customer records.
- `/jobs` shows **five** `Abraham Ron · AC Cleaning` jobs all at `Sun, Jul 26 · 09:00 · 14199 N IH35, Pflugerville` — two priced `$189.00`, three `$0.00`.
- The `organizations` table holds **three rows named "Santa Chimney"** plus one "Santa Chimney Sweep", with inconsistent tax settings (`825` bps on two, `0` on two).

Some of this is probably test data. But there's no unique constraint or soft-match warning on customer phone/name at creation, and `create_org_and_owner` makes a brand-new workspace on every signup with no "this business already exists" path other than an invitation — which is how you end up with three Santa Chimneys.

### C10. Production runs schema from an unmerged branch — and `MIGRATIONS.md` builds a broken database

*Expanded 31 Jul after reviewing the E2E requirements doc — the original entry understated this.*

**Two competing migration systems.** `db/*.sql` uses hand-numbered files (`002_` … `022_`) and is what `main` ships. But the branch `feature/live-communications-payments` introduces a second convention, `supabase/migrations/` with CLI timestamps, containing `20260727000100_live_communications_payments.sql`.

**That branch was never merged — but its migration was applied to production.** Counted directly:

```
production `public` base tables:        102
tables created by main's 21 SQL files:   97
difference:                               5
```

All five untracked tables — `communications`, `conversations`, `communication_attachments`, `integration_connections`, `provider_webhook_events` — are created by that one unmerged file, and by nothing on `main`. So the live database carries Gmail/Twilio integration schema for a feature that doesn't exist in the deployed code.

`provider_webhook_events` additionally has **RLS enabled with zero policies** (Supabase linter), so nothing can read or write it under normal credentials.

**`db/MIGRATIONS.md` cannot build a working database.** Line 46, the only "fresh project" instruction:

> Run `schema.sql`, then `002_*` … `015_*`, followed by `017_*`, then create the two storage buckets.

That omits **018, 019, 020, 021 and 022** — permissions, operations/growth, the entire booking experience, warranties/call tracking, and privacy/finance/admin. Anyone following it gets a database the app cannot run against, and the failure is quiet: most pages just render empty. There is also no section titled *"Building a database from zero"*, which is what the E2E requirements doc instructs people to follow — so the correction they believe exists has not been pushed.

The numbering gap is a trap in itself: there is no `016_*` migration (`016_isolation_tests.sql` is a test script), which makes "stop after 017" look plausible.

**Dead table:** `webhook_events` is defined in `db/013_security_hardening.sql`, `db/GO-LIVE.sql` and `db/schema.sql` — and referenced by **no application code at all**. Not to be confused with `provider_webhook_events` above; the two are unrelated and neither is wired up.

**Status:** the branch is intended to be merged, which closes the drift on its own. Two things to handle as part of that: give `provider_webhook_events` an RLS policy (its webhook recorder will otherwise silently fail for anything but the service role), and retire one of the two migration conventions — shipping both is how production got ahead of `main` unnoticed.

A corrected `MIGRATIONS.md` is provided alongside this report, plus `servicepro-e2e/` — a local-only bootstrap that builds a throwaway database from `main` with the correct migration order enforced by filename.

Also from the Supabase security linter: **leaked-password protection is disabled**. Your signup only demands 8 characters with a letter and a number, so turning on the HaveIBeenPwned check is a cheap, high-value win. Fourteen `SECURITY DEFINER` functions are `anon`-executable — mostly deliberate (`submit_booking`, `public_document`, `public_customer_portal`), but `current_org_id()`, `current_user_role()`, `create_booking_settings_for_org()` and `sync_booking_service_from_job_type()` are internal helpers that shouldn't be reachable from `/rest/v1/rpc/…`.

### C11. Minified source files

`app/(app)/admin/page.tsx` is a **single 2,100-character line**. `components/QuickCreate.tsx`, `app/(app)/settings/booking/actions.ts` and several others are similarly collapsed. This is why the `merchant_accounts` typo (B1) is easy to miss and hard to review — the whole page, eight parallel queries and the JSX all sit on one line. Run Prettier over the repo.

### C12. Empty state with no message

The dashboard's `הכנסות · ששת החודשים האחרונים` chart renders month labels (`פבר׳ מרץ אפר׳ מאי יוני יולי`) with no bars, no axis and no explanatory text — just blank space above the labels. `components/MiniCharts.tsx` has no zero-data branch. Say "no revenue recorded in this period yet" instead of showing an empty frame.

---

## Suggested order of work

| # | Item | Why first |
| --- | --- | --- |
| 1 | **A3** sidebar overflow | 11 destinations are invisible right now — one CSS fix |
| 2 | **A4** mobile Invoices | Revenue path, ~3 lines in `Nav.tsx` / `more/page.tsx` |
| 3 | **B1** `merchant_accounts` → `merchant_connections` | One-word fix; then add the `error`-check lint rule |
| 4 | **A5 + A6** booking services | Customer-facing, and you already own the content in `industry-packs.ts` |
| 5 | **A1** type scale | Biggest single UX win; do it as one `globals.css` sweep with a `rem` ramp |
| 6 | **A2** text-scale / contrast toggles | Falls out of A1 almost for free once sizes are `rem` |
| 7 | **B2–B4** RTL/bidi | Cheap, and the app's whole premise is being bilingual |
| 8 | **B5–B8** i18n coverage, plurals, dates | Larger but mechanical; standardise on `t()` |
| 9 | **C1** wire up `/expenses` | One `NAV_ITEMS` line |
| 10 | **C10** enable leaked-password protection, lock down the four internal RPCs | Fast security wins |

---

## Caveats on scope

- **Read-only session, as agreed.** I navigated and inspected; I never submitted a form, saved a record or deleted anything. So "does *saving* an expense actually work" is untested — I verified the actions exist and are wired, not that they round-trip.
- **Owner role only.** Role-gated behaviour for `office` and `tech` is described from `lib/auth.ts` and `config/feature-manifest.json`, not exercised.
- **Desktop viewport only.** `resize_window` didn't shrink the page viewport in this session (`innerWidth` stayed at 1510), so `.mobile-tabs` never rendered. The mobile findings (A4, C2) come from navigation logic and CSS, which is solid reasoning but not eyes-on.
- **`npm ci` never completed** in the sandbox, so `tsc --noEmit` and `eslint` couldn't run cleanly — the `next/server` type errors it emitted were install artifacts, not real. I checked the two genuine-looking null errors by hand (`admin/page.tsx`, `onboarding/page.tsx`) and both have correct `redirect()` guards, so they're narrowing false positives. **A clean typecheck/lint pass is still worth running locally** — I can't claim the app is type-clean.
- The 65 unit tests and 13 guard tests I *did* run all pass.

---

*Companion file: `servicepro-inventory.md` — full inventory of routes, features, server actions, API endpoints, database objects, roles and capabilities.*
