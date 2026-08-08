/**
 * Next.js instrumentation hook — runs once when the server starts.
 *
 * Its job is to make configuration failures loud AT BOOT. Before this, every
 * secret was read lazily at the point of use, so a deploy with a missing
 * variable succeeded and failed later in front of a customer, unalerted.
 */
export async function register() {
  // Only the Node.js runtime has process.env fully populated; the edge runtime
  // gets a subset and would report false failures.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Skip during `next build`: the build machine legitimately has no runtime
  // secrets, and failing there would block deploys for the wrong reason.
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  const { assertEnv } = await import("@/lib/env");
  assertEnv();
}

/**
 * Called for every uncaught server-side error. Without this, a production
 * failure existed only in whatever the platform happened to capture — the app
 * itself had ZERO error reporting, and app/error.tsx logged only to the
 * customer's own browser console.
 */
export function onRequestError(
  error: unknown,
  request: { path?: string; method?: string },
  context: { routeType?: string },
) {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;

  // Structured, single-line JSON so a log aggregator can parse it. Deliberately
  // does not include request bodies, headers or query strings — those carry
  // customer data and payment tokens.
  console.error(
    JSON.stringify({
      level: "error",
      event: "server_error",
      method: request?.method,
      path: request?.path,
      routeType: context?.routeType,
      message,
      stack,
      at: new Date().toISOString(),
    }),
  );
}
