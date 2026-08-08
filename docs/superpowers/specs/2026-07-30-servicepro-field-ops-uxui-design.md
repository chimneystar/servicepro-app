# ServicePro Field Ops — UX/UI design specification

**Date:** July 30, 2026
**Status:** Approved design direction; implementation pending specification review
**Product:** ServicePro United States field-service CRM
**Languages:** English and Hebrew, with complete RTL support

## 1. Objective

Make ServicePro effortless to understand and fast to operate for owners, office/dispatch staff, and technicians without removing, hiding beyond discovery, or weakening any existing feature.

The redesign adapts proven field-service workflow logic—schedule-first mobile work, job-centered quick actions, availability during assignment, and persistent action-needed states—while retaining ServicePro’s own blue/yellow identity and bilingual advantage.

## 2. Non-negotiable product rules

1. No existing route, setting, permission, workflow, or feature may be removed as part of this redesign.
2. The feature-preservation manifest remains an enforced release contract.
3. English and Hebrew receive equal design, copy, QA, and accessibility treatment.
4. Hebrew copy must be naturally authored for Israeli/Hebrew-speaking users, not mechanically translated.
5. Green is reserved for paid, complete, confirmed, or successful states. Blue is the primary action color and yellow is the contrasting attention color.
6. Every screen must work on desktop and mobile, at 200% zoom, with keyboard navigation, reduced motion, and light/dark/system themes.
7. A visible feature is not considered complete unless its full workflow operates and all error/retry states are understandable.
8. Major UI changes must be shown visually before publication.

## 3. Problems being corrected

The live audit found 434 visible text elements smaller than 12 px and 1,541 smaller than 14 px across 37 workflows. Booking Settings, Calls, Finance, Admin, Privacy, Payments, Schedule, and Dashboard are the worst offenders.

Additional systemic problems:

- Low-contrast account-switch links and legal/helper text.
- Hard-coded light panels that can inherit light text from dark/system themes.
- Inconsistent type sizes, control heights, spacing, card radii, and headings.
- Dense navigation and long dashboards that expose too much at once.
- Role-specific routes without an owner preview mode.
- Older screens that bypass shared design and translation systems.
- Inconsistent dialog, menu, focus, keyboard, and touch behavior.
- Hebrew layouts that technically switch direction but do not always receive equivalent visual composition.

## 4. Selected direction

### ServicePro Field Ops

ServicePro should feel like a calm operational control center—not a generic dashboard and not a visual copy of Workiz.

The signature interaction is a persistent **Today rail** that connects the owner’s attention queue, the office dispatch timeline, and the technician’s next-job actions. It expresses one shared operational truth differently for each role.

### Alternatives rejected

- **Typography-only repair:** faster, but leaves inconsistent hierarchy, navigation, controls, and role workflows.
- **Near-Workiz visual imitation:** familiar, but weakens ServicePro’s identity and does not solve bilingual/RTL needs well enough.

## 5. Visual system

### Color tokens

| Token | Value | Purpose |
|---|---:|---|
| Navy ink | `#101A2E` | Primary text and navigation foundation |
| Service blue | `#2B66F6` | Primary actions, focus, selected states |
| Deep blue | `#1F4FD1` | Hover/pressed actions and high-contrast blue text |
| Service yellow | `#F8C928` | Attention, active timeline point, branded contrast |
| Yellow ink | `#5F4900` | Readable text on yellow surfaces |
| Canvas | `#F4F7FB` | Application background |
| Surface | `#FFFFFF` | Primary cards and fields |
| Muted surface | `#EDF2F8` | Secondary groups and inactive states |
| Border | `#D7E0EC` | Control and section boundaries |
| Muted text | `#55647A` | Supporting text with AA contrast |
| Success | `#15803D` | Paid, complete, sent, connected |
| Danger | `#C94055` | Destructive actions and failures |

Dark and system themes use equivalent semantic tokens. Public light pages establish their own local text/surface tokens so a saved dark theme can never make account, booking, portal, estimate, invoice, or signing text disappear.

### Typography

| Role | Desktop | Mobile | Line height |
|---|---:|---:|---:|
| Display/hero | 40–48 px | 30–36 px | 1.05–1.12 |
| Page title | 30–36 px | 26–30 px | 1.15 |
| Section title | 18–20 px | 17–19 px | 1.3 |
| Card title | 15–16 px | 15–16 px | 1.35 |
| Operational/body text | 14–16 px | 14–16 px | 1.5–1.65 |
| Supporting text | 12–13 px | 12–13 px | 1.45–1.55 |
| Eyebrow/badge | 11–12 px | 11–12 px | 1.3 |
| Controls | 14 px minimum | 14 px minimum | 1.3 |

