export type OfflineJobAction = {
  clientEventId: string;
  jobId: string;
  action: "start" | "complete";
  createdAt: string;
};
const KEY = "servicepro:tech-outbox";

/** Queued events older than this are abandoned — see flushJobOutbox. */
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

export function readOutbox(): OfflineJobAction[] {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

export function queueJobAction(jobId: string, action: OfflineJobAction["action"]) {
  const rows = readOutbox();
  if (!rows.some((row) => row.jobId === jobId && row.action === action)) {
    rows.push({
      clientEventId: crypto.randomUUID(),
      jobId,
      action,
      createdAt: new Date().toISOString(),
    });
  }
  localStorage.setItem(KEY, JSON.stringify(rows));
  return rows.length;
}

/**
 * Send queued actions and clear the ones that are settled.
 *
 * The queue previously removed only ids the server ACKNOWLEDGED, so an event the
 * server would never accept — a job reassigned to someone else while the device
 * was offline, say — stayed for ever and was re-sent on every reconnect. The
 * technician saw a permanent "N updates waiting to sync" badge with no way to
 * clear it.
 *
 * Three outcomes are now distinguished:
 *   processed — stored; drop it.
 *   rejected  — will never succeed; drop it too, and report the count so the UI
 *               can say so rather than silently discarding the technician's work.
 *   neither   — transient; keep and retry.
 *
 * Anything older than MAX_AGE_MS is abandoned regardless, so a device offline for
 * a fortnight cannot accumulate an unbounded backlog.
 */
export async function flushJobOutbox(): Promise<{
  sent: number;
  pending: number;
  rejected: number;
  expired: number;
}> {
  const rows = readOutbox();
  if (!rows.length || !navigator.onLine)
    return { sent: 0, pending: rows.length, rejected: 0, expired: 0 };

  const cutoff = Date.now() - MAX_AGE_MS;
  const fresh = rows.filter((row) => {
    const at = Date.parse(row.createdAt);
    return !Number.isFinite(at) || at >= cutoff;
  });
  const expired = rows.length - fresh.length;

  if (!fresh.length) {
    localStorage.setItem(KEY, "[]");
    return { sent: 0, pending: 0, rejected: 0, expired };
  }

  let response: Response;
  try {
    response = await fetch("/api/sync/job-status", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ events: fresh }),
    });
  } catch {
    // Connection dropped mid-flight: keep everything and retry later.
    localStorage.setItem(KEY, JSON.stringify(fresh));
    return { sent: 0, pending: fresh.length, rejected: 0, expired };
  }

  if (!response.ok) {
    localStorage.setItem(KEY, JSON.stringify(fresh));
    return { sent: 0, pending: fresh.length, rejected: 0, expired };
  }

  const result = (await response.json()) as { processed?: string[]; rejected?: string[] };
  const done = new Set(result.processed ?? []);
  const refused = new Set(result.rejected ?? []);

  const pending = fresh.filter(
    (row) => !done.has(row.clientEventId) && !refused.has(row.clientEventId),
  );
  localStorage.setItem(KEY, JSON.stringify(pending));

  return {
    sent: fresh.filter((row) => done.has(row.clientEventId)).length,
    pending: pending.length,
    rejected: fresh.filter((row) => refused.has(row.clientEventId)).length,
    expired,
  };
}
