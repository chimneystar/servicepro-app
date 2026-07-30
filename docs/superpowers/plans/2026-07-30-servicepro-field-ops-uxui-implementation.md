# ServicePro Field Ops — UX/UI implementation plan

## Goal

Apply the approved bilingual design system to the real ServicePro application without removing or publishing any feature.

## Work packages

1. **Foundation**
   - Add semantic type, surface, status, spacing, control, and focus tokens.
   - Raise all stylesheet text below the approved floor to the correct role.
   - Isolate public light surfaces from saved dark/system theme text colors.
   - Add feature-preservation assertions for the five navigation hubs.

2. **Account and public customer flows**
   - Repair sign-in, sign-up, recovery, reset, language controls, password help, consent, and account-switch links.
   - Rebuild sharing and signing with bilingual shared classes, dialog semantics, focus management, and readable controls.
   - Localize public estimate/invoice strings and preserve RTL/LTR data isolation.
   - Raise booking and portal typography and touch targets.

3. **Application shell**
   - Group existing navigation into Today, Schedule, Customers, Money, and More without removing routes.
   - Keep direct desktop access to frequent routes through expandable hub groups.
   - Make mobile tabs role-aware and prevent the create button from overlapping navigation.
   - Correct Quick Create menu semantics and keyboard behavior.

4. **Role workspaces and dense screens**
   - Reorder owner dashboard around attention and today.
   - Preserve office dispatch and technician schedule-first homes.
   - Convert Booking Settings, Calls, Finance, Admin, Privacy, Payments, Schedule, Dashboard, Warranties, Operations, Growth, and Migration to the shared type scale.

5. **Verification**
   - TypeScript, lint, all automated tests, production build.
   - Feature-manifest and route checks.
   - Live/local English and Hebrew route crawl.
   - Typography floor and contrast scan.
   - Desktop/mobile screenshots of account, dashboard, booking, signing, office, and technician experiences.
   - No deployment or push until the visual prototype is reviewed.

## Completion rules

- No meaningful visible text below 12 px.
- Operational text at least 14 px.
- All touch targets at least 44 px where practical and mandatory for primary interaction.
- No inaccessible menu/dialog behavior in corrected flows.
- No feature-manifest regression.
- English and Hebrew show equivalent hierarchy and legibility.
