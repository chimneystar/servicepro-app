import Link from "next/link";
import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { missingPlatformConfig } from "@/lib/integrations/connections";
import type { IntegrationProvider, IntegrationStatus } from "@/lib/integrations/types";
import { disconnectIntegration, provisionTextMessaging, refreshStripeConnection, startStripeOnboarding } from "./actions";

export const dynamic = "force-dynamic";

const labels: Record<IntegrationStatus, string> = {
  not_connected: "Not connected",
  action_required: "Action required",
  pending: "Pending review",
  connected: "Connected",
  error: "Error",
};

const colors: Record<IntegrationStatus, { bg: string; fg: string }> = {
  not_connected: { bg: "#f1f5f9", fg: "#475569" },
  action_required: { bg: "#fff7ed", fg: "#9a3412" },
  pending: { bg: "#eff6ff", fg: "#1d4ed8" },
  connected: { bg: "#e6f6ec", fg: "#15803d" },
  error: { bg: "#fdeaea", fg: "#dc2626" },
};

export default async function IntegrationsPage() {
  const profile = await requireProfile();
  if (profile.role !== "owner") redirect("/");
  const client = createClient();
  const [{ data: organization }, { data: rows }] = await Promise.all([
    client.from("organizations").select("name, city").eq("id", profile.organization_id!).single(),
    client.from("integration_connections").select("provider, status, external_account_id, metadata, error_message, connected_at, last_synced_at").eq("organization_id", profile.organization_id!),
  ]);
  const connections = new Map((rows ?? []).map((row: any) => [row.provider as IntegrationProvider, row]));
  const gmail = status(connections.get("gmail"));
  const twilio = status(connections.get("twilio"));
  const stripe = status(connections.get("stripe"));

  return (
    <div style={{ maxWidth: 780 }}>
      <Link href="/settings" style={{ color: "#2563eb", fontWeight: 700, fontSize: 14, textDecoration: "none" }}>‹ Settings</Link>
      <h1 style={{ fontSize: 24, fontWeight: 800, margin: "8px 0 4px" }}>Integrations</h1>
      <p style={{ color: "#5c6675", fontSize: 13, marginBottom: 18 }}>
        Customer messages and payments will show <b>{organization?.name ?? "your saved business name"}</b>. Each business connects its own mailbox, phone number, and payout account.
      </p>

      <IntegrationCard icon="✉️" title="Gmail" description="Send email from your Gmail address and sync customer replies into ServicePro." state={gmail} provider="gmail" missing={missingPlatformConfig("gmail")}>
        {gmail.value === "not_connected" && missingPlatformConfig("gmail").length === 0 && <a href="/api/integrations/gmail/connect" style={primary}>Connect Gmail</a>}
        {gmail.value === "connected" && <div style={detail}>Connected mailbox: {String(gmail.row?.metadata?.email ?? "Gmail")}</div>}
      </IntegrationCard>

      <IntegrationCard icon="💬" title="Text messaging" description="Provision a local Twilio number for two-way customer texting." state={twilio} provider="twilio" missing={missingPlatformConfig("twilio")}>
        {twilio.value === "not_connected" && missingPlatformConfig("twilio").length === 0 && (
          <form action={provisionTextMessaging} style={{ display: "flex", gap: 8, alignItems: "end", flexWrap: "wrap" }}>
            <label style={{ fontSize: 12.5, fontWeight: 700 }}>Preferred area code
              <input name="area_code" inputMode="numeric" pattern="[0-9]{3}" maxLength={3} defaultValue={organization?.city?.toLowerCase().includes("austin") ? "512" : ""} required style={input} placeholder="512" />
            </label>
            <button style={primary}>Get local number</button>
          </form>
        )}
        {twilio.row?.metadata?.phone_number && <div style={detail}>ServicePro number: {String(twilio.row.metadata.phone_number)}</div>}
        {twilio.row?.metadata?.a2p_status === "registration_required" && <div style={warning}>The number is reserved. A2P 10DLC registration is still required before regular US customer traffic.</div>}
      </IntegrationCard>

      <IntegrationCard icon="💳" title="Stripe payments" description="Accept real USD invoice payments into this business's own Stripe payout account." state={stripe} provider="stripe" missing={missingPlatformConfig("stripe")}>
        {missingPlatformConfig("stripe").filter((item) => item === "STRIPE_SECRET_KEY").length === 0 && stripe.value !== "connected" && <form action={startStripeOnboarding}><button style={primary}>{stripe.row?.external_account_id ? "Continue Stripe setup" : "Connect Stripe"}</button></form>}
        {stripe.row?.external_account_id && <form action={refreshStripeConnection} style={{ marginTop: 8 }}><button style={secondary}>Refresh Stripe status</button></form>}
        {stripe.value === "connected" && <div style={detail}>Card payments and payouts are enabled.</div>}
      </IntegrationCard>

      <div style={{ background: "#eff6ff", color: "#1e3a8a", border: "1px solid #bfdbfe", borderRadius: 14, padding: 14, fontSize: 12.5, lineHeight: 1.5 }}>
        Sensitive EIN, bank, card, OAuth, and provider credentials are handled by the provider or encrypted on the server. Never paste those values into ServicePro messages or support chat.
      </div>
    </div>
  );
}

