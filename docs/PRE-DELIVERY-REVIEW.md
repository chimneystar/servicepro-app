# Pre-delivery review plan

**Runs:** once, when the remediation ledger is exhausted, immediately before the
branch is handed over.
**Purpose:** find what is still wrong, with reviewers who have no stake in the
answer.

---

## The problem this plan is designed around

I wrote nearly all of this code. I am the worst available reviewer of it, and
"I will review it carefully" is not a control — it is an intention.

Three things that actually happened during this remediation set the bar:

1. **Every safety net inspected was decorative until tested.** A booking test
   that had never once executed. RLS assertions matching a format string, so
   they passed for every table including unprotected ones. An i18n parity check
   comparing two empty strings on a CRLF checkout.
2. **My own detectors were wrong three times** — one fired on a comment
   describing a bug, one counted a function declaration as a call site, one
   flagged five correctly-guarded pages as unguarded.
3. **A sub-agent found a real privilege defect in my own migration** that every
   static check I had written missed: `023` dropped policy names that never
   existed, so a permissive policy survived, was OR'd with my narrower one, and
   the fix changed nothing.

So the review must assume the author is confidently wrong, the tests are
decorative until proven otherwise, and the reviewer is biased unless prevented.

---

## Gate 0 — mechanical preconditions

The review does not start until all of these are true. No exceptions, no
"mostly".

| Precondition | Why it gates |
|---|---|
| `npm run verify` green (typecheck, lint, tests) | Baseline |
| `npm run build` green | It must ship |
| **`.github/workflows/db.yml` has RUN and passed at least once** | Until it does, every security claim in this repo is static analysis of SQL text. This is the single most important gate |
| `016_isolation_tests.sql` passes inside that job | Tenant isolation proven, not asserted |
| Every ledger row is `DONE` or `REJECTED`/`PARTIAL` **with a written reason** | No silent skips |
| `docs/FEATURE-INVENTORY.md` reconciled against the code | The preservation contract must be current |
| No `TODO`, `FIXME` or commented-out code introduced by this branch | |

**If the Postgres job has never run green, the review is cancelled and that is
fixed first.** Reviewing unproven security work wastes the reviewers.

---

## Bias controls

These are the difference between a review and a rubber stamp.

1. **Reviewers did not write the code.** Fresh agents, no shared context with
   the implementation work.
2. **First pass is blind to my rationale.** Reviewers get the *diff and the
   code*, and are explicitly told NOT to read commit messages, the remediation
   plan, or the audit for the first pass. Those documents are persuasive and
   argue for the change. A reviewer who reads my reasoning first inherits it.
   They may read them afterwards, only to check whether the claims match.
3. **Prompted to break, not to bless.** "Find where this fails" produces
   different results from "review this".
4. **Distinct lenses, not N identical skeptics.** Redundancy finds the same
   thing repeatedly; diversity finds different things.
5. **An empty finding list is an acceptable answer.** A reviewer required to
   find something will invent something, and inventions crowd out real findings.
6. **I do not judge validity.** Findings are verified by a *separate* adversarial
   pass whose default is refutation. I only fix what survives.
7. **A planted defect proves the review can fail** — see below.

### The canary

Before the review runs, a **known defect is deliberately planted** in the branch
by a separate agent, recorded in a sealed note I do not read.

If the review does not find it, **the review failed and its clean verdict means
nothing** — exactly as a guard that never fires on a planted bad case is
worthless. The canary is removed before delivery regardless of outcome.

The planted defect must be realistic and in the class that matters — for example
a policy that looks tightened but is OR'd with a surviving permissive one, or a
balance calculation that omits refunds. Not a syntax error.

---

## Wave 0 — can the guards themselves fail?

**Added because this is now the most-evidenced failure mode in this codebase, by
a wide margin.** The canary above asks whether the *review* can fail. This asks
whether the *shipped guards* can — and on the evidence, that question is not
rhetorical:

| what was found | how it presented |
|---|---|
| `tests/booking.test.mjs` imported a `.ts` file under `node --test` | had never executed once |
| RLS assertions matched a `%I` format string | true for every table, so vacuous |
| i18n parity compared two strings that were both empty on CRLF | passed on any input |
| scheduling transition rules | correct, tested, invoked by nothing |
| migration 023's `drop policy` named policies that did not exist | silent no-op; the original policies survived and were OR'd |
| `tests/reporting.test.mjs` passed only settled payments | replacing the collected-money helper with a naive sum stayed green |
| the 85 adversarial assertions in `db/ci/` | written, never executed |
| `sequence_gap` in the migration classifier | correct, unit-tested, and not called by the path that runs on every commit |
| `db/030_refunds.sql` | valid SQL, unit-tested, trigger-guarded, reviewed — and impossible to apply |

