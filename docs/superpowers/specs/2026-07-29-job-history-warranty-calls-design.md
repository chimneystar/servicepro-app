# ServicePro job history, warranty callbacks, and call tracking

Date: 2026-07-29  
Status: Approved for implementation by the product owner in the feature request

## Outcome

ServicePro will give office teams one reliable record of what happened on a job, make warranty return visits visible and measurable, and turn every phone call into an actionable customer interaction. The release remains bilingual in natural English and Hebrew and preserves every existing workflow.

## Product decisions

Three approaches were considered:

1. Add three separate tools with independent records. This is quick, but duplicates notes and makes staff hunt for context.
2. Put everything into the existing raw audit log. This preserves data, but the log is technical and cannot represent follow-ups, call outcomes, or linked callback visits clearly.
3. Use a unified job timeline backed by purpose-built action, warranty, and call records. This is the selected approach because each workflow remains structured while the job page tells one chronological story.

## Experience

### Job history and actions

The existing job page gains a History tab with a prominent quick-action composer. Office users can add an internal note, log a call, or schedule a follow-up. Technicians may add notes and complete assigned follow-ups on jobs they can access. The timeline combines:

- job creation and field changes from the protected audit log;
- manual notes and follow-up actions;
- inbound and outbound calls;
- warranty creation, callback scheduling, and resolution;
- actor, timestamp, status, and useful before/after context.

Raw database field names will not be the primary experience. Events use plain business language and bilingual labels.

### Warranty callbacks

Every job can have a warranty with coverage type, duration, start and expiry dates, and customer-visible terms. A callback records the reported issue, responsibility, priority, resolution, internal cost, and status. Creating a return visit produces a new linked job while preserving the original job and callback relationship. The Warranty Center highlights open, overdue, and expiring work.

### Call tracking

The Calls center works immediately for manual call logging and follow-up management. It includes inbound/outbound/missed filters, customer and job matching, call reasons, outcomes, notes, duration, lead source, tracked number, and a clear “needs follow-up” state. A tracking-number settings area stores the provider number, destination number, campaign/source, and recording preference.

Provider webhooks will accept signed Twilio-style voice status events when credentials are configured. Phone-number purchase/porting and live browser calling remain provider activation work, not a database prerequisite. Recording is off by default; enabling it requires an explicit notice setting because consent rules vary by location.

## Data and security

New organization-scoped tables:

- `job_actions`
- `job_warranties`
- `warranty_callbacks`
- `tracked_phone_numbers`
- `call_events`

All public tables use row-level security, explicit authenticated/service-role grants, and no anonymous access. Owner and office roles manage warranty and phone settings. Assigned technicians can read job-related records and create limited notes or outcomes only through server actions that verify job access. Cross-organization references are rejected by tenant-guard triggers.

Important mutations also write structured audit entries. Existing raw audit events remain immutable and readable by authorized office users.

## Error handling

- Missing or inaccessible jobs return a bilingual, actionable message.
- Server actions validate required fields and return stable bilingual error codes rather than leaking database/provider errors.
- Duplicate provider webhook events are idempotent.
- Unknown callers are retained as unassigned opportunities and can be linked later.
- Creating a callback job is atomic at the database level so a callback cannot claim a visit exists when job creation failed.

## Design direction

The established ServicePro navy, blue, and yellow system remains intact. The signature element is a “service pulse” timeline: blue operational events, yellow follow-ups, coral missed calls, and navy completed outcomes connected by one restrained vertical line. Motion is limited to tab transitions, status changes, and new-event confirmation, with reduced-motion support.

## Verification

The release requires:

- feature-preservation tests for new routes, schema tables, RLS, and bilingual copy;
- action validation tests for phone normalization and timeline event mapping;
- TypeScript and production build success;
- database verification queries for tables, policies, grants, triggers, and cross-tenant isolation;
- browser checks at desktop and mobile widths in English and Hebrew with zero console errors.

## Explicitly out of scope for this release

- Helcim production activation and credentials;
- native iOS signing, TestFlight, and App Store submission;
- purchasing or porting live phone numbers and full WebRTC/IVR call handling;
- automatic call transcription or AI call summaries.