function status(row: any) {
  const value = (row?.status ?? "not_connected") as IntegrationStatus;
  return { value, row };
}

function IntegrationCard({ icon, title, description, state, provider, missing, children }: {
  icon: string; title: string; description: string; state: ReturnType<typeof status>; provider: IntegrationProvider; missing: string[]; children: React.ReactNode;
}) {
  const color = colors[state.value];
  return (
    <section style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 16, padding: 18, marginBottom: 14, boxShadow: "0 6px 18px rgba(15,42,94,.06)" }}>
      <div style={{ display: "flex", gap: 12, alignItems: "start" }}>
        <div style={{ fontSize: 24 }}>{icon}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <h2 style={{ fontSize: 16, fontWeight: 800, margin: 0 }}>{title}</h2>
            <span style={{ background: color.bg, color: color.fg, borderRadius: 999, padding: "4px 10px", fontSize: 11.5, fontWeight: 800 }}>{labels[state.value]}</span>
          </div>
          <p style={{ color: "#5c6675", fontSize: 13, margin: "5px 0 12px" }}>{description}</p>
          {missing.length > 0 && <div style={warning}>Platform setup required: {missing.join(", ")}</div>}
          {state.row?.error_message && <div style={warning}>{state.row.error_message}</div>}
          {children}
          {state.value !== "not_connected" && (
            <form action={disconnectIntegration} style={{ marginTop: 12 }}>
              <input type="hidden" name="provider" value={provider} />
              <button style={danger}>Disconnect</button>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}

const primary: React.CSSProperties = { display: "inline-block", background: "#2563eb", color: "#fff", border: "none", borderRadius: 10, padding: "10px 14px", fontWeight: 750, fontSize: 13, textDecoration: "none", cursor: "pointer" };
const secondary: React.CSSProperties = { background: "#fff", color: "#2563eb", border: "1px solid #bfdbfe", borderRadius: 10, padding: "8px 12px", fontWeight: 700, fontSize: 12.5 };
const danger: React.CSSProperties = { background: "transparent", color: "#b91c1c", border: "none", padding: 0, fontWeight: 700, fontSize: 12.5 };
const input: React.CSSProperties = { display: "block", width: 120, marginTop: 5, border: "1px solid #e2e8f0", borderRadius: 10, padding: "9px 11px" };
const warning: React.CSSProperties = { background: "#fff7ed", border: "1px solid #fed7aa", color: "#9a3412", borderRadius: 10, padding: "9px 11px", fontSize: 12, marginBottom: 10 };
const detail: React.CSSProperties = { color: "#334155", fontSize: 12.5, marginBottom: 8 };