Every one of these was **green** before it was found. None would have been caught
by reading the code, because in each case the code was reasonable and the test
existed. They were found by *running the thing* or by *planting a defect*.

So, before Wave 1:

1. **For every probe this work added that guards a blocker-class property**
   (money, tenancy, authorization, document integrity, migration ordering),
   plant a violation of the exact property it claims to protect and confirm it
   fires. Not a syntax error — a plausible regression.
2. **Confirm each guard is reachable on the path that actually runs.** A guard
   invoked only by a script nobody runs is decorative. The specific check: does
   `npm run verify` fail? Not "does the function return an error when called".
3. **Confirm each guard is silent on the good tree.** A false RED gets the guard
   switched off, which is strictly worse than never having written it — this is
   why the migration checksums normalize CRLF rather than compare raw bytes.
4. Any guard that cannot be made to fail is **reported as a finding**, not
   quietly fixed.

This wave is mechanical and cheap, and it has already caught two real holes
during implementation rather than review. Run it first: a clean Wave 1 over a
suite whose guards cannot fail means nothing at all.

---

## Wave 1 — independent review, parallel, distinct lenses

Seven reviewers, each with one lens, each explicitly told the empty answer is
acceptable.

| # | Lens | Charged with |
|---|---|---|
| 1 | **Money** | Every path that computes, stores or moves money. Deposits, refunds, rounding, idempotency, double-charge windows, revenue and commission. Assume every figure on screen is wrong until traced to its source |
| 2 | **Authorization, adversarial** | Attacker is an authenticated `tech` who skips the UI and calls `/rest/v1/` with the anon key. Every policy, every server action, every RPC. Includes: does each migration's `drop policy` name something that exists |
| 3 | **The tests themselves** | Assume every test is decorative. For each: would it fail if the code were wrong? Delete-the-implementation and confirm it goes red. Report the ratio of behavioural to structural assertions |
| 4 | **Data integrity** | Can the database reach a state the app cannot explain? Orphans, races, partial writes, migration re-run behaviour, what a half-applied migration leaves behind |
| 5 | **Scope preservation** | `docs/FEATURE-INVENTORY.md` as a contract. Anything that worked before and does not now, or any row whose status is more optimistic than the code |
| 6 | **Operational reality** | Boot with each required variable missing in turn. Follow `docs/RUNBOOK.md` and `db/MIGRATIONS.md` literally on a fresh database and report where they are wrong. Trigger the cron with and without its secret |
| 7 | **The customer's experience** | Drive the real flows. What does a user SEE when a write fails, a payment declines, a sync is rejected? Find every silent failure and every message that lies |

Each returns: finding, file:line, concrete failure scenario (inputs → wrong
output), severity, and a one-line fix. No essays.

---

## Wave 2 — adversarial verification of every finding

Each Wave 1 finding is handed to **three** fresh reviewers who have not seen it
before, prompted to **refute** it, defaulting to refuted when uncertain.

A finding survives on a majority. Where a finding could fail in more than one
way, the three get different lenses (correctness / security / does-it-actually-
reproduce) rather than being three identical skeptics.

This exists because plausible-but-wrong findings are expensive: they cost real
fixes, and a fix to a non-bug can introduce a real one.

---

## Wave 3 — completeness critic

One reviewer, asked the question the others were not: **what was not looked at?**

- Which files did no reviewer open?
- Which claims in the audit, the plan or the runbooks were never re-checked
  against the code?
- Which capabilities in the inventory were never exercised?
- What did the canary's discovery (or non-discovery) reveal about the blind
  spots?

Its output is the next round of work, not a summary.

---

## Then, and only then

1. **Triage.** Confirmed findings ranked by what they cost the business, not by
   how interesting they are.
2. **Fix**, each with a probe proven both ways — fires on the defect, silent on
   the fix.
3. **Re-review the fixes only**, by reviewers who did not write them. A fix is a
   change, and changes are where defects come from.
4. **Re-run Gate 0 in full.** Including the Postgres job.
5. **Remove the canary** and confirm it is gone — `git log -p` for the planted
   change, not just an assurance.

---

## What I hand over

- The branch, and a PR description stating what changed and why.
- **The findings that were NOT fixed**, with the reason each was left. A review
  whose output is "all clear" is less trustworthy than one that says what it
  chose to live with.
- The review's own limitations, explicitly: what was never executed, what has no
  test, what is proven only by static analysis.
- Whether the canary was caught.

**The verdict I will not give:** "it is ready." I can say what was checked, what
was proven, what was fixed, and what is still open. Whether that is good enough
to put in front of a real company's customers is the owner's call, and it should
be made on evidence rather than on my confidence.

---

## Cost

Roughly 25-30 agents across three waves, plus fix and re-review cycles. Run once,
at the end, not incrementally — a review of a moving branch reviews nothing.

This is expensive on purpose. It is cheaper than the first time a customer is
billed twice.
