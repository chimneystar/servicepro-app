import "server-only";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import type { TablesUpdate } from "@/lib/supabase/database.types";
import { isOneOf } from "@/lib/validation";
// @ts-ignore — pure logic, unit-tested in tests/scheduling.test.mjs
import { JOB_STATUSES, canTransition } from "@/lib/core/scheduling.mjs";

/**
 * The single guarded path for changing a job's status.
 *
 * THE GAP THIS CLOSES. `lib/core/scheduling.mjs` has defined and tested the
 * legal status transitions since early in the project — `done` and `cancelled`
 * are terminal, a job cannot be reopened — and NO APPLICATION CODE HAS EVER
 * CALLED IT. The rules existed, were correct, were covered by eleven passing
 * tests, and governed nothing.
 *
 * Meanwhile two server actions (`setJobStatus`, `updateJobStatus`) accepted an
 * arbitrary string, wrote it straight to the column, and checked only that the
 * caller was signed in. Both are unreferenced by any component — dead in the UI
 * but live network endpoints, callable by any authenticated user. A technician
 * could drive any job they could see to `done`, skipping signature capture and
 * clock-out, or reopen a completed job, or write a status no screen understands.
 *
 * Three things are enforced here:
 *   1. The target must be a known status — not any string.
 *   2. The transition must be legal for the CURRENT status.
 *   3. The caller must be allowed to touch this job.
 */
export type StatusChange = { ok: boolean; error?: string };

export async function changeJobStatus(jobId: string, target: string): Promise<StatusChange> {
  const profile = await requireProfile();

  // Same test as before — `JOB_STATUSES.includes(target)` — but as a type
  // guard, so `target` is a `job_status` value from here on rather than a
  // string the compiler has to take on trust all the way to the UPDATE.
  if (!isOneOf(JOB_STATUSES, target)) {
    return { ok: false, error: `"${target}" is not a job status.` };
  }

  const supabase = await createClient();

  // RLS scopes this to the caller's organisation; a job from another tenant
  // simply resolves to nothing.
  const { data: job } = await supabase
    .from("jobs")
    .select("id, status, assigned_to")
    .eq("id", jobId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!job) return { ok: false, error: "Job not found." };

  // Technicians may only move a job they are actually assigned to.
  if (profile.role === "tech" && job.assigned_to !== profile.id) {
    return { ok: false, error: "This job is not assigned to you." };
  }

  const current = String(job.status ?? "scheduled");
  if (current === target) return { ok: true };

  if (!canTransition(current, target)) {
    const terminal = current === "done" || current === "cancelled";
    return {
      ok: false,
      error: terminal
        ? `This job is already ${current} and cannot be changed. Create a new job instead.`
        : `A job cannot go from ${current} to ${target}.`,
    };
  }

  // `TablesUpdate<"jobs">` rather than `Record<string, unknown>`: the bag was
  // the reason nothing checked that `started_at` and `completed_at` are real
  // columns of `jobs`, or that `target` is a value `job_status` allows.
  const patch: TablesUpdate<"jobs"> = { status: target };
  if (target === "in_progress") patch.started_at = new Date().toISOString();
  if (target === "done") patch.completed_at = new Date().toISOString();

  const { error } = await supabase.from("jobs").update(patch).eq("id", jobId);
  if (error) return { ok: false, error: error.message };

  return { ok: true };
}
