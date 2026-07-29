export type MerchantConnectionStatus =
  | "not_started" | "application_started" | "under_review" | "action_required"
  | "approved" | "rejected" | "suspended";

export type PaymentSettings = {
  organization_id: string;
  card_enabled: boolean;
  ach_enabled: boolean;
  zelle_enabled: boolean;
  check_enabled: boolean;
  fee_saver_enabled: boolean;
  ach_hold_until_settled: boolean;
  save_methods_enabled: boolean;
  tips_enabled: boolean;
  suggested_tip_percents: number[];
  default_deposit_type: "none" | "percent" | "fixed";
  default_deposit_bps: number;
  default_deposit_minor: number;
  zelle_recipient_name: string | null;
  zelle_email: string | null;
  zelle_phone: string | null;
  zelle_qr_url: string | null;
  zelle_instructions: string | null;
  check_payee: string | null;
  check_address: string | null;
  check_city_state_zip: string | null;
  check_memo_instructions: string | null;
  receipt_email_enabled: boolean;
  receipt_sms_enabled: boolean;
};
export type PublicPaymentOptions = {
  available: boolean;
  reason?: string;
  kind?: "estimate_deposit" | "invoice";
  number?: number;
  signed?: boolean;
  amount_minor?: number;
  currency?: string;
  fee_saver?: boolean;
  methods?: { helcim: boolean; card: boolean; ach: boolean; zelle: boolean; check: boolean };
  zelle?: null | {
    recipient_name?: string | null; email?: string | null; phone?: string | null;
    qr_url?: string | null; instructions?: string | null; memo?: string;
  };
  check?: null | {
    payee?: string | null; address?: string | null; city_state_zip?: string | null;
    memo_instructions?: string | null; memo?: string;
  };
};
