export type IntegrationProvider = "gmail" | "twilio" | "stripe";
export type IntegrationStatus = "not_connected" | "action_required" | "pending" | "connected" | "error";
export type CommunicationChannel = "sms" | "email";
export type CommunicationDirection = "inbound" | "outbound";
export type CommunicationStatus = "pending" | "queued" | "sent" | "delivered" | "received" | "failed" | "bounced";

export type IntegrationConnection = {
  id: string;
  organization_id: string;
  provider: IntegrationProvider;
  status: IntegrationStatus;
  external_account_id: string | null;
  encrypted_credentials: string | null;
  metadata: Record<string, unknown>;
  error_message: string | null;
  connected_at: string | null;
  last_synced_at: string | null;
};

export type NormalizedCommunication = {
  organizationId: string;
  customerId?: string | null;
  channel: CommunicationChannel;
  direction: CommunicationDirection;
  status: CommunicationStatus;
  contactKey: string;
  fromAddress?: string | null;
  toAddress?: string | null;
  subject?: string | null;
  body: string;
  provider: "gmail" | "twilio";
  providerMessageId?: string | null;
  providerThreadId?: string | null;
  businessEventKey?: string | null;
  metadata?: Record<string, unknown>;
  occurredAt?: string;
};
