import "server-only";
import { headers } from "next/headers";
// @ts-ignore -- pure logic, proven both ways in tests/request-context.test.mjs
import { requestContextFrom, networkPrefix } from "@/lib/core/request-context.mjs";

/**
 * The server's view of who is calling.
 *
 * BEFORE THIS FILE, nothing in the product had one. A signature carried a name
 * and a PNG; a sign-in carried nothing at all. The rule for using it is in the
 * header of lib/core/request-context.mjs and is worth repeating here: capture
 * it where it is EVIDENCE (signatures, authentication, permission changes) and
 * nowhere else. It is not a page-view log.
 */
export type RequestContext = {
  ip: string | null;
  ipSource: string | null;
  ipTrusted: boolean;
  userAgent: string | null;
  device: string;
  signature: string;
  network: string | null;
};

export async function getRequestContext(): Promise<RequestContext> {
  const headerList = await headers();
  const context = requestContextFrom(headerList) as Omit<RequestContext, "network">;
  return { ...context, network: (networkPrefix(context.ip) as string | null) ?? null };
}

/** Argument shape shared by the security RPCs in db/038_account_security.sql. */
export function contextRpcArgs(context: RequestContext) {
  return {
    p_ip: context.ip,
    p_ip_source: context.ipSource,
    p_ip_trusted: context.ipTrusted,
    p_user_agent: context.userAgent,
    p_device: context.device,
  };
}

/** Columns shared by account_security_events inserts. */
export function contextColumns(context: RequestContext) {
  return {
    ip: context.ip,
    ip_source: context.ipSource,
    ip_trusted: context.ipTrusted,
    user_agent: context.userAgent,
    device_label: context.device,
    device_signature: context.signature,
  };
}
