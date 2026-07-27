import type { IntegrationConnection, IntegrationProvider, IntegrationStatus } from "./types";

type SupabaseLike = any;

export async function getConnection(client: SupabaseLike, organizationId: string, provider: IntegrationProvider): Promise<IntegrationConnection | null> {
  const { data, error } = await client
    .from("integration_connections")
    .select("id, organization_id, provider, status, external_account_id, encrypted_credentials, metadata, error_message, connected_at, last_synced_at")
    .eq("organization_id", organizationId)
    .eq("provider", provider)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as IntegrationConnection | null) ?? null;
}

export async function saveConnection(client: SupabaseLike, input: {
  organizationId: string;
  provider: IntegrationProvider;
  status: IntegrationStatus;
  externalAccountId?: string | null;
  encryptedCredentials?: string | null;
  metadata?: Record<string, unknown>;
  errorMessage?: string | null;
  connectedBy?: string | null;
}): Promise<IntegrationConnection> {
  const now = new Date().toISOString();
  const { data, error } = await client.from("integration_connections").upsert({
    organization_id: input.organizationId,
    provider: input.provider,
    status: input.status,
    external_account_id: input.externalAccountId ?? null,
    encrypted_credentials: input.encryptedCredentials ?? null,
    metadata: input.metadata ?? {},
    error_message: input.errorMessage ?? null,
    connected_by: input.connectedBy ?? null,
    connected_at: input.status === "connected" ? now : null,
    updated_at: now,
  }, { onConflict: "organization_id,provider" }).select().single();
  if (error) throw new Error(error.message);
  return data as IntegrationConnection;
}

export async function disconnectConnection(client: SupabaseLike, organizationId: string, provider: IntegrationProvider) {
  const { error } = await client.from("integration_connections").upsert({
    organization_id: organizationId,
    provider,
    status: "not_connected",
    external_account_id: null,
    encrypted_credentials: null,
    metadata: {},
    error_message: null,
    connected_by: null,
    connected_at: null,
    updated_at: new Date().toISOString(),
  }, { onConflict: "organization_id,provider" });
  if (error) throw new Error(error.message);
}

export function missingPlatformConfig(provider: IntegrationProvider): string[] {
  const requirements: Record<IntegrationProvider, string[]> = {
    gmail: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_PUBSUB_TOPIC", "GOOGLE_PUBSUB_VERIFICATION_TOKEN", "INTEGRATION_ENCRYPTION_KEY"],
    twilio: ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "INTEGRATION_ENCRYPTION_KEY"],
    stripe: ["STRIPE_SECRET_KEY", "STRIPE_CONNECT_WEBHOOK_SECRET"],
  };
  return requirements[provider].filter((name) => !process.env[name]);
}