No meaningful text may be smaller than 12 px. Very small decorative numerals may use 11 px only when they are not required to understand or operate the interface.

Rubik remains the restrained heading/display face. Heebo remains the body and Hebrew face. Hebrew headings use slightly less negative tracking than English and are visually checked rather than inheriting Latin spacing blindly.

### Spacing and sizing

- Base spacing unit: 4 px.
- Common gaps: 8, 12, 16, 20, 24, 32 px.
- Minimum interactive target: 44 × 44 px.
- Input height: 48 px standard; 44 px compact tables only.
- Primary button height: 48 px.
- Card padding: 18–24 px desktop; 16–18 px mobile.
- Card radius: 16–20 px; compact controls 10–12 px.
- Shadows are quiet and reserved for elevation, not every container.

## 6. Information architecture

### Primary navigation

The desktop and mobile navigation use five understandable hubs:

1. **Today** — dashboard, attention, technician status, route.
2. **Schedule** — schedule, dispatch, jobs, recurring work.
3. **Customers** — leads, customers, messages, calls, warranties.
4. **Money** — estimates, invoices, payments, expenses, finance, reports.
5. **More** — inventory, price book, fleet, growth, migration, operations, team, appearance, settings, administration.

All current routes remain reachable. Desktop may expose frequently used subitems inside an expanded hub. Mobile uses the five hubs and a role-aware create button that never overlaps navigation.

### Search and creation

- Global search remains visible on desktop and reachable in one tap on mobile.
- Quick Create contains only actions allowed for the signed-in role.
- Menu items use consistent icons, descriptions, keyboard movement, focus management, Escape behavior, and screen-reader semantics.

## 7. Role-specific experiences

### Owner

Priority order:

1. Needs attention: overdue invoices, unassigned work, failed payments, callbacks, expiring warranties.
2. Today’s operational status.
3. Financial and sales snapshot.
4. Team/service exceptions.
5. Compact setup progress.
6. Secondary analytics, collapsed when empty.

Owner receives a clearly labeled, read-only **Preview as Office** and **Preview as Technician** mode. Preview never changes permissions or identity and cannot perform writes unavailable to the owner’s current real context.

### Office/dispatch

Priority order:

1. Unassigned and conflicting work.
2. Technician timeline and availability.
3. Incoming calls/messages/leads requiring response.
4. Quick booking, rescheduling, customer contact, and payment follow-up.

### Technician

The mobile home is schedule-first. The next job is the dominant card with:

- Start/stop clock.
- On My Way/ETA.
- Call and text customer.
- Directions.
- Notes and forms.
- Photos/video/attachments.
- Estimate/invoice/payment.
- Complete job and collect signature.

Secondary data stays collapsed until needed. Offline/sync state remains visible without blocking normal work.

## 8. Core screen corrections

### Sign-in and account creation

- Account panel always uses an explicit readable text/surface theme.
- “Sign in / התחברות” and “Create a free workspace / פתיחת סביבת עבודה בחינם” become full, 14 px secondary actions with AA contrast and a 44 px target.
- Legal and security text increases to at least 12 px and uses readable muted text.
- Password requirement chips increase to 12 px with AA contrast.
- Language buttons become 44 px targets.
- Terms and Privacy are real links; consent records the policy version and acceptance time.

### Dashboard

- Needs Attention and Today rail appear before setup.
- Setup becomes a compact, resumable launcher.
- Empty analytics collapse into one optional summary.
- The page avoids long runs of zero-value cards.
- Revenue and pipeline use consistent scale and labels.

### Schedule and dispatch

- Day, week, month, timeline, and timeline-week views use one control pattern.
- Job cards expose time, status, customer, service, location, and assignee in a predictable order.
- Assignment shows technician/crew availability before confirmation.
- Conflicts are previewed before saving.
- Drag actions have keyboard alternatives and undo.

### Public booking

- Minimum 14 px service and field text; 12 px supporting information.
- Language controls meet touch-size and contrast requirements.
- Service, address, availability, details, and review steps keep consistent spacing and progress language.
- The mobile booking card never compresses Hebrew labels or helper text.

### Estimate, invoice, signing, and payment

