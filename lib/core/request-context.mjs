// Request context: who was at the other end of the connection.
//
// THE OMISSION THIS CLOSES: `grep -rn "x-forwarded-for" app lib` returned ONE
// hit before this file existed — a rate-limiter comment. Nothing in the product
// recorded a caller's IP address or user agent anywhere, which meant:
//
//   * an approved estimate carried a typed name and a PNG and nothing else, so
//     the e-signature had no evidence of WHO signed it or FROM WHERE;
//   * a compromised staff account left no trail to follow;
//   * a leaked portal link could not be investigated at all.
//
// It is deliberately NOT captured everywhere. An IP address is personal data in
// the EU and most US state privacy laws, so it is recorded only where it is
// evidence — signatures, authentication, permission changes — and never as a
// by-product of ordinary browsing.
//
// Tests: tests/request-context.test.mjs

/**
 * Headers a client can never forge because the platform edge overwrites them.
 * Ordered by preference. `x-forwarded-for` is LAST on purpose: any client can
 * send it, and on a misconfigured deployment it is attacker-controlled.
 */
export const TRUSTED_IP_HEADERS = ["x-vercel-forwarded-for", "cf-connecting-ip", "true-client-ip"];
export const UNTRUSTED_IP_HEADERS = ["x-forwarded-for", "x-real-ip"];

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/** Strict IPv4 check — rejects `999.1.1.1` and `01.2.3.4`, which Postgres `inet` also rejects. */
export function isIpv4(value) {
  const match = IPV4.exec(String(value ?? ""));
  if (!match) return false;
  return match.slice(1).every((part) => part === String(Number(part)) && Number(part) <= 255);
}

/** IPv6 check covering compressed forms and the IPv4-mapped tail. */
export function isIpv6(value) {
  const raw = String(value ?? "");
  if (!raw.includes(":") || /[^0-9a-fA-F:.]/.test(raw)) return false;
  if ((raw.match(/::/g) ?? []).length > 1) return false;

  const [head, tail = null, ...extra] = raw.split("::");
  if (extra.length) return false;

  const parts = (segment) => (segment === "" ? [] : segment.split(":"));
  const left = parts(head);
  const right = tail === null ? [] : parts(tail);
  const all = [...left, ...right];
  if (all.some((group) => group === "")) return false;

  let groups = all.length;
  // A trailing dotted-quad occupies two groups.
  const last = all[all.length - 1];
  if (last !== undefined && last.includes(".")) {
    if (!isIpv4(last)) return false;
    groups += 1;
  }
  if (all.slice(0, -1).some((group) => group.includes("."))) return false;
  if (all.some((group) => !group.includes(".") && !/^[0-9a-fA-F]{1,4}$/.test(group))) return false;

  return tail === null ? groups === 8 : groups < 8;
}

/** Whether a string is an IP literal Postgres `inet` would accept. */
export function isIpAddress(value) {
  return isIpv4(value) || isIpv6(value);
}

/** Loopback and RFC1918/ULA space — useful context, never a security decision. */
export function isPrivateIp(value) {
  const ip = String(value ?? "").toLowerCase();
  if (ip === "::1" || ip === "127.0.0.1") return true;
  if (isIpv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 10 ||
      a === 127 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254)
    );
  }
  return /^f[cd][0-9a-f]{2}:/.test(ip) || /^fe80:/.test(ip);
}

function headerValue(headers, name) {
  if (!headers) return "";
  const raw = typeof headers.get === "function" ? headers.get(name) : headers[name];
  return raw == null ? "" : String(raw);
}

/**
 * The caller's IP address, with its provenance.
 *
 * `trusted` is the honest part: it is true ONLY when the value came from a
 * header the hosting edge sets and overwrites. A value taken from
 * `x-forwarded-for` on an unknown deployment is recorded (it is still the best
 * information available) but flagged, so nobody later mistakes it for proof.
 *
 * @returns {{ ip: string|null, source: string|null, trusted: boolean }}
 */
export function clientIp(headers) {
  for (const name of TRUSTED_IP_HEADERS) {
    const candidate = headerValue(headers, name).split(",")[0].trim();
    if (isIpAddress(candidate)) return { ip: candidate, source: name, trusted: true };
  }
  for (const name of UNTRUSTED_IP_HEADERS) {
    // Leftmost entry is the original client; everything after it is a hop.
    const candidate = headerValue(headers, name).split(",")[0].trim();
    if (isIpAddress(candidate)) return { ip: candidate, source: name, trusted: false };
  }
  return { ip: null, source: null, trusted: false };
}

export const MAX_USER_AGENT = 400;

// Control characters (C0 + DEL). Written as an escaped pattern so the source
// file itself stays plain ASCII.
const CONTROL_CHARS = new RegExp("[\u0000-\u001f\u007f]", "g");

/** User-agent string, bounded and stripped of control characters. */
export function normalizeUserAgent(value) {
  const cleaned = String(value ?? "")
    .replace(CONTROL_CHARS, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return null;
  return cleaned.length > MAX_USER_AGENT ? cleaned.slice(0, MAX_USER_AGENT) : cleaned;
}

/**
 * A short human label for a device list: "Chrome on Windows".
 *
 * Deliberately coarse. The point is for an owner to recognise their own phone
 * in a session list, not to fingerprint anyone.
 */
export function deviceLabel(userAgent) {
  const ua = String(userAgent ?? "");
  if (!ua.trim()) return "Unknown device";

  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\/|Opera/.test(ua)
      ? "Opera"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Chrome\/|CriOS/.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : "Browser";

  const platform = /iPhone|iPod/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Windows/.test(ua)
          ? "Windows"
          : /Mac OS X|Macintosh/.test(ua)
            ? "Mac"
            : /CrOS/.test(ua)
              ? "ChromeOS"
              : /Linux/.test(ua)
                ? "Linux"
                : null;

  return platform ? `${browser} on ${platform}` : browser;
}

/**
 * Stable, non-reversible device key for "have we seen this sign-in before?".
 *
 * A raw IP is a poor device key (mobile networks rotate it constantly) and
 * storing more identifying material than needed is exactly the surveillance
 * this module refuses to do. The key is the coarse device label plus the
 * network prefix — /24 for IPv4, /48 for IPv6 — which changes when someone
 * genuinely moves network, and not when their phone changes cell.
 */
export function networkPrefix(ip) {
  if (isIpv4(ip)) return String(ip).split(".").slice(0, 3).join(".") + ".0/24";
  if (isIpv6(ip)) {
    const expanded = String(ip).toLowerCase();
    const groups = expanded.split("::")[0].split(":").filter(Boolean).slice(0, 3);
    while (groups.length < 3) groups.push("0");
    return `${groups.join(":")}::/48`;
  }
  return null;
}

/** Device signature used to decide whether a sign-in is from somewhere new. */
export function deviceSignature({ ip, userAgent }) {
  return `${deviceLabel(userAgent)}|${networkPrefix(ip) ?? "unknown-network"}`;
}

/**
 * Everything the server knows about the caller, in one shape.
 * Used for signature evidence, login records and permission changes.
 */
export function requestContextFrom(headers) {
  const { ip, source, trusted } = clientIp(headers);
  const userAgent = normalizeUserAgent(headerValue(headers, "user-agent"));
  return {
    ip,
    ipSource: source,
    ipTrusted: trusted,
    userAgent,
    device: deviceLabel(userAgent),
    signature: deviceSignature({ ip, userAgent }),
  };
}