- Every customer-facing string is localized, including titles, dates, totals, terms, status, errors, buttons, and footer.
- The signing block has a visible section heading, readable labels, localized placeholder, clear drawing instructions, and a high-contrast primary approval button.
- Customer payment follows signing in one continuous visual sequence.
- Print/PDF layout preserves bilingual direction and readable text.

### Settings and control centers

- Settings use a consistent section title, explanation, field label, helper, and save action hierarchy.
- Advanced controls are grouped under disclosure panels instead of rendered as dense miniature text.
- Booking Settings, Finance, Admin, Privacy, Calls, and Payments receive the first complete typography conversion because their current minimum text is 7.5–10 px.

## 9. Components

The redesign consolidates UI into shared components instead of adding more inline styles:

- `PageHeader`
- `RoleTodayRail`
- `AttentionList`
- `StatCard`
- `SectionCard`
- `FormField`
- `FieldHelp`
- `PrimaryButton`, `SecondaryButton`, `DangerButton`
- `StatusBadge`
- `EmptyState`
- `InlineNotice`
- `Dialog`
- `Menu`
- `SegmentedControl`
- `DataList` and responsive `DataTable`
- `LanguageSwitch`

Each component defines light/dark colors, LTR/RTL behavior, focus, disabled/loading/error states, minimum touch size, and reduced-motion behavior.

## 10. Motion

- Page entry: 180–240 ms opacity/translate, used once per navigation.
- Menus/dialogs: 140–180 ms scale/opacity.
- Timeline updates: one purposeful pulse on the changed item.
- Drag/assignment: immediate position feedback and a short confirmation transition.
- Avoid decorative animation across every card.
- Reduced-motion mode removes translation, scaling, shimmer, and looping animation.

## 11. Bilingual and RTL rules

- Navigation order, arrows, progress direction, table alignment, and inline actions use logical CSS properties.
- Phone numbers, email addresses, currency, document numbers, and IDs preserve correct LTR isolation inside Hebrew layouts.
- English uppercase eyebrows are replaced with natural Hebrew labels; Hebrew is not forced into uppercase-like letter spacing.
- Copy must be authored screen by screen with product-context review.
- The shared translation system covers employee screens, public documents, booking, portal, email/SMS, receipts, PDFs, provider errors, and validation.

## 12. Accessibility requirements

- WCAG 2.1 AA contrast: 4.5:1 normal text, 3:1 large text and UI boundaries.
- Every input has a programmatic label and clear error association.
- Heading levels follow a logical hierarchy.
- Menus, tabs, dialogs, disclosures, and drag alternatives expose correct name, role, and state.
- Focus is visible and never trapped or lost.
- Dialogs move focus inside, close on Escape, restore focus, and prevent background interaction.
- Controls meet the 44 × 44 px target.
- Layout remains usable at 200% browser zoom.
- Manual VoiceOver checks cover sign-in, booking, navigation, dispatch, job, estimate/signing, payment, and settings.

## 13. Implementation sequence

1. Add semantic typography, color, spacing, control, and surface tokens.
2. Fix account pages and theme isolation.
3. Replace public document/signing/payment inline styles with shared bilingual components.
4. Repair navigation, quick create, dialog/menu behavior, and mobile action placement.
5. Reorder and simplify owner/office/technician dashboards.
6. Convert Booking Settings, Calls, Finance, Admin, Privacy, Payments, and Schedule.
7. Convert remaining legacy screens and remove font sizes below the approved floor.
8. Complete bilingual strings and RTL layout checks.
9. Add visual, accessibility, keyboard, mobile, role, and feature-preservation regression tests.
10. Produce desktop/mobile English/Hebrew visual previews before publication.

## 14. Verification and release contract

The UX/UI release is accepted only when:

- All feature-preservation tests pass and the route manifest is unchanged or intentionally expanded.
- No meaningful visible text is below 12 px.
- Normal operational text is 14 px or larger.
- Automated contrast scans have no confirmed AA failures on key screens.
- English and Hebrew screenshots exist for desktop and mobile key workflows.
- Light, dark, and system themes pass the same screen matrix.
- Keyboard-only and VoiceOver acceptance paths pass.
- TypeScript, lint, automated tests, and production build pass.
- No browser-console or hydration errors occur during the route crawl.
- The live release is not published until the visual prototype is reviewed.

## 15. Scope boundaries

This design does not activate Helcim production processing or begin native iOS signing/TestFlight/App Store work. Those remain paused. Security blockers identified in the July 29 audit remain required release work and are not waived by this visual redesign.
