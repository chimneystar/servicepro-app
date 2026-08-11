// =====================================================================
//  GENERATED FILE - DO NOT EDIT.
//
//  The database as the migrations in db/ actually build it. Produced by
//  applying every migration to an empty PostgreSQL and reading the
//  catalogue: `npm run db:types`. `tests/db-types.test.mjs` fails when this
//  file and the migrations disagree.
//
//  migrations applied: 42
//  tables: 124   enums: 6   foreign keys: 324   functions: 38
//  columns narrowed to a union by a CHECK constraint: 99
//  NOT NULL columns a BEFORE INSERT trigger supplies: 5
// =====================================================================

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      account_security_events: {
        Row: {
          id: number;
          organization_id: string | null;
          profile_id: string | null;
          event_type: string;
          ip: string | null;
          ip_source: string | null;
          ip_trusted: boolean;
          user_agent: string | null;
          device_label: string | null;
          device_signature: string | null;
          details: Json | null;
          at: string;
        };
        Insert: {
          id?: number;
          organization_id?: string | null;
          profile_id?: string | null;
          event_type: string;
          ip?: string | null;
          ip_source?: string | null;
          ip_trusted?: boolean;
          user_agent?: string | null;
          device_label?: string | null;
          device_signature?: string | null;
          details?: Json | null;
          at?: string;
        };
        Update: {
          id?: number;
          organization_id?: string | null;
          profile_id?: string | null;
          event_type?: string;
          ip?: string | null;
          ip_source?: string | null;
          ip_trusted?: boolean;
          user_agent?: string | null;
          device_label?: string | null;
          device_signature?: string | null;
          details?: Json | null;
          at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "account_security_events_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "account_security_events_profile_id_fkey";
            columns: ["profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      accounting_export_rows: {
        Row: {
          id: string;
          organization_id: string;
          export_id: string | null;
          target: "quickbooks" | "xero";
          source_type: string;
          source_id: string;
          external_ref: string;
          amount_minor: number;
          exported_on: string;
          matched_minor: number | null;
          matched_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          export_id?: string | null;
          target: "quickbooks" | "xero";
          source_type: string;
          source_id: string;
          external_ref: string;
          amount_minor?: number;
          exported_on?: string;
          matched_minor?: number | null;
          matched_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          export_id?: string | null;
          target?: "quickbooks" | "xero";
          source_type?: string;
          source_id?: string;
          external_ref?: string;
          amount_minor?: number;
          exported_on?: string;
          matched_minor?: number | null;
          matched_at?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "accounting_export_rows_export_id_fkey";
            columns: ["export_id"];
            isOneToOne: false;
            referencedRelation: "accounting_exports";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "accounting_export_rows_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      accounting_exports: {
        Row: {
          id: string;
          organization_id: string;
          target: "quickbooks" | "xero";
          kind: "invoices" | "payments" | "expenses";
          period_start: string;
          period_end: string;
          row_count: number;
          total_minor: number;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          target: "quickbooks" | "xero";
          kind: "invoices" | "payments" | "expenses";
          period_start: string;
          period_end: string;
          row_count?: number;
          total_minor?: number;
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          target?: "quickbooks" | "xero";
          kind?: "invoices" | "payments" | "expenses";
          period_start?: string;
          period_end?: string;
          row_count?: number;
          total_minor?: number;
          created_by?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "accounting_exports_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "accounting_exports_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      appointment_tokens: {
        Row: {
          id: string;
          organization_id: string;
          job_id: string;
          token: string;
          expires_at: string;
          revoked_at: string | null;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          job_id: string;
          token?: string;
          expires_at: string;
          revoked_at?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          job_id?: string;
          token?: string;
          expires_at?: string;
          revoked_at?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "appointment_tokens_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "appointment_tokens_job_id_organization_id_fkey";
            columns: ["job_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id", "organization_id"];
          },
          {
            foreignKeyName: "appointment_tokens_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      audit_log: {
        Row: {
          id: number;
          organization_id: string | null;
          table_name: string;
          row_id: string | null;
          action: string;
          actor: string | null;
          old_data: Json | null;
          new_data: Json | null;
          at: string;
        };
        Insert: {
          id?: number;
          organization_id?: string | null;
          table_name: string;
          row_id?: string | null;
          action: string;
          actor?: string | null;
          old_data?: Json | null;
          new_data?: Json | null;
          at?: string;
        };
        Update: {
          id?: number;
          organization_id?: string | null;
          table_name?: string;
          row_id?: string | null;
          action?: string;
          actor?: string | null;
          old_data?: Json | null;
          new_data?: Json | null;
          at?: string;
        };
        Relationships: [];
      };
      auth_login_attempts: {
        Row: {
          id: number;
          email_key: string;
          organization_id: string | null;
          profile_id: string | null;
          success: boolean;
          reason: string | null;
          ip: string | null;
          ip_source: string | null;
          ip_trusted: boolean;
          network_prefix: string | null;
          user_agent: string | null;
          device_label: string | null;
          at: string;
        };
        Insert: {
          id?: number;
          email_key: string;
          organization_id?: string | null;
          profile_id?: string | null;
          success: boolean;
          reason?: string | null;
          ip?: string | null;
          ip_source?: string | null;
          ip_trusted?: boolean;
          network_prefix?: string | null;
          user_agent?: string | null;
          device_label?: string | null;
          at?: string;
        };
        Update: {
          id?: number;
          email_key?: string;
          organization_id?: string | null;
          profile_id?: string | null;
          success?: boolean;
          reason?: string | null;
          ip?: string | null;
          ip_source?: string | null;
          ip_trusted?: boolean;
          network_prefix?: string | null;
          user_agent?: string | null;
          device_label?: string | null;
          at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "auth_login_attempts_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "auth_login_attempts_profile_id_fkey";
            columns: ["profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      automation_rules: {
        Row: {
          id: string;
          organization_id: string;
          name: string;
          trigger_type: string;
          condition_json: Json;
          action_type: string;
          action_json: Json;
          enabled: boolean;
          last_run_at: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          name: string;
          trigger_type: string;
          condition_json?: Json;
          action_type: string;
          action_json?: Json;
          enabled?: boolean;
          last_run_at?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          name?: string;
          trigger_type?: string;
          condition_json?: Json;
          action_type?: string;
          action_json?: Json;
          enabled?: boolean;
          last_run_at?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "automation_rules_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "automation_rules_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      automation_runs: {
        Row: {
          id: string;
          organization_id: string;
          rule_id: string;
          source_type: string | null;
          source_id: string | null;
          status: "pending" | "running" | "succeeded" | "failed" | "skipped";
          error_message: string | null;
          attempts: number;
          created_at: string;
          finished_at: string | null;
        };
        Insert: {
          id?: string;
          organization_id: string;
          rule_id: string;
          source_type?: string | null;
          source_id?: string | null;
          status?: "pending" | "running" | "succeeded" | "failed" | "skipped";
          error_message?: string | null;
          attempts?: number;
          created_at?: string;
          finished_at?: string | null;
        };
        Update: {
          id?: string;
          organization_id?: string;
          rule_id?: string;
          source_type?: string | null;
          source_id?: string | null;
          status?: "pending" | "running" | "succeeded" | "failed" | "skipped";
          error_message?: string | null;
          attempts?: number;
          created_at?: string;
          finished_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "automation_runs_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "automation_runs_rule_id_fkey";
            columns: ["rule_id"];
            isOneToOne: false;
            referencedRelation: "automation_rules";
            referencedColumns: ["id"];
          },
        ];
      };
      booking_questions: {
        Row: {
          id: string;
          organization_id: string;
          label_en: string;
          label_he: string | null;
          field_type: "text" | "textarea" | "choice" | "checkbox";
          options_json: Json;
          required: boolean;
          active: boolean;
          sort: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          label_en: string;
          label_he?: string | null;
          field_type?: "text" | "textarea" | "choice" | "checkbox";
          options_json?: Json;
          required?: boolean;
          active?: boolean;
          sort?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          label_en?: string;
          label_he?: string | null;
          field_type?: "text" | "textarea" | "choice" | "checkbox";
          options_json?: Json;
          required?: boolean;
          active?: boolean;
          sort?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "booking_questions_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      booking_services: {
        Row: {
          id: string;
          organization_id: string;
          job_type_id: string | null;
          name_en: string;
          name_he: string | null;
          description_en: string | null;
          description_he: string | null;
          duration_min: number;
          price_minor: number;
          book_as: "job" | "estimate";
          active: boolean;
          sort: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          job_type_id?: string | null;
          name_en: string;
          name_he?: string | null;
          description_en?: string | null;
          description_he?: string | null;
          duration_min?: number;
          price_minor?: number;
          book_as?: "job" | "estimate";
          active?: boolean;
          sort?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          job_type_id?: string | null;
          name_en?: string;
          name_he?: string | null;
          description_en?: string | null;
          description_he?: string | null;
          duration_min?: number;
          price_minor?: number;
          book_as?: "job" | "estimate";
          active?: boolean;
          sort?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "booking_services_job_type_id_fkey";
            columns: ["job_type_id"];
            isOneToOne: false;
            referencedRelation: "job_types";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "booking_services_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      booking_settings: {
        Row: {
          organization_id: string;
          enabled: boolean;
          approval_required: boolean;
          enforce_service_area: boolean;
          use_team_capacity: boolean;
          min_notice_hours: number;
          max_days_ahead: number;
          slot_interval_min: 15 | 30 | 45 | 60 | 90 | 120;
          arrival_window_min: 30 | 60 | 90 | 120 | 180 | 240;
          hours_json: Json;
          payment_mode: "none" | "fixed" | "percentage" | "full";
          deposit_value: number;
          success_message_en: string | null;
          success_message_he: string | null;
          urgent_message_en: string | null;
          urgent_message_he: string | null;
          created_at: string;
          updated_at: string;
          timezone: string;
        };
        Insert: {
          organization_id: string;
          enabled?: boolean;
          approval_required?: boolean;
          enforce_service_area?: boolean;
          use_team_capacity?: boolean;
          min_notice_hours?: number;
          max_days_ahead?: number;
          slot_interval_min?: 15 | 30 | 45 | 60 | 90 | 120;
          arrival_window_min?: 30 | 60 | 90 | 120 | 180 | 240;
          hours_json?: Json;
          payment_mode?: "none" | "fixed" | "percentage" | "full";
          deposit_value?: number;
          success_message_en?: string | null;
          success_message_he?: string | null;
          urgent_message_en?: string | null;
          urgent_message_he?: string | null;
          created_at?: string;
          updated_at?: string;
          timezone?: string;
        };
        Update: {
          organization_id?: string;
          enabled?: boolean;
          approval_required?: boolean;
          enforce_service_area?: boolean;
          use_team_capacity?: boolean;
          min_notice_hours?: number;
          max_days_ahead?: number;
          slot_interval_min?: 15 | 30 | 45 | 60 | 90 | 120;
          arrival_window_min?: 30 | 60 | 90 | 120 | 180 | 240;
          hours_json?: Json;
          payment_mode?: "none" | "fixed" | "percentage" | "full";
          deposit_value?: number;
          success_message_en?: string | null;
          success_message_he?: string | null;
          urgent_message_en?: string | null;
          urgent_message_he?: string | null;
          created_at?: string;
          updated_at?: string;
          timezone?: string;
        };
        Relationships: [
          {
            foreignKeyName: "booking_settings_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: true;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      bulk_operations: {
        Row: {
          id: string;
          organization_id: string;
          actor_id: string | null;
          action: string;
          attempted: number;
          succeeded: number;
          failed: number;
          skipped: number;
          failures: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          actor_id?: string | null;
          action: string;
          attempted?: number;
          succeeded?: number;
          failed?: number;
          skipped?: number;
          failures?: Json;
          created_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          actor_id?: string | null;
          action?: string;
          attempted?: number;
          succeeded?: number;
          failed?: number;
          skipped?: number;
          failures?: Json;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "bulk_operations_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "bulk_operations_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      calendar_feed_tokens: {
        Row: {
          id: string;
          organization_id: string;
          profile_id: string;
          token: string;
          label: string;
          scope: "mine" | "organization";
          expires_at: string;
          revoked_at: string | null;
          revoked_by: string | null;
          last_accessed_at: string | null;
          access_count: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          profile_id: string;
          token?: string;
          label?: string;
          scope?: "mine" | "organization";
          expires_at: string;
          revoked_at?: string | null;
          revoked_by?: string | null;
          last_accessed_at?: string | null;
          access_count?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          profile_id?: string;
          token?: string;
          label?: string;
          scope?: "mine" | "organization";
          expires_at?: string;
          revoked_at?: string | null;
          revoked_by?: string | null;
          last_accessed_at?: string | null;
          access_count?: number;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "calendar_feed_tokens_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "calendar_feed_tokens_profile_id_fkey";
            columns: ["profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "calendar_feed_tokens_revoked_by_fkey";
            columns: ["revoked_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      call_events: {
        Row: {
          id: string;
          organization_id: string;
          provider: string;
          provider_call_id: string | null;
          direction: "inbound" | "outbound";
          status:
            | "initiated"
            | "ringing"
            | "in_progress"
            | "completed"
            | "missed"
            | "failed"
            | "voicemail";
          from_number: string;
          to_number: string;
          tracked_number_id: string | null;
          customer_id: string | null;
          job_id: string | null;
          lead_id: string | null;
          handled_by: string | null;
          reason: string | null;
          outcome: string | null;
          notes: string | null;
          needs_follow_up: boolean;
          recording_url: string | null;
          recording_consent: boolean;
          started_at: string;
          answered_at: string | null;
          ended_at: string | null;
          duration_seconds: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          provider?: string;
          provider_call_id?: string | null;
          direction: "inbound" | "outbound";
          status?:
            | "initiated"
            | "ringing"
            | "in_progress"
            | "completed"
            | "missed"
            | "failed"
            | "voicemail";
          from_number: string;
          to_number: string;
          tracked_number_id?: string | null;
          customer_id?: string | null;
          job_id?: string | null;
          lead_id?: string | null;
          handled_by?: string | null;
          reason?: string | null;
          outcome?: string | null;
          notes?: string | null;
          needs_follow_up?: boolean;
          recording_url?: string | null;
          recording_consent?: boolean;
          started_at?: string;
          answered_at?: string | null;
          ended_at?: string | null;
          duration_seconds?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          provider?: string;
          provider_call_id?: string | null;
          direction?: "inbound" | "outbound";
          status?:
            | "initiated"
            | "ringing"
            | "in_progress"
            | "completed"
            | "missed"
            | "failed"
            | "voicemail";
          from_number?: string;
          to_number?: string;
          tracked_number_id?: string | null;
          customer_id?: string | null;
          job_id?: string | null;
          lead_id?: string | null;
          handled_by?: string | null;
          reason?: string | null;
          outcome?: string | null;
          notes?: string | null;
          needs_follow_up?: boolean;
          recording_url?: string | null;
          recording_consent?: boolean;
          started_at?: string;
          answered_at?: string | null;
          ended_at?: string | null;
          duration_seconds?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "call_events_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "call_events_handled_by_fkey";
            columns: ["handled_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "call_events_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "call_events_lead_id_fkey";
            columns: ["lead_id"];
            isOneToOne: false;
            referencedRelation: "leads";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "call_events_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "call_events_tracked_number_id_fkey";
            columns: ["tracked_number_id"];
            isOneToOne: false;
            referencedRelation: "tracked_phone_numbers";
            referencedColumns: ["id"];
          },
        ];
      };
      campaign_deliveries: {
        Row: {
          id: string;
          organization_id: string;
          campaign_id: string;
          customer_id: string;
          channel: "email" | "sms";
          status: "running" | "sent" | "failed" | "skipped";
          reason: string | null;
          attempts: number;
          created_at: string;
          finished_at: string | null;
        };
        Insert: {
          id?: string;
          organization_id: string;
          campaign_id: string;
          customer_id: string;
          channel: "email" | "sms";
          status?: "running" | "sent" | "failed" | "skipped";
          reason?: string | null;
          attempts?: number;
          created_at?: string;
          finished_at?: string | null;
        };
        Update: {
          id?: string;
          organization_id?: string;
          campaign_id?: string;
          customer_id?: string;
          channel?: "email" | "sms";
          status?: "running" | "sent" | "failed" | "skipped";
          reason?: string | null;
          attempts?: number;
          created_at?: string;
          finished_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "campaign_deliveries_campaign_id_fkey";
            columns: ["campaign_id"];
            isOneToOne: false;
            referencedRelation: "campaigns";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "campaign_deliveries_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "campaign_deliveries_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      campaigns: {
        Row: {
          id: string;
          organization_id: string;
          name: string;
          channel: "email" | "sms" | "both";
          audience_json: Json;
          subject: string | null;
          body: string;
          status: "draft" | "scheduled" | "sending" | "sent" | "paused";
          scheduled_at: string | null;
          sent_count: number;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          name: string;
          channel: "email" | "sms" | "both";
          audience_json?: Json;
          subject?: string | null;
          body: string;
          status?: "draft" | "scheduled" | "sending" | "sent" | "paused";
          scheduled_at?: string | null;
          sent_count?: number;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          name?: string;
          channel?: "email" | "sms" | "both";
          audience_json?: Json;
          subject?: string | null;
          body?: string;
          status?: "draft" | "scheduled" | "sending" | "sent" | "paused";
          scheduled_at?: string | null;
          sent_count?: number;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "campaigns_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "campaigns_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      catalog_import_batches: {
        Row: {
          id: string;
          organization_id: string;
          source: string;
          industry_keys: string[];
          included_parts: boolean;
          item_count: number;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          source: string;
          industry_keys?: string[];
          included_parts?: boolean;
          item_count?: number;
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          source?: string;
          industry_keys?: string[];
          included_parts?: boolean;
          item_count?: number;
          created_by?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "catalog_import_batches_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "catalog_import_batches_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      consent_events: {
        Row: {
          id: string;
          organization_id: string;
          customer_id: string | null;
          channel: "email" | "sms" | "phone" | "location" | "terms" | "privacy" | "payment_method";
          purpose: string;
          granted: boolean;
          source:
            "customer_portal" | "booking" | "estimate" | "invoice" | "staff" | "import" | "system";
          policy_version: string | null;
          proof: Json;
          recorded_by: string | null;
          recorded_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          customer_id?: string | null;
          channel: "email" | "sms" | "phone" | "location" | "terms" | "privacy" | "payment_method";
          purpose: string;
          granted: boolean;
          source?:
            "customer_portal" | "booking" | "estimate" | "invoice" | "staff" | "import" | "system";
          policy_version?: string | null;
          proof?: Json;
          recorded_by?: string | null;
          recorded_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          customer_id?: string | null;
          channel?: "email" | "sms" | "phone" | "location" | "terms" | "privacy" | "payment_method";
          purpose?: string;
          granted?: boolean;
          source?:
            "customer_portal" | "booking" | "estimate" | "invoice" | "staff" | "import" | "system";
          policy_version?: string | null;
          proof?: Json;
          recorded_by?: string | null;
          recorded_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "consent_events_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "consent_events_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "consent_events_recorded_by_fkey";
            columns: ["recorded_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      credit_notes: {
        Row: {
          id: string;
          organization_id: string;
          invoice_id: string;
          number: number;
          amount_minor: number;
          reason: string;
          status: "issued" | "cancelled";
          issue_date: string;
          cancelled_at: string | null;
          cancelled_by: string | null;
          cancel_reason: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          invoice_id: string;
          number: number;
          amount_minor: number;
          reason: string;
          status?: "issued" | "cancelled";
          issue_date?: string;
          cancelled_at?: string | null;
          cancelled_by?: string | null;
          cancel_reason?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          invoice_id?: string;
          number?: number;
          amount_minor?: number;
          reason?: string;
          status?: "issued" | "cancelled";
          issue_date?: string;
          cancelled_at?: string | null;
          cancelled_by?: string | null;
          cancel_reason?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "credit_notes_cancelled_by_fkey";
            columns: ["cancelled_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "credit_notes_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "credit_notes_invoice_id_fkey";
            columns: ["invoice_id"];
            isOneToOne: false;
            referencedRelation: "invoices";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "credit_notes_invoice_org_fk";
            columns: ["invoice_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "invoices";
            referencedColumns: ["id", "organization_id"];
          },
          {
            foreignKeyName: "credit_notes_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      crew_members: {
        Row: {
          id: string;
          organization_id: string;
          crew_id: string;
          profile_id: string;
          is_lead: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          crew_id: string;
          profile_id: string;
          is_lead?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          crew_id?: string;
          profile_id?: string;
          is_lead?: boolean;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "crew_members_crew_id_fkey";
            columns: ["crew_id"];
            isOneToOne: false;
            referencedRelation: "crews";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "crew_members_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "crew_members_profile_id_fkey";
            columns: ["profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      crews: {
        Row: {
          id: string;
          organization_id: string;
          name: string;
          color: string;
          active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          name: string;
          color?: string;
          active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          name?: string;
          color?: string;
          active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "crews_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      custom_field_definitions: {
        Row: {
          id: string;
          organization_id: string;
          entity_type: "customer" | "job";
          label: string;
          field_type: "text" | "number" | "date" | "choice" | "checkbox";
          options_json: Json;
          required: boolean;
          active: boolean;
          sort: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          entity_type: "customer" | "job";
          label: string;
          field_type: "text" | "number" | "date" | "choice" | "checkbox";
          options_json?: Json;
          required?: boolean;
          active?: boolean;
          sort?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          entity_type?: "customer" | "job";
          label?: string;
          field_type?: "text" | "number" | "date" | "choice" | "checkbox";
          options_json?: Json;
          required?: boolean;
          active?: boolean;
          sort?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "custom_field_definitions_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      custom_field_values: {
        Row: {
          id: string;
          organization_id: string;
          definition_id: string;
          entity_type: "customer" | "job";
          entity_id: string;
          value_json: Json | null;
          updated_by: string | null;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          definition_id: string;
          entity_type?: "customer" | "job";
          entity_id: string;
          value_json?: Json | null;
          updated_by?: string | null;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          definition_id?: string;
          entity_type?: "customer" | "job";
          entity_id?: string;
          value_json?: Json | null;
          updated_by?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "custom_field_values_definition_id_fkey";
            columns: ["definition_id"];
            isOneToOne: false;
            referencedRelation: "custom_field_definitions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "custom_field_values_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "custom_field_values_updated_by_fkey";
            columns: ["updated_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      customer_portal_requests: {
        Row: {
          id: string;
          organization_id: string;
          customer_id: string;
          job_id: string | null;
          request_type: "reschedule" | "question" | "preferences";
          requested_date: string | null;
          message: string | null;
          status: "new" | "reviewing" | "approved" | "declined" | "closed";
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          customer_id: string;
          job_id?: string | null;
          request_type: "reschedule" | "question" | "preferences";
          requested_date?: string | null;
          message?: string | null;
          status?: "new" | "reviewing" | "approved" | "declined" | "closed";
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          customer_id?: string;
          job_id?: string | null;
          request_type?: "reschedule" | "question" | "preferences";
          requested_date?: string | null;
          message?: string | null;
          status?: "new" | "reviewing" | "approved" | "declined" | "closed";
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "customer_portal_requests_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "customer_portal_requests_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "customer_portal_requests_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      customer_statements: {
        Row: {
          id: string;
          organization_id: string;
          customer_id: string;
          as_of: string;
          since: string | null;
          opening_minor: number;
          charges_minor: number;
          payments_minor: number;
          balance_minor: number;
          past_due_minor: number;
          channel: string | null;
          status: "created" | "sent" | "failed" | "skipped";
          reason: string | null;
          sent_to: string | null;
          created_by: string | null;
          created_at: string;
          sent_at: string | null;
        };
        Insert: {
          id?: string;
          organization_id: string;
          customer_id: string;
          as_of: string;
          since?: string | null;
          opening_minor?: number;
          charges_minor?: number;
          payments_minor?: number;
          balance_minor?: number;
          past_due_minor?: number;
          channel?: string | null;
          status?: "created" | "sent" | "failed" | "skipped";
          reason?: string | null;
          sent_to?: string | null;
          created_by?: string | null;
          created_at?: string;
          sent_at?: string | null;
        };
        Update: {
          id?: string;
          organization_id?: string;
          customer_id?: string;
          as_of?: string;
          since?: string | null;
          opening_minor?: number;
          charges_minor?: number;
          payments_minor?: number;
          balance_minor?: number;
          past_due_minor?: number;
          channel?: string | null;
          status?: "created" | "sent" | "failed" | "skipped";
          reason?: string | null;
          sent_to?: string | null;
          created_by?: string | null;
          created_at?: string;
          sent_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "customer_statements_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "customer_statements_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "customer_statements_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      customer_tax_exemptions: {
        Row: {
          id: string;
          organization_id: string;
          customer_id: string;
          certificate_number: string | null;
          reason: string;
          document_url: string | null;
          expires_on: string | null;
          active: boolean;
          verified_by: string | null;
          verified_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          customer_id: string;
          certificate_number?: string | null;
          reason: string;
          document_url?: string | null;
          expires_on?: string | null;
          active?: boolean;
          verified_by?: string | null;
          verified_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          customer_id?: string;
          certificate_number?: string | null;
          reason?: string;
          document_url?: string | null;
          expires_on?: string | null;
          active?: boolean;
          verified_by?: string | null;
          verified_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "customer_tax_exemptions_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "customer_tax_exemptions_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "customer_tax_exemptions_verified_by_fkey";
            columns: ["verified_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      customers: {
        Row: {
          id: string;
          organization_id: string;
          name: string;
          phone: string;
          email: string | null;
          address: string | null;
          city: string | null;
          source: string | null;
          notes: string | null;
          created_by: string | null;
          deleted_at: string | null;
          created_at: string;
          updated_at: string;
          billing_address: string | null;
          billing_city: string | null;
          archived: boolean;
          legacy_note: string | null;
          portal_token: string;
          sample_batch_id: string | null;
          migration_batch_id: string | null;
          external_source: string | null;
          external_id: string | null;
          email_opt_in: boolean;
          sms_opt_in: boolean;
          portal_token_expires_at: string | null;
          portal_token_rotated_at: string | null;
          deleted_by: string | null;
        };
        Insert: {
          id?: string;
          organization_id: string;
          name: string;
          phone: string;
          email?: string | null;
          address?: string | null;
          city?: string | null;
          source?: string | null;
          notes?: string | null;
          created_by?: string | null;
          deleted_at?: string | null;
          created_at?: string;
          updated_at?: string;
          billing_address?: string | null;
          billing_city?: string | null;
          archived?: boolean;
          legacy_note?: string | null;
          portal_token?: string;
          sample_batch_id?: string | null;
          migration_batch_id?: string | null;
          external_source?: string | null;
          external_id?: string | null;
          email_opt_in?: boolean;
          sms_opt_in?: boolean;
          portal_token_expires_at?: string | null;
          portal_token_rotated_at?: string | null;
          deleted_by?: string | null;
        };
        Update: {
          id?: string;
          organization_id?: string;
          name?: string;
          phone?: string;
          email?: string | null;
          address?: string | null;
          city?: string | null;
          source?: string | null;
          notes?: string | null;
          created_by?: string | null;
          deleted_at?: string | null;
          created_at?: string;
          updated_at?: string;
          billing_address?: string | null;
          billing_city?: string | null;
          archived?: boolean;
          legacy_note?: string | null;
          portal_token?: string;
          sample_batch_id?: string | null;
          migration_batch_id?: string | null;
          external_source?: string | null;
          external_id?: string | null;
          email_opt_in?: boolean;
          sms_opt_in?: boolean;
          portal_token_expires_at?: string | null;
          portal_token_rotated_at?: string | null;
          deleted_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "customers_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "customers_deleted_by_fkey";
            columns: ["deleted_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "customers_migration_batch_id_fkey";
            columns: ["migration_batch_id"];
            isOneToOne: false;
            referencedRelation: "migration_batches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "customers_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      device_subscriptions: {
        Row: {
          id: string;
          organization_id: string;
          profile_id: string;
          endpoint: string;
          p256dh: string;
          auth_secret: string;
          device_name: string | null;
          locale: "en" | "he";
          enabled: boolean;
          last_seen_at: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          profile_id: string;
          endpoint: string;
          p256dh: string;
          auth_secret: string;
          device_name?: string | null;
          locale?: "en" | "he";
          enabled?: boolean;
          last_seen_at?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          profile_id?: string;
          endpoint?: string;
          p256dh?: string;
          auth_secret?: string;
          device_name?: string | null;
          locale?: "en" | "he";
          enabled?: boolean;
          last_seen_at?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "device_subscriptions_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "device_subscriptions_profile_id_fkey";
            columns: ["profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      document_signature_events: {
        Row: {
          id: number;
          organization_id: string | null;
          document_type: "estimate" | "invoice";
          document_id: string | null;
          signer_name: string | null;
          signature_bytes: number;
          signature_sha256: string | null;
          capture: "none" | "server";
          ip: string | null;
          ip_source: string | null;
          ip_trusted: boolean;
          user_agent: string | null;
          device_label: string | null;
          signed_at: string;
        };
        Insert: {
          id?: number;
          organization_id?: string | null;
          document_type: "estimate" | "invoice";
          document_id?: string | null;
          signer_name?: string | null;
          signature_bytes?: number;
          signature_sha256?: string | null;
          capture?: "none" | "server";
          ip?: string | null;
          ip_source?: string | null;
          ip_trusted?: boolean;
          user_agent?: string | null;
          device_label?: string | null;
          signed_at?: string;
        };
        Update: {
          id?: number;
          organization_id?: string | null;
          document_type?: "estimate" | "invoice";
          document_id?: string | null;
          signer_name?: string | null;
          signature_bytes?: number;
          signature_sha256?: string | null;
          capture?: "none" | "server";
          ip?: string | null;
          ip_source?: string | null;
          ip_trusted?: boolean;
          user_agent?: string | null;
          device_label?: string | null;
          signed_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "document_signature_events_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      dunning_events: {
        Row: {
          id: string;
          organization_id: string;
          invoice_id: string;
          customer_id: string | null;
          stage: "reminder" | "overdue" | "second_notice" | "final_notice";
          channel: "sms" | "email";
          status: "running" | "sent" | "failed" | "skipped";
          reason: string | null;
          attempts: number;
          age_days: number | null;
          outstanding_minor: number | null;
          created_at: string;
          finished_at: string | null;
        };
        Insert: {
          id?: string;
          organization_id: string;
          invoice_id: string;
          customer_id?: string | null;
          stage: "reminder" | "overdue" | "second_notice" | "final_notice";
          channel: "sms" | "email";
          status?: "running" | "sent" | "failed" | "skipped";
          reason?: string | null;
          attempts?: number;
          age_days?: number | null;
          outstanding_minor?: number | null;
          created_at?: string;
          finished_at?: string | null;
        };
        Update: {
          id?: string;
          organization_id?: string;
          invoice_id?: string;
          customer_id?: string | null;
          stage?: "reminder" | "overdue" | "second_notice" | "final_notice";
          channel?: "sms" | "email";
          status?: "running" | "sent" | "failed" | "skipped";
          reason?: string | null;
          attempts?: number;
          age_days?: number | null;
          outstanding_minor?: number | null;
          created_at?: string;
          finished_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "dunning_events_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "dunning_events_invoice_id_fkey";
            columns: ["invoice_id"];
            isOneToOne: false;
            referencedRelation: "invoices";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "dunning_events_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      email_messages: {
        Row: {
          id: string;
          organization_id: string;
          related_type: string | null;
          related_id: string | null;
          to_email: string;
          subject: string | null;
          provider: string | null;
          provider_message_id: string | null;
          status: string;
          error: string | null;
          created_at: string;
          sent_at: string | null;
        };
        Insert: {
          id?: string;
          organization_id: string;
          related_type?: string | null;
          related_id?: string | null;
          to_email: string;
          subject?: string | null;
          provider?: string | null;
          provider_message_id?: string | null;
          status?: string;
          error?: string | null;
          created_at?: string;
          sent_at?: string | null;
        };
        Update: {
          id?: string;
          organization_id?: string;
          related_type?: string | null;
          related_id?: string | null;
          to_email?: string;
          subject?: string | null;
          provider?: string | null;
          provider_message_id?: string | null;
          status?: string;
          error?: string | null;
          created_at?: string;
          sent_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "email_messages_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      estimate_followups: {
        Row: {
          id: string;
          organization_id: string;
          estimate_id: string;
          channel: "email" | "sms";
          scheduled_at: string;
          status: "scheduled" | "sent" | "cancelled" | "failed";
          created_at: string;
          attempts: number;
          error_message: string | null;
          sent_at: string | null;
        };
        Insert: {
          id?: string;
          organization_id: string;
          estimate_id: string;
          channel: "email" | "sms";
          scheduled_at: string;
          status?: "scheduled" | "sent" | "cancelled" | "failed";
          created_at?: string;
          attempts?: number;
          error_message?: string | null;
          sent_at?: string | null;
        };
        Update: {
          id?: string;
          organization_id?: string;
          estimate_id?: string;
          channel?: "email" | "sms";
          scheduled_at?: string;
          status?: "scheduled" | "sent" | "cancelled" | "failed";
          created_at?: string;
          attempts?: number;
          error_message?: string | null;
          sent_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "estimate_followups_estimate_id_fkey";
            columns: ["estimate_id"];
            isOneToOne: false;
            referencedRelation: "estimates";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "estimate_followups_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      estimate_items: {
        Row: {
          id: string;
          organization_id: string;
          estimate_id: string;
          description: string;
          qty_milli: number;
          unit_price_minor: number;
          sort: number;
          cost_minor: number;
          image_path: string | null;
          title: string | null;
          taxable: boolean;
        };
        Insert: {
          id?: string;
          organization_id: string;
          estimate_id: string;
          description: string;
          qty_milli?: number;
          unit_price_minor?: number;
          sort?: number;
          cost_minor?: number;
          image_path?: string | null;
          title?: string | null;
          taxable?: boolean;
        };
        Update: {
          id?: string;
          organization_id?: string;
          estimate_id?: string;
          description?: string;
          qty_milli?: number;
          unit_price_minor?: number;
          sort?: number;
          cost_minor?: number;
          image_path?: string | null;
          title?: string | null;
          taxable?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: "estimate_items_estimate_id_fkey";
            columns: ["estimate_id"];
            isOneToOne: false;
            referencedRelation: "estimates";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "estimate_items_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "estimate_items_parent_org_fk";
            columns: ["estimate_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "estimates";
            referencedColumns: ["id", "organization_id"];
          },
        ];
      };
      estimate_option_items: {
        Row: {
          id: string;
          organization_id: string;
          option_id: string;
          title: string | null;
          description: string;
          qty_milli: number;
          unit_price_minor: number;
          cost_minor: number;
          taxable: boolean;
          image_path: string | null;
          sort: number;
        };
        Insert: {
          id?: string;
          organization_id: string;
          option_id: string;
          title?: string | null;
          description?: string;
          qty_milli?: number;
          unit_price_minor?: number;
          cost_minor?: number;
          taxable?: boolean;
          image_path?: string | null;
          sort?: number;
        };
        Update: {
          id?: string;
          organization_id?: string;
          option_id?: string;
          title?: string | null;
          description?: string;
          qty_milli?: number;
          unit_price_minor?: number;
          cost_minor?: number;
          taxable?: boolean;
          image_path?: string | null;
          sort?: number;
        };
        Relationships: [
          {
            foreignKeyName: "estimate_option_items_option_id_fkey";
            columns: ["option_id"];
            isOneToOne: false;
            referencedRelation: "estimate_options";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "estimate_option_items_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      estimate_options: {
        Row: {
          id: string;
          organization_id: string;
          estimate_id: string;
          tier: "good" | "better" | "best";
          title: string;
          description: string | null;
          recommended: boolean;
          deposit_minor: number;
          total_minor: number;
          sort: number;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          estimate_id: string;
          tier: "good" | "better" | "best";
          title?: string;
          description?: string | null;
          recommended?: boolean;
          deposit_minor?: number;
          total_minor?: number;
          sort?: number;
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          estimate_id?: string;
          tier?: "good" | "better" | "best";
          title?: string;
          description?: string | null;
          recommended?: boolean;
          deposit_minor?: number;
          total_minor?: number;
          sort?: number;
          created_by?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "estimate_options_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "estimate_options_estimate_id_organization_id_fkey";
            columns: ["estimate_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "estimates";
            referencedColumns: ["id", "organization_id"];
          },
          {
            foreignKeyName: "estimate_options_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      estimates: {
        Row: {
          id: string;
          organization_id: string;
          number: number;
          customer_id: string;
          status: Database["public"]["Enums"]["estimate_status"];
          discount_minor: number;
          tax_rate_bps: number;
          total_minor: number;
          notes: string | null;
          issue_date: string;
          created_by: string | null;
          deleted_at: string | null;
          created_at: string;
          updated_at: string;
          public_token: string;
          signer_name: string | null;
          signed_at: string | null;
          signature_data: string | null;
          archived: boolean;
          deposit_minor: number;
          sent_at: string | null;
          voided_at: string | null;
          void_reason: string | null;
          voided_by: string | null;
          reopened_at: string | null;
          reopened_by: string | null;
          reopen_reason: string | null;
          reopen_count: number;
          version: number;
          deleted_by: string | null;
          signature_ip: string | null;
          signature_user_agent: string | null;
          selected_option_id: string | null;
          option_selected_at: string | null;
          option_selected_by: string | null;
        };
        Insert: {
          id?: string;
          organization_id: string;
          number: number;
          customer_id: string;
          status?: Database["public"]["Enums"]["estimate_status"];
          discount_minor?: number;
          tax_rate_bps?: number;
          total_minor?: number;
          notes?: string | null;
          issue_date?: string;
          created_by?: string | null;
          deleted_at?: string | null;
          created_at?: string;
          updated_at?: string;
          public_token?: string;
          signer_name?: string | null;
          signed_at?: string | null;
          signature_data?: string | null;
          archived?: boolean;
          deposit_minor?: number;
          sent_at?: string | null;
          voided_at?: string | null;
          void_reason?: string | null;
          voided_by?: string | null;
          reopened_at?: string | null;
          reopened_by?: string | null;
          reopen_reason?: string | null;
          reopen_count?: number;
          version?: number;
          deleted_by?: string | null;
          signature_ip?: string | null;
          signature_user_agent?: string | null;
          selected_option_id?: string | null;
          option_selected_at?: string | null;
          option_selected_by?: string | null;
        };
        Update: {
          id?: string;
          organization_id?: string;
          number?: number;
          customer_id?: string;
          status?: Database["public"]["Enums"]["estimate_status"];
          discount_minor?: number;
          tax_rate_bps?: number;
          total_minor?: number;
          notes?: string | null;
          issue_date?: string;
          created_by?: string | null;
          deleted_at?: string | null;
          created_at?: string;
          updated_at?: string;
          public_token?: string;
          signer_name?: string | null;
          signed_at?: string | null;
          signature_data?: string | null;
          archived?: boolean;
          deposit_minor?: number;
          sent_at?: string | null;
          voided_at?: string | null;
          void_reason?: string | null;
          voided_by?: string | null;
          reopened_at?: string | null;
          reopened_by?: string | null;
          reopen_reason?: string | null;
          reopen_count?: number;
          version?: number;
          deleted_by?: string | null;
          signature_ip?: string | null;
          signature_user_agent?: string | null;
          selected_option_id?: string | null;
          option_selected_at?: string | null;
          option_selected_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "estimates_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "estimates_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "estimates_customer_org_fk";
            columns: ["customer_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id", "organization_id"];
          },
          {
            foreignKeyName: "estimates_deleted_by_fkey";
            columns: ["deleted_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "estimates_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "estimates_reopened_by_fkey";
            columns: ["reopened_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "estimates_selected_option_fk";
            columns: ["selected_option_id", "id"];
            isOneToOne: false;
            referencedRelation: "estimate_options";
            referencedColumns: ["id", "estimate_id"];
          },
          {
            foreignKeyName: "estimates_voided_by_fkey";
            columns: ["voided_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      expenses: {
        Row: {
          id: string;
          organization_id: string;
          expense_date: string;
          category: string;
          vendor: string | null;
          amount_minor: number;
          notes: string | null;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          expense_date?: string;
          category: string;
          vendor?: string | null;
          amount_minor?: number;
          notes?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          expense_date?: string;
          category?: string;
          vendor?: string | null;
          amount_minor?: number;
          notes?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "expenses_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "expenses_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      feature_flags: {
        Row: {
          id: string;
          key: string;
          description: string | null;
          enabled: boolean;
          rollout_percent: number;
          organization_allowlist: string[];
          organization_blocklist: string[];
          updated_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          key: string;
          description?: string | null;
          enabled?: boolean;
          rollout_percent?: number;
          organization_allowlist?: string[];
          organization_blocklist?: string[];
          updated_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          key?: string;
          description?: string | null;
          enabled?: boolean;
          rollout_percent?: number;
          organization_allowlist?: string[];
          organization_blocklist?: string[];
          updated_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "feature_flags_updated_by_fkey";
            columns: ["updated_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      industry_pack_services: {
        Row: {
          pack_key: string;
          item_key: string;
          name_en: string;
          name_he: string;
          sort: number;
          pack_item_key: string | null;
        };
        Insert: {
          pack_key: string;
          item_key: string;
          name_en: string;
          name_he: string;
          sort?: number;
          pack_item_key?: never;
        };
        Update: {
          pack_key?: string;
          item_key?: string;
          name_en?: string;
          name_he?: string;
          sort?: number;
          pack_item_key?: never;
        };
        Relationships: [];
      };
      inventory_items: {
        Row: {
          id: string;
          organization_id: string;
          name: string;
          sku: string | null;
          unit: string | null;
          quantity: number;
          low_stock_threshold: number;
          cost_minor: number;
          notes: string | null;
          created_at: string;
          updated_at: string;
          quantity_milli: number;
        };
        Insert: {
          id?: string;
          organization_id: string;
          name: string;
          sku?: string | null;
          unit?: string | null;
          quantity?: number;
          low_stock_threshold?: number;
          cost_minor?: number;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
          quantity_milli?: number;
        };
        Update: {
          id?: string;
          organization_id?: string;
          name?: string;
          sku?: string | null;
          unit?: string | null;
          quantity?: number;
          low_stock_threshold?: number;
          cost_minor?: number;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
          quantity_milli?: number;
        };
        Relationships: [
          {
            foreignKeyName: "inventory_items_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      inventory_movements: {
        Row: {
          id: string;
          organization_id: string;
          item_id: string;
          kind: "receipt" | "consumption" | "adjustment";
          qty_milli: number;
          unit_cost_minor: number;
          reason: string;
          allow_negative: boolean;
          job_id: string | null;
          job_item_id: string | null;
          purchase_order_item_id: string | null;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          item_id: string;
          kind: "receipt" | "consumption" | "adjustment";
          qty_milli: number;
          unit_cost_minor?: number;
          reason: string;
          allow_negative?: boolean;
          job_id?: string | null;
          job_item_id?: string | null;
          purchase_order_item_id?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          item_id?: string;
          kind?: "receipt" | "consumption" | "adjustment";
          qty_milli?: number;
          unit_cost_minor?: number;
          reason?: string;
          allow_negative?: boolean;
          job_id?: string | null;
          job_item_id?: string | null;
          purchase_order_item_id?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "inventory_movements_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "inventory_movements_item_id_fkey";
            columns: ["item_id"];
            isOneToOne: false;
            referencedRelation: "inventory_items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "inventory_movements_item_org_fk";
            columns: ["item_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "inventory_items";
            referencedColumns: ["id", "organization_id"];
          },
          {
            foreignKeyName: "inventory_movements_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "inventory_movements_job_item_id_fkey";
            columns: ["job_item_id"];
            isOneToOne: false;
            referencedRelation: "job_items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "inventory_movements_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "inventory_movements_purchase_order_item_id_fkey";
            columns: ["purchase_order_item_id"];
            isOneToOne: false;
            referencedRelation: "purchase_order_items";
            referencedColumns: ["id"];
          },
        ];
      };
      invitations: {
        Row: {
          id: string;
          organization_id: string;
          email: string;
          role: Database["public"]["Enums"]["user_role"];
          token: string;
          invited_by: string | null;
          expires_at: string;
          accepted_at: string | null;
          created_at: string;
          sent_at: string | null;
          delivery_status: "pending" | "sent" | "failed" | "unavailable";
          delivery_error: string | null;
          accepted_by: string | null;
        };
        Insert: {
          id?: string;
          organization_id: string;
          email: string;
          role?: Database["public"]["Enums"]["user_role"];
          token: string;
          invited_by?: string | null;
          expires_at?: string;
          accepted_at?: string | null;
          created_at?: string;
          sent_at?: string | null;
          delivery_status?: "pending" | "sent" | "failed" | "unavailable";
          delivery_error?: string | null;
          accepted_by?: string | null;
        };
        Update: {
          id?: string;
          organization_id?: string;
          email?: string;
          role?: Database["public"]["Enums"]["user_role"];
          token?: string;
          invited_by?: string | null;
          expires_at?: string;
          accepted_at?: string | null;
          created_at?: string;
          sent_at?: string | null;
          delivery_status?: "pending" | "sent" | "failed" | "unavailable";
          delivery_error?: string | null;
          accepted_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "invitations_accepted_by_fkey";
            columns: ["accepted_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "invitations_invited_by_fkey";
            columns: ["invited_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "invitations_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      invoice_items: {
        Row: {
          id: string;
          organization_id: string;
          invoice_id: string;
          description: string;
          qty_milli: number;
          unit_price_minor: number;
          sort: number;
          cost_minor: number;
          image_path: string | null;
          title: string | null;
          taxable: boolean;
        };
        Insert: {
          id?: string;
          organization_id: string;
          invoice_id: string;
          description: string;
          qty_milli?: number;
          unit_price_minor?: number;
          sort?: number;
          cost_minor?: number;
          image_path?: string | null;
          title?: string | null;
          taxable?: boolean;
        };
        Update: {
          id?: string;
          organization_id?: string;
          invoice_id?: string;
          description?: string;
          qty_milli?: number;
          unit_price_minor?: number;
          sort?: number;
          cost_minor?: number;
          image_path?: string | null;
          title?: string | null;
          taxable?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: "invoice_items_invoice_id_fkey";
            columns: ["invoice_id"];
            isOneToOne: false;
            referencedRelation: "invoices";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "invoice_items_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "invoice_items_parent_org_fk";
            columns: ["invoice_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "invoices";
            referencedColumns: ["id", "organization_id"];
          },
        ];
      };
      invoices: {
        Row: {
          id: string;
          organization_id: string;
          number: number;
          customer_id: string;
          job_id: string | null;
          status: Database["public"]["Enums"]["invoice_status"];
          method: string | null;
          discount_minor: number;
          tax_rate_bps: number;
          total_minor: number;
          notes: string | null;
          issue_date: string;
          paid_at: string | null;
          deleted_at: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
          public_token: string;
          signer_name: string | null;
          signed_at: string | null;
          signature_data: string | null;
          archived: boolean;
          paid_online: boolean;
          stripe_session_id: string | null;
          estimate_id: string | null;
          sent_at: string | null;
          voided_at: string | null;
          void_reason: string | null;
          voided_by: string | null;
          version: number;
          credited_minor: number;
          deleted_by: string | null;
          signature_ip: string | null;
          signature_user_agent: string | null;
        };
        Insert: {
          id?: string;
          organization_id: string;
          number: number;
          customer_id: string;
          job_id?: string | null;
          status?: Database["public"]["Enums"]["invoice_status"];
          method?: string | null;
          discount_minor?: number;
          tax_rate_bps?: number;
          total_minor?: number;
          notes?: string | null;
          issue_date?: string;
          paid_at?: string | null;
          deleted_at?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
          public_token?: string;
          signer_name?: string | null;
          signed_at?: string | null;
          signature_data?: string | null;
          archived?: boolean;
          paid_online?: boolean;
          stripe_session_id?: string | null;
          estimate_id?: string | null;
          sent_at?: string | null;
          voided_at?: string | null;
          void_reason?: string | null;
          voided_by?: string | null;
          version?: number;
          credited_minor?: number;
          deleted_by?: string | null;
          signature_ip?: string | null;
          signature_user_agent?: string | null;
        };
        Update: {
          id?: string;
          organization_id?: string;
          number?: number;
          customer_id?: string;
          job_id?: string | null;
          status?: Database["public"]["Enums"]["invoice_status"];
          method?: string | null;
          discount_minor?: number;
          tax_rate_bps?: number;
          total_minor?: number;
          notes?: string | null;
          issue_date?: string;
          paid_at?: string | null;
          deleted_at?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
          public_token?: string;
          signer_name?: string | null;
          signed_at?: string | null;
          signature_data?: string | null;
          archived?: boolean;
          paid_online?: boolean;
          stripe_session_id?: string | null;
          estimate_id?: string | null;
          sent_at?: string | null;
          voided_at?: string | null;
          void_reason?: string | null;
          voided_by?: string | null;
          version?: number;
          credited_minor?: number;
          deleted_by?: string | null;
          signature_ip?: string | null;
          signature_user_agent?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "invoices_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "invoices_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "invoices_customer_org_fk";
            columns: ["customer_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id", "organization_id"];
          },
          {
            foreignKeyName: "invoices_deleted_by_fkey";
            columns: ["deleted_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "invoices_estimate_org_fk";
            columns: ["estimate_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "estimates";
            referencedColumns: ["id", "organization_id"];
          },
          {
            foreignKeyName: "invoices_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "invoices_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "invoices_voided_by_fkey";
            columns: ["voided_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      job_actions: {
        Row: {
          id: string;
          organization_id: string;
          job_id: string;
          action_type: "note" | "follow_up";
          title: string;
          body: string | null;
          status: "open" | "done" | "cancelled";
          due_at: string | null;
          assigned_to: string | null;
          created_by: string;
          completed_by: string | null;
          completed_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          job_id: string;
          action_type: "note" | "follow_up";
          title: string;
          body?: string | null;
          status?: "open" | "done" | "cancelled";
          due_at?: string | null;
          assigned_to?: string | null;
          created_by: string;
          completed_by?: string | null;
          completed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          job_id?: string;
          action_type?: "note" | "follow_up";
          title?: string;
          body?: string | null;
          status?: "open" | "done" | "cancelled";
          due_at?: string | null;
          assigned_to?: string | null;
          created_by?: string;
          completed_by?: string | null;
          completed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "job_actions_assigned_to_fkey";
            columns: ["assigned_to"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "job_actions_completed_by_fkey";
            columns: ["completed_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "job_actions_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "job_actions_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "job_actions_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      job_assignments: {
        Row: {
          id: string;
          organization_id: string;
          job_id: string;
          profile_id: string | null;
          crew_id: string | null;
          is_lead: boolean;
          assignment_status: "assigned" | "accepted" | "declined" | "completed";
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          job_id: string;
          profile_id?: string | null;
          crew_id?: string | null;
          is_lead?: boolean;
          assignment_status?: "assigned" | "accepted" | "declined" | "completed";
          created_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          job_id?: string;
          profile_id?: string | null;
          crew_id?: string | null;
          is_lead?: boolean;
          assignment_status?: "assigned" | "accepted" | "declined" | "completed";
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "job_assignments_crew_id_fkey";
            columns: ["crew_id"];
            isOneToOne: false;
            referencedRelation: "crews";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "job_assignments_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "job_assignments_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "job_assignments_profile_id_fkey";
            columns: ["profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      job_checklist_items: {
        Row: {
          id: string;
          organization_id: string;
          job_id: string;
          label: string;
          checked: boolean;
          sort: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          job_id: string;
          label: string;
          checked?: boolean;
          sort?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          job_id?: string;
          label?: string;
          checked?: boolean;
          sort?: number;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "job_checklist_items_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "job_checklist_items_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "job_checklist_job_org_fk";
            columns: ["job_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id", "organization_id"];
          },
        ];
      };
      job_equipment: {
        Row: {
          id: string;
          organization_id: string;
          job_id: string;
          name: string;
          serial: string | null;
          notes: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          job_id: string;
          name: string;
          serial?: string | null;
          notes?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          job_id?: string;
          name?: string;
          serial?: string | null;
          notes?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "job_equipment_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "job_equipment_job_org_fk";
            columns: ["job_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id", "organization_id"];
          },
          {
            foreignKeyName: "job_equipment_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      job_items: {
        Row: {
          id: string;
          organization_id: string;
          job_id: string;
          description: string;
          qty_milli: number;
          unit_price_minor: number;
          cost_minor: number;
          sort: number;
          created_at: string;
          title: string | null;
          taxable: boolean;
          image_path: string | null;
        };
        Insert: {
          id?: string;
          organization_id: string;
          job_id: string;
          description: string;
          qty_milli?: number;
          unit_price_minor?: number;
          cost_minor?: number;
          sort?: number;
          created_at?: string;
          title?: string | null;
          taxable?: boolean;
          image_path?: string | null;
        };
        Update: {
          id?: string;
          organization_id?: string;
          job_id?: string;
          description?: string;
          qty_milli?: number;
          unit_price_minor?: number;
          cost_minor?: number;
          sort?: number;
          created_at?: string;
          title?: string | null;
          taxable?: boolean;
          image_path?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "job_items_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "job_items_job_org_fk";
            columns: ["job_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id", "organization_id"];
          },
          {
            foreignKeyName: "job_items_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      job_photos: {
        Row: {
          id: string;
          organization_id: string;
          job_id: string;
          storage_path: string;
          label: string | null;
          created_by: string | null;
          created_at: string;
          media_type: "image" | "video";
          parent_photo_id: string | null;
          customer_visible: boolean;
        };
        Insert: {
          id?: string;
          organization_id: string;
          job_id: string;
          storage_path: string;
          label?: string | null;
          created_by?: string | null;
          created_at?: string;
          media_type?: "image" | "video";
          parent_photo_id?: string | null;
          customer_visible?: boolean;
        };
        Update: {
          id?: string;
          organization_id?: string;
          job_id?: string;
          storage_path?: string;
          label?: string | null;
          created_by?: string | null;
          created_at?: string;
          media_type?: "image" | "video";
          parent_photo_id?: string | null;
          customer_visible?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: "job_photos_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "job_photos_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "job_photos_job_org_fk";
            columns: ["job_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id", "organization_id"];
          },
          {
            foreignKeyName: "job_photos_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "job_photos_parent_photo_id_fkey";
            columns: ["parent_photo_id"];
            isOneToOne: false;
            referencedRelation: "job_photos";
            referencedColumns: ["id"];
          },
        ];
      };
      job_statuses: {
        Row: {
          id: string;
          organization_id: string;
          name: string;
          color: string;
          sort: number;
          is_done: boolean;
          is_cancelled: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          name: string;
          color?: string;
          sort?: number;
          is_done?: boolean;
          is_cancelled?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          name?: string;
          color?: string;
          sort?: number;
          is_done?: boolean;
          is_cancelled?: boolean;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "job_statuses_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      job_summary_drafts: {
        Row: {
          id: string;
          organization_id: string;
          job_id: string;
          summary: string;
          source_refs: Json;
          provider: string | null;
          model: string | null;
          status: "draft" | "approved" | "rejected";
          created_by: string | null;
          approved_by: string | null;
          created_at: string;
          approved_at: string | null;
        };
        Insert: {
          id?: string;
          organization_id: string;
          job_id: string;
          summary: string;
          source_refs?: Json;
          provider?: string | null;
          model?: string | null;
          status?: "draft" | "approved" | "rejected";
          created_by?: string | null;
          approved_by?: string | null;
          created_at?: string;
          approved_at?: string | null;
        };
        Update: {
          id?: string;
          organization_id?: string;
          job_id?: string;
          summary?: string;
          source_refs?: Json;
          provider?: string | null;
          model?: string | null;
          status?: "draft" | "approved" | "rejected";
          created_by?: string | null;
          approved_by?: string | null;
          created_at?: string;
          approved_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "job_summary_drafts_approved_by_fkey";
            columns: ["approved_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "job_summary_drafts_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "job_summary_drafts_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "job_summary_drafts_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      job_tasks: {
        Row: {
          id: string;
          organization_id: string;
          job_id: string;
          title: string;
          done: boolean;
          sort: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          job_id: string;
          title: string;
          done?: boolean;
          sort?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          job_id?: string;
          title?: string;
          done?: boolean;
          sort?: number;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "job_tasks_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "job_tasks_job_org_fk";
            columns: ["job_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id", "organization_id"];
          },
          {
            foreignKeyName: "job_tasks_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      job_time_entries: {
        Row: {
          id: string;
          organization_id: string;
          job_id: string;
          user_id: string | null;
          started_at: string;
          ended_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          job_id: string;
          user_id?: string | null;
          started_at?: string;
          ended_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          job_id?: string;
          user_id?: string | null;
          started_at?: string;
          ended_at?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "job_time_entries_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "job_time_entries_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "job_time_entries_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "job_time_job_org_fk";
            columns: ["job_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id", "organization_id"];
          },
        ];
      };
      job_types: {
        Row: {
          id: string;
          organization_id: string;
          name: string;
          color: string;
          duration_min: number;
          default_price_minor: number;
          sort: number;
          created_at: string;
          name_en: string | null;
          name_he: string | null;
          pack_key: string | null;
          pack_item_key: string | null;
        };
        Insert: {
          id?: string;
          organization_id: string;
          name: string;
          color?: string;
          duration_min?: number;
          default_price_minor?: number;
          sort?: number;
          created_at?: string;
          name_en?: string | null;
          name_he?: string | null;
          pack_key?: string | null;
          pack_item_key?: string | null;
        };
        Update: {
          id?: string;
          organization_id?: string;
          name?: string;
          color?: string;
          duration_min?: number;
          default_price_minor?: number;
          sort?: number;
          created_at?: string;
          name_en?: string | null;
          name_he?: string | null;
          pack_key?: string | null;
          pack_item_key?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "job_types_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      job_warranties: {
        Row: {
          id: string;
          organization_id: string;
          job_id: string;
          coverage_type: "workmanship" | "manufacturer" | "custom";
          starts_on: string;
          expires_on: string | null;
          terms: string | null;
          status: "active" | "expired" | "void";
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          job_id: string;
          coverage_type?: "workmanship" | "manufacturer" | "custom";
          starts_on: string;
          expires_on?: string | null;
          terms?: string | null;
          status?: "active" | "expired" | "void";
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          job_id?: string;
          coverage_type?: "workmanship" | "manufacturer" | "custom";
          starts_on?: string;
          expires_on?: string | null;
          terms?: string | null;
          status?: "active" | "expired" | "void";
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "job_warranties_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "job_warranties_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: true;
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "job_warranties_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      jobs: {
        Row: {
          id: string;
          organization_id: string;
          customer_id: string;
          assigned_to: string | null;
          service: string;
          status: Database["public"]["Enums"]["job_status"];
          price_minor: number;
          scheduled_date: string;
          start_time: string | null;
          end_time: string | null;
          source: string | null;
          notes: string | null;
          created_by: string | null;
          deleted_at: string | null;
          created_at: string;
          updated_at: string;
          slot: string | null;
          job_address: string | null;
          job_city: string | null;
          on_my_way_at: string | null;
          started_at: string | null;
          completed_at: string | null;
          completion_signature: string | null;
          completion_signed_by: string | null;
          stage: string;
          stage_changed_at: string;
          tags: string[];
          job_expenses_minor: number;
          sample_batch_id: string | null;
          end_date: string;
          migration_batch_id: string | null;
          external_source: string | null;
          external_id: string | null;
          parent_job_id: string | null;
          is_warranty_callback: boolean;
          deleted_by: string | null;
          labour_minutes: number;
          labour_cost_minor: number;
          labour_costed_at: string | null;
          required_skills: string[];
          customer_confirmation_status: "pending" | "confirmed" | "declined";
          customer_confirmed_at: string | null;
          customer_declined_at: string | null;
          customer_confirmation_note: string | null;
          customer_response_count: number;
          on_my_way_eta_minutes: number | null;
          arrived_at: string | null;
        };
        Insert: {
          id?: string;
          organization_id: string;
          customer_id: string;
          assigned_to?: string | null;
          service: string;
          status?: Database["public"]["Enums"]["job_status"];
          price_minor?: number;
          scheduled_date: string;
          start_time?: string | null;
          end_time?: string | null;
          source?: string | null;
          notes?: string | null;
          created_by?: string | null;
          deleted_at?: string | null;
          created_at?: string;
          updated_at?: string;
          slot?: never;
          job_address?: string | null;
          job_city?: string | null;
          on_my_way_at?: string | null;
          started_at?: string | null;
          completed_at?: string | null;
          completion_signature?: string | null;
          completion_signed_by?: string | null;
          stage?: string;
          stage_changed_at?: string;
          tags?: string[];
          job_expenses_minor?: number;
          sample_batch_id?: string | null;
          end_date?: string;
          migration_batch_id?: string | null;
          external_source?: string | null;
          external_id?: string | null;
          parent_job_id?: string | null;
          is_warranty_callback?: boolean;
          deleted_by?: string | null;
          labour_minutes?: number;
          labour_cost_minor?: number;
          labour_costed_at?: string | null;
          required_skills?: string[];
          customer_confirmation_status?: "pending" | "confirmed" | "declined";
          customer_confirmed_at?: string | null;
          customer_declined_at?: string | null;
          customer_confirmation_note?: string | null;
          customer_response_count?: number;
          on_my_way_eta_minutes?: number | null;
          arrived_at?: string | null;
        };
        Update: {
          id?: string;
          organization_id?: string;
          customer_id?: string;
          assigned_to?: string | null;
          service?: string;
          status?: Database["public"]["Enums"]["job_status"];
          price_minor?: number;
          scheduled_date?: string;
          start_time?: string | null;
          end_time?: string | null;
          source?: string | null;
          notes?: string | null;
          created_by?: string | null;
          deleted_at?: string | null;
          created_at?: string;
          updated_at?: string;
          slot?: never;
          job_address?: string | null;
          job_city?: string | null;
          on_my_way_at?: string | null;
          started_at?: string | null;
          completed_at?: string | null;
          completion_signature?: string | null;
          completion_signed_by?: string | null;
          stage?: string;
          stage_changed_at?: string;
          tags?: string[];
          job_expenses_minor?: number;
          sample_batch_id?: string | null;
          end_date?: string;
          migration_batch_id?: string | null;
          external_source?: string | null;
          external_id?: string | null;
          parent_job_id?: string | null;
          is_warranty_callback?: boolean;
          deleted_by?: string | null;
          labour_minutes?: number;
          labour_cost_minor?: number;
          labour_costed_at?: string | null;
          required_skills?: string[];
          customer_confirmation_status?: "pending" | "confirmed" | "declined";
          customer_confirmed_at?: string | null;
          customer_declined_at?: string | null;
          customer_confirmation_note?: string | null;
          customer_response_count?: number;
          on_my_way_eta_minutes?: number | null;
          arrived_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "jobs_assigned_to_fkey";
            columns: ["assigned_to"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "jobs_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "jobs_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "jobs_customer_org_fk";
            columns: ["customer_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id", "organization_id"];
          },
          {
            foreignKeyName: "jobs_deleted_by_fkey";
            columns: ["deleted_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "jobs_migration_batch_id_fkey";
            columns: ["migration_batch_id"];
            isOneToOne: false;
            referencedRelation: "migration_batches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "jobs_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "jobs_parent_job_id_fkey";
            columns: ["parent_job_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
        ];
      };
      lead_attribution_costs: {
        Row: {
          id: string;
          organization_id: string;
          source: string;
          campaign: string | null;
          period_start: string;
          period_end: string;
          spend_minor: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          source: string;
          campaign?: string | null;
          period_start: string;
          period_end: string;
          spend_minor?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          source?: string;
          campaign?: string | null;
          period_start?: string;
          period_end?: string;
          spend_minor?: number;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "lead_attribution_costs_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      leads: {
        Row: {
          id: string;
          organization_id: string;
          name: string;
          phone: string | null;
          email: string | null;
          address: string | null;
          city: string | null;
          service: string | null;
          notes: string | null;
          status: "new" | "contacted" | "quoted" | "won" | "lost";
          source: string | null;
          preferred_date: string | null;
          converted_customer_id: string | null;
          created_at: string;
          updated_at: string;
          postal_code: string | null;
          preferred_start_time: string | null;
          preferred_window_min: number | null;
          booking_service_id: string | null;
          booking_answers: Json;
          booking_reference: string | null;
          booking_status: string;
          campaign: string | null;
          contact_preference: string | null;
          urgency: string | null;
          deposit_estimate_id: string | null;
        };
        Insert: {
          id?: string;
          organization_id: string;
          name: string;
          phone?: string | null;
          email?: string | null;
          address?: string | null;
          city?: string | null;
          service?: string | null;
          notes?: string | null;
          status?: "new" | "contacted" | "quoted" | "won" | "lost";
          source?: string | null;
          preferred_date?: string | null;
          converted_customer_id?: string | null;
          created_at?: string;
          updated_at?: string;
          postal_code?: string | null;
          preferred_start_time?: string | null;
          preferred_window_min?: number | null;
          booking_service_id?: string | null;
          booking_answers?: Json;
          booking_reference?: string | null;
          booking_status?: string;
          campaign?: string | null;
          contact_preference?: string | null;
          urgency?: string | null;
          deposit_estimate_id?: string | null;
        };
        Update: {
          id?: string;
          organization_id?: string;
          name?: string;
          phone?: string | null;
          email?: string | null;
          address?: string | null;
          city?: string | null;
          service?: string | null;
          notes?: string | null;
          status?: "new" | "contacted" | "quoted" | "won" | "lost";
          source?: string | null;
          preferred_date?: string | null;
          converted_customer_id?: string | null;
          created_at?: string;
          updated_at?: string;
          postal_code?: string | null;
          preferred_start_time?: string | null;
          preferred_window_min?: number | null;
          booking_service_id?: string | null;
          booking_answers?: Json;
          booking_reference?: string | null;
          booking_status?: string;
          campaign?: string | null;
          contact_preference?: string | null;
          urgency?: string | null;
          deposit_estimate_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "leads_booking_service_id_fkey";
            columns: ["booking_service_id"];
            isOneToOne: false;
            referencedRelation: "booking_services";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "leads_converted_customer_id_fkey";
            columns: ["converted_customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "leads_deposit_estimate_id_fkey";
            columns: ["deposit_estimate_id"];
            isOneToOne: false;
            referencedRelation: "estimates";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "leads_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      manual_payment_submissions: {
        Row: {
          id: string;
          organization_id: string;
          payment_request_id: string;
          method: "zelle" | "check";
          amount_minor: number;
          reference: string | null;
          mailed_on: string | null;
          status: "verification_pending" | "confirmed" | "rejected" | "reversed";
          submitted_at: string;
          confirmed_by: string | null;
          confirmed_at: string | null;
          decision_reason: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          payment_request_id: string;
          method: "zelle" | "check";
          amount_minor: number;
          reference?: string | null;
          mailed_on?: string | null;
          status?: "verification_pending" | "confirmed" | "rejected" | "reversed";
          submitted_at?: string;
          confirmed_by?: string | null;
          confirmed_at?: string | null;
          decision_reason?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          payment_request_id?: string;
          method?: "zelle" | "check";
          amount_minor?: number;
          reference?: string | null;
          mailed_on?: string | null;
          status?: "verification_pending" | "confirmed" | "rejected" | "reversed";
          submitted_at?: string;
          confirmed_by?: string | null;
          confirmed_at?: string | null;
          decision_reason?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "manual_payment_submissions_confirmed_by_fkey";
            columns: ["confirmed_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "manual_payment_submissions_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "manual_submission_request_org_fk";
            columns: ["payment_request_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "payment_requests";
            referencedColumns: ["id", "organization_id"];
          },
        ];
      };
      merchant_connections: {
        Row: {
          organization_id: string;
          provider: string;
          connected_account_id: string | null;
          status:
            | "not_started"
            | "application_started"
            | "under_review"
            | "action_required"
            | "approved"
            | "rejected"
            | "suspended";
          status_reason: string | null;
          card_enabled: boolean;
          ach_enabled: boolean;
          terminal_enabled: boolean;
          fee_saver_eligible: boolean;
          onboarding_started_at: string | null;
          approved_at: string | null;
          last_webhook_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          organization_id: string;
          provider?: string;
          connected_account_id?: string | null;
          status?:
            | "not_started"
            | "application_started"
            | "under_review"
            | "action_required"
            | "approved"
            | "rejected"
            | "suspended";
          status_reason?: string | null;
          card_enabled?: boolean;
          ach_enabled?: boolean;
          terminal_enabled?: boolean;
          fee_saver_eligible?: boolean;
          onboarding_started_at?: string | null;
          approved_at?: string | null;
          last_webhook_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          organization_id?: string;
          provider?: string;
          connected_account_id?: string | null;
          status?:
            | "not_started"
            | "application_started"
            | "under_review"
            | "action_required"
            | "approved"
            | "rejected"
            | "suspended";
          status_reason?: string | null;
          card_enabled?: boolean;
          ach_enabled?: boolean;
          terminal_enabled?: boolean;
          fee_saver_eligible?: boolean;
          onboarding_started_at?: string | null;
          approved_at?: string | null;
          last_webhook_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "merchant_connections_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: true;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      merchant_secrets: {
        Row: {
          organization_id: string;
          encrypted_api_token: string;
          token_last_four: string | null;
          key_version: number;
          created_at: string;
          rotated_at: string | null;
        };
        Insert: {
          organization_id: string;
          encrypted_api_token: string;
          token_last_four?: string | null;
          key_version?: number;
          created_at?: string;
          rotated_at?: string | null;
        };
        Update: {
          organization_id?: string;
          encrypted_api_token?: string;
          token_last_four?: string | null;
          key_version?: number;
          created_at?: string;
          rotated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "merchant_secrets_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: true;
            referencedRelation: "merchant_connections";
            referencedColumns: ["organization_id"];
          },
        ];
      };
      message_templates: {
        Row: {
          id: string;
          organization_id: string;
          trigger: "booked" | "day_before" | "on_the_way" | "completed";
          enabled: boolean;
          body: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          trigger: "booked" | "day_before" | "on_the_way" | "completed";
          enabled?: boolean;
          body?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          trigger?: "booked" | "day_before" | "on_the_way" | "completed";
          enabled?: boolean;
          body?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "message_templates_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      messages: {
        Row: {
          id: string;
          organization_id: string;
          customer_id: string | null;
          job_id: string | null;
          type: Database["public"]["Enums"]["message_type"];
          body: string;
          status: string;
          sent_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          customer_id?: string | null;
          job_id?: string | null;
          type?: Database["public"]["Enums"]["message_type"];
          body: string;
          status?: string;
          sent_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          customer_id?: string | null;
          job_id?: string | null;
          type?: Database["public"]["Enums"]["message_type"];
          body?: string;
          status?: string;
          sent_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "messages_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "messages_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "messages_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      migration_batches: {
        Row: {
          id: string;
          organization_id: string;
          source: "workiz" | "housecall_pro" | "spreadsheet";
          filename: string | null;
          status:
            | "uploaded"
            | "mapped"
            | "validated"
            | "importing"
            | "completed"
            | "failed"
            | "rolled_back";
          counts_json: Json;
          errors_json: Json;
          created_by: string | null;
          created_at: string;
          completed_at: string | null;
        };
        Insert: {
          id?: string;
          organization_id: string;
          source: "workiz" | "housecall_pro" | "spreadsheet";
          filename?: string | null;
          status?:
            | "uploaded"
            | "mapped"
            | "validated"
            | "importing"
            | "completed"
            | "failed"
            | "rolled_back";
          counts_json?: Json;
          errors_json?: Json;
          created_by?: string | null;
          created_at?: string;
          completed_at?: string | null;
        };
        Update: {
          id?: string;
          organization_id?: string;
          source?: "workiz" | "housecall_pro" | "spreadsheet";
          filename?: string | null;
          status?:
            | "uploaded"
            | "mapped"
            | "validated"
            | "importing"
            | "completed"
            | "failed"
            | "rolled_back";
          counts_json?: Json;
          errors_json?: Json;
          created_by?: string | null;
          created_at?: string;
          completed_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "migration_batches_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "migration_batches_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      organization_industries: {
        Row: {
          id: string;
          organization_id: string;
          industry_key: string;
          services_imported: boolean;
          parts_imported: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          industry_key: string;
          services_imported?: boolean;
          parts_imported?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          industry_key?: string;
          services_imported?: boolean;
          parts_imported?: boolean;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "organization_industries_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      organization_privacy_settings: {
        Row: {
          organization_id: string;
          privacy_email: string | null;
          privacy_phone: string | null;
          location_retention_days: number;
          call_recording_retention_days: number;
          communication_retention_days: number;
          job_media_retention_days: number;
          audit_retention_days: number;
          auto_enforce: boolean;
          updated_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          organization_id: string;
          privacy_email?: string | null;
          privacy_phone?: string | null;
          location_retention_days?: number;
          call_recording_retention_days?: number;
          communication_retention_days?: number;
          job_media_retention_days?: number;
          audit_retention_days?: number;
          auto_enforce?: boolean;
          updated_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          organization_id?: string;
          privacy_email?: string | null;
          privacy_phone?: string | null;
          location_retention_days?: number;
          call_recording_retention_days?: number;
          communication_retention_days?: number;
          job_media_retention_days?: number;
          audit_retention_days?: number;
          auto_enforce?: boolean;
          updated_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "organization_privacy_settings_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: true;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "organization_privacy_settings_updated_by_fkey";
            columns: ["updated_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      organizations: {
        Row: {
          id: string;
          name: string;
          tagline: string | null;
          logo_url: string | null;
          address: string | null;
          city: string | null;
          phone: string | null;
          email: string | null;
          business_id: string | null;
          locale: "en" | "he";
          currency: string;
          tax_label: string;
          tax_rate_bps: number;
          terms: string | null;
          invoice_counter: number;
          estimate_counter: number;
          created_at: string;
          updated_at: string;
          job_types: string[];
          accent_color: string;
          estimate_terms: string | null;
          invoice_terms: string | null;
          document_footer: string | null;
          review_url: string | null;
          onboarding_dismissed: boolean;
          tax_mode: "flat" | "jurisdictions";
          credit_note_counter: number;
        };
        Insert: {
          id?: string;
          name: string;
          tagline?: string | null;
          logo_url?: string | null;
          address?: string | null;
          city?: string | null;
          phone?: string | null;
          email?: string | null;
          business_id?: string | null;
          locale?: "en" | "he";
          currency?: string;
          tax_label?: string;
          tax_rate_bps?: number;
          terms?: string | null;
          invoice_counter?: number;
          estimate_counter?: number;
          created_at?: string;
          updated_at?: string;
          job_types?: string[];
          accent_color?: string;
          estimate_terms?: string | null;
          invoice_terms?: string | null;
          document_footer?: string | null;
          review_url?: string | null;
          onboarding_dismissed?: boolean;
          tax_mode?: "flat" | "jurisdictions";
          credit_note_counter?: number;
        };
        Update: {
          id?: string;
          name?: string;
          tagline?: string | null;
          logo_url?: string | null;
          address?: string | null;
          city?: string | null;
          phone?: string | null;
          email?: string | null;
          business_id?: string | null;
          locale?: "en" | "he";
          currency?: string;
          tax_label?: string;
          tax_rate_bps?: number;
          terms?: string | null;
          invoice_counter?: number;
          estimate_counter?: number;
          created_at?: string;
          updated_at?: string;
          job_types?: string[];
          accent_color?: string;
          estimate_terms?: string | null;
          invoice_terms?: string | null;
          document_footer?: string | null;
          review_url?: string | null;
          onboarding_dismissed?: boolean;
          tax_mode?: "flat" | "jurisdictions";
          credit_note_counter?: number;
        };
        Relationships: [];
      };
      payment_checkout_secrets: {
        Row: {
          payment_request_id: string;
          encrypted_secret_token: string;
          key_version: number;
          expires_at: string;
          created_at: string;
        };
        Insert: {
          payment_request_id: string;
          encrypted_secret_token: string;
          key_version?: number;
          expires_at: string;
          created_at?: string;
        };
        Update: {
          payment_request_id?: string;
          encrypted_secret_token?: string;
          key_version?: number;
          expires_at?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "payment_checkout_secrets_payment_request_id_fkey";
            columns: ["payment_request_id"];
            isOneToOne: true;
            referencedRelation: "payment_requests";
            referencedColumns: ["id"];
          },
        ];
      };
      payment_disputes: {
        Row: {
          id: string;
          organization_id: string;
          payment_id: string | null;
          provider: string;
          provider_dispute_id: string | null;
          reason_code: string | null;
          reason: string;
          disputed_minor: number;
          status: "needs_response" | "under_review" | "won" | "lost" | "accepted" | "closed";
          opened_at: string;
          response_due_at: string | null;
          evidence_notes: string | null;
          evidence_urls: string[];
          outcome_notes: string | null;
          assigned_to: string | null;
          created_by: string | null;
          closed_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          payment_id?: string | null;
          provider?: string;
          provider_dispute_id?: string | null;
          reason_code?: string | null;
          reason: string;
          disputed_minor: number;
          status?: "needs_response" | "under_review" | "won" | "lost" | "accepted" | "closed";
          opened_at?: string;
          response_due_at?: string | null;
          evidence_notes?: string | null;
          evidence_urls?: string[];
          outcome_notes?: string | null;
          assigned_to?: string | null;
          created_by?: string | null;
          closed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          payment_id?: string | null;
          provider?: string;
          provider_dispute_id?: string | null;
          reason_code?: string | null;
          reason?: string;
          disputed_minor?: number;
          status?: "needs_response" | "under_review" | "won" | "lost" | "accepted" | "closed";
          opened_at?: string;
          response_due_at?: string | null;
          evidence_notes?: string | null;
          evidence_urls?: string[];
          outcome_notes?: string | null;
          assigned_to?: string | null;
          created_by?: string | null;
          closed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "payment_disputes_assigned_to_fkey";
            columns: ["assigned_to"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payment_disputes_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payment_disputes_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payment_disputes_payment_id_fkey";
            columns: ["payment_id"];
            isOneToOne: false;
            referencedRelation: "payments";
            referencedColumns: ["id"];
          },
        ];
      };
      payment_events: {
        Row: {
          id: string;
          organization_id: string | null;
          provider: string;
          provider_event_id: string;
          event_type: string;
          payload_digest: string;
          sanitized_data: Json;
          status: "received" | "processed" | "ignored" | "needs_review" | "failed";
          error_message: string | null;
          received_at: string;
          processed_at: string | null;
        };
        Insert: {
          id?: string;
          organization_id?: string | null;
          provider: string;
          provider_event_id: string;
          event_type: string;
          payload_digest: string;
          sanitized_data?: Json;
          status?: "received" | "processed" | "ignored" | "needs_review" | "failed";
          error_message?: string | null;
          received_at?: string;
          processed_at?: string | null;
        };
        Update: {
          id?: string;
          organization_id?: string | null;
          provider?: string;
          provider_event_id?: string;
          event_type?: string;
          payload_digest?: string;
          sanitized_data?: Json;
          status?: "received" | "processed" | "ignored" | "needs_review" | "failed";
          error_message?: string | null;
          received_at?: string;
          processed_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "payment_events_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      payment_milestones: {
        Row: {
          id: string;
          organization_id: string;
          schedule_id: string;
          label: string;
          calculation_type: "percent" | "fixed" | "remaining";
          amount_minor: number | null;
          percent_bps: number | null;
          due_trigger: "on_approval" | "on_start" | "manual" | "on_completion";
          sort: number;
          status: "pending" | "due" | "processing" | "paid" | "waived" | "cancelled";
          due_at: string | null;
          paid_at: string | null;
          created_at: string;
          updated_at: string;
          released_by: string | null;
          released_at: string | null;
          release_reason: string | null;
        };
        Insert: {
          id?: string;
          organization_id: string;
          schedule_id: string;
          label: string;
          calculation_type: "percent" | "fixed" | "remaining";
          amount_minor?: number | null;
          percent_bps?: number | null;
          due_trigger?: "on_approval" | "on_start" | "manual" | "on_completion";
          sort?: number;
          status?: "pending" | "due" | "processing" | "paid" | "waived" | "cancelled";
          due_at?: string | null;
          paid_at?: string | null;
          created_at?: string;
          updated_at?: string;
          released_by?: string | null;
          released_at?: string | null;
          release_reason?: string | null;
        };
        Update: {
          id?: string;
          organization_id?: string;
          schedule_id?: string;
          label?: string;
          calculation_type?: "percent" | "fixed" | "remaining";
          amount_minor?: number | null;
          percent_bps?: number | null;
          due_trigger?: "on_approval" | "on_start" | "manual" | "on_completion";
          sort?: number;
          status?: "pending" | "due" | "processing" | "paid" | "waived" | "cancelled";
          due_at?: string | null;
          paid_at?: string | null;
          created_at?: string;
          updated_at?: string;
          released_by?: string | null;
          released_at?: string | null;
          release_reason?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "payment_milestones_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payment_milestones_released_by_fkey";
            columns: ["released_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payment_milestones_schedule_org_fk";
            columns: ["schedule_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "payment_schedules";
            referencedColumns: ["id", "organization_id"];
          },
        ];
      };
      payment_notifications: {
        Row: {
          id: string;
          organization_id: string;
          payment_id: string;
          event_type: "receipt" | "status_update" | "refund";
          channel: "email" | "sms";
          status: "pending" | "sent" | "failed";
          provider_message_id: string | null;
          error_message: string | null;
          attempts: number;
          created_at: string;
          sent_at: string | null;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          payment_id: string;
          event_type?: "receipt" | "status_update" | "refund";
          channel: "email" | "sms";
          status?: "pending" | "sent" | "failed";
          provider_message_id?: string | null;
          error_message?: string | null;
          attempts?: number;
          created_at?: string;
          sent_at?: string | null;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          payment_id?: string;
          event_type?: "receipt" | "status_update" | "refund";
          channel?: "email" | "sms";
          status?: "pending" | "sent" | "failed";
          provider_message_id?: string | null;
          error_message?: string | null;
          attempts?: number;
          created_at?: string;
          sent_at?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "payment_notifications_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payment_notifications_payment_id_fkey";
            columns: ["payment_id"];
            isOneToOne: false;
            referencedRelation: "payments";
            referencedColumns: ["id"];
          },
        ];
      };
      payment_refunds: {
        Row: {
          id: string;
          organization_id: string;
          payment_id: string;
          amount_minor: number;
          reason: string;
          method: "provider" | "manual";
          status: "pending" | "completed" | "failed";
          provider: string | null;
          provider_refund_id: string | null;
          failure_reason: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          payment_id: string;
          amount_minor: number;
          reason: string;
          method?: "provider" | "manual";
          status?: "pending" | "completed" | "failed";
          provider?: string | null;
          provider_refund_id?: string | null;
          failure_reason?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          payment_id?: string;
          amount_minor?: number;
          reason?: string;
          method?: "provider" | "manual";
          status?: "pending" | "completed" | "failed";
          provider?: string | null;
          provider_refund_id?: string | null;
          failure_reason?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "payment_refunds_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payment_refunds_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payment_refunds_payment_id_fkey";
            columns: ["payment_id"];
            isOneToOne: false;
            referencedRelation: "payments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payment_refunds_payment_org_fk";
            columns: ["payment_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "payments";
            referencedColumns: ["id", "organization_id"];
          },
        ];
      };
      payment_requests: {
        Row: {
          id: string;
          organization_id: string;
          estimate_id: string | null;
          invoice_id: string | null;
          milestone_id: string | null;
          document_type: "estimate_deposit" | "invoice" | "milestone";
          amount_minor: number;
          currency: string;
          allowed_methods: string[];
          status:
            | "created"
            | "action_required"
            | "submitted"
            | "processing"
            | "partially_paid"
            | "paid"
            | "failed"
            | "cancelled"
            | "expired"
            | "partially_refunded"
            | "refunded"
            | "disputed";
          public_token: string;
          helcim_checkout_token: string | null;
          fee_saver_requested: boolean;
          expires_at: string | null;
          created_at: string;
          updated_at: string;
          tip_minor: number;
        };
        Insert: {
          id?: string;
          organization_id: string;
          estimate_id?: string | null;
          invoice_id?: string | null;
          milestone_id?: string | null;
          document_type: "estimate_deposit" | "invoice" | "milestone";
          amount_minor: number;
          currency?: string;
          allowed_methods?: string[];
          status?:
            | "created"
            | "action_required"
            | "submitted"
            | "processing"
            | "partially_paid"
            | "paid"
            | "failed"
            | "cancelled"
            | "expired"
            | "partially_refunded"
            | "refunded"
            | "disputed";
          public_token?: string;
          helcim_checkout_token?: string | null;
          fee_saver_requested?: boolean;
          expires_at?: string | null;
          created_at?: string;
          updated_at?: string;
          tip_minor?: number;
        };
        Update: {
          id?: string;
          organization_id?: string;
          estimate_id?: string | null;
          invoice_id?: string | null;
          milestone_id?: string | null;
          document_type?: "estimate_deposit" | "invoice" | "milestone";
          amount_minor?: number;
          currency?: string;
          allowed_methods?: string[];
          status?:
            | "created"
            | "action_required"
            | "submitted"
            | "processing"
            | "partially_paid"
            | "paid"
            | "failed"
            | "cancelled"
            | "expired"
            | "partially_refunded"
            | "refunded"
            | "disputed";
          public_token?: string;
          helcim_checkout_token?: string | null;
          fee_saver_requested?: boolean;
          expires_at?: string | null;
          created_at?: string;
          updated_at?: string;
          tip_minor?: number;
        };
        Relationships: [
          {
            foreignKeyName: "payment_requests_estimate_id_fkey";
            columns: ["estimate_id"];
            isOneToOne: false;
            referencedRelation: "estimates";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payment_requests_invoice_id_fkey";
            columns: ["invoice_id"];
            isOneToOne: false;
            referencedRelation: "invoices";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payment_requests_milestone_org_fk";
            columns: ["milestone_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "payment_milestones";
            referencedColumns: ["id", "organization_id"];
          },
          {
            foreignKeyName: "payment_requests_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      payment_schedules: {
        Row: {
          id: string;
          organization_id: string;
          estimate_id: string | null;
          invoice_id: string | null;
          name: string;
          status: "draft" | "active" | "completed" | "cancelled";
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          estimate_id?: string | null;
          invoice_id?: string | null;
          name?: string;
          status?: "draft" | "active" | "completed" | "cancelled";
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          estimate_id?: string | null;
          invoice_id?: string | null;
          name?: string;
          status?: "draft" | "active" | "completed" | "cancelled";
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "payment_schedules_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payment_schedules_estimate_id_fkey";
            columns: ["estimate_id"];
            isOneToOne: false;
            referencedRelation: "estimates";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payment_schedules_invoice_id_fkey";
            columns: ["invoice_id"];
            isOneToOne: false;
            referencedRelation: "invoices";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payment_schedules_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      payment_settings: {
        Row: {
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
          created_at: string;
          updated_at: string;
        };
        Insert: {
          organization_id: string;
          card_enabled?: boolean;
          ach_enabled?: boolean;
          zelle_enabled?: boolean;
          check_enabled?: boolean;
          fee_saver_enabled?: boolean;
          ach_hold_until_settled?: boolean;
          save_methods_enabled?: boolean;
          tips_enabled?: boolean;
          suggested_tip_percents?: number[];
          default_deposit_type?: "none" | "percent" | "fixed";
          default_deposit_bps?: number;
          default_deposit_minor?: number;
          zelle_recipient_name?: string | null;
          zelle_email?: string | null;
          zelle_phone?: string | null;
          zelle_qr_url?: string | null;
          zelle_instructions?: string | null;
          check_payee?: string | null;
          check_address?: string | null;
          check_city_state_zip?: string | null;
          check_memo_instructions?: string | null;
          receipt_email_enabled?: boolean;
          receipt_sms_enabled?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          organization_id?: string;
          card_enabled?: boolean;
          ach_enabled?: boolean;
          zelle_enabled?: boolean;
          check_enabled?: boolean;
          fee_saver_enabled?: boolean;
          ach_hold_until_settled?: boolean;
          save_methods_enabled?: boolean;
          tips_enabled?: boolean;
          suggested_tip_percents?: number[];
          default_deposit_type?: "none" | "percent" | "fixed";
          default_deposit_bps?: number;
          default_deposit_minor?: number;
          zelle_recipient_name?: string | null;
          zelle_email?: string | null;
          zelle_phone?: string | null;
          zelle_qr_url?: string | null;
          zelle_instructions?: string | null;
          check_payee?: string | null;
          check_address?: string | null;
          check_city_state_zip?: string | null;
          check_memo_instructions?: string | null;
          receipt_email_enabled?: boolean;
          receipt_sms_enabled?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "payment_settings_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: true;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      payments: {
        Row: {
          id: string;
          organization_id: string;
          invoice_id: string | null;
          stripe_payment_intent_id: string | null;
          amount_minor: number;
          currency: string;
          status: string;
          paid_at: string | null;
          created_at: string;
          method: string | null;
          note: string | null;
          created_by: string | null;
          reference: string | null;
          provider: string;
          provider_transaction_id: string | null;
          normalized_status:
            | "created"
            | "action_required"
            | "submitted"
            | "processing"
            | "settled"
            | "failed"
            | "cancelled"
            | "partially_refunded"
            | "refunded"
            | "disputed";
          estimate_id: string | null;
          payment_request_id: string | null;
          base_amount_minor: number;
          surcharge_minor: number;
          tip_minor: number;
          refunded_minor: number;
          submitted_at: string | null;
          settled_at: string | null;
        };
        Insert: {
          id?: string;
          organization_id: string;
          invoice_id?: string | null;
          stripe_payment_intent_id?: string | null;
          amount_minor: number;
          currency?: string;
          status?: string;
          paid_at?: string | null;
          created_at?: string;
          method?: string | null;
          note?: string | null;
          created_by?: string | null;
          reference?: string | null;
          provider?: string;
          provider_transaction_id?: string | null;
          normalized_status?:
            | "created"
            | "action_required"
            | "submitted"
            | "processing"
            | "settled"
            | "failed"
            | "cancelled"
            | "partially_refunded"
            | "refunded"
            | "disputed";
          estimate_id?: string | null;
          payment_request_id?: string | null;
          base_amount_minor?: number;
          surcharge_minor?: number;
          tip_minor?: number;
          refunded_minor?: number;
          submitted_at?: string | null;
          settled_at?: string | null;
        };
        Update: {
          id?: string;
          organization_id?: string;
          invoice_id?: string | null;
          stripe_payment_intent_id?: string | null;
          amount_minor?: number;
          currency?: string;
          status?: string;
          paid_at?: string | null;
          created_at?: string;
          method?: string | null;
          note?: string | null;
          created_by?: string | null;
          reference?: string | null;
          provider?: string;
          provider_transaction_id?: string | null;
          normalized_status?:
            | "created"
            | "action_required"
            | "submitted"
            | "processing"
            | "settled"
            | "failed"
            | "cancelled"
            | "partially_refunded"
            | "refunded"
            | "disputed";
          estimate_id?: string | null;
          payment_request_id?: string | null;
          base_amount_minor?: number;
          surcharge_minor?: number;
          tip_minor?: number;
          refunded_minor?: number;
          submitted_at?: string | null;
          settled_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "payments_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payments_estimate_id_fkey";
            columns: ["estimate_id"];
            isOneToOne: false;
            referencedRelation: "estimates";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payments_invoice_id_fkey";
            columns: ["invoice_id"];
            isOneToOne: false;
            referencedRelation: "invoices";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payments_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payments_payment_request_id_fkey";
            columns: ["payment_request_id"];
            isOneToOne: false;
            referencedRelation: "payment_requests";
            referencedColumns: ["id"];
          },
        ];
      };
      permission_change_log: {
        Row: {
          id: number;
          organization_id: string | null;
          subject_profile_id: string | null;
          actor_profile_id: string | null;
          source_table: string;
          operation: string;
          changes: Json;
          ip: string | null;
          user_agent: string | null;
          at: string;
        };
        Insert: {
          id?: number;
          organization_id?: string | null;
          subject_profile_id?: string | null;
          actor_profile_id?: string | null;
          source_table: string;
          operation: string;
          changes: Json;
          ip?: string | null;
          user_agent?: string | null;
          at?: string;
        };
        Update: {
          id?: number;
          organization_id?: string | null;
          subject_profile_id?: string | null;
          actor_profile_id?: string | null;
          source_table?: string;
          operation?: string;
          changes?: Json;
          ip?: string | null;
          user_agent?: string | null;
          at?: string;
        };
        Relationships: [];
      };
      platform_admins: {
        Row: {
          user_id: string;
          role: "support" | "operations" | "super_admin";
          active: boolean;
          created_at: string;
          created_by: string | null;
        };
        Insert: {
          user_id: string;
          role?: "support" | "operations" | "super_admin";
          active?: boolean;
          created_at?: string;
          created_by?: string | null;
        };
        Update: {
          user_id?: string;
          role?: "support" | "operations" | "super_admin";
          active?: boolean;
          created_at?: string;
          created_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "platform_admins_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "platform_admins_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: true;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      price_book: {
        Row: {
          id: string;
          organization_id: string;
          name: string;
          category: string | null;
          unit: string | null;
          price_minor: number;
          created_at: string;
          cost_minor: number;
          image_path: string | null;
          description: string | null;
          taxable: boolean;
          industry_key: string | null;
          pack_item_key: string | null;
          item_kind: string;
          import_batch_id: string | null;
        };
        Insert: {
          id?: string;
          organization_id: string;
          name: string;
          category?: string | null;
          unit?: string | null;
          price_minor?: number;
          created_at?: string;
          cost_minor?: number;
          image_path?: string | null;
          description?: string | null;
          taxable?: boolean;
          industry_key?: string | null;
          pack_item_key?: string | null;
          item_kind?: string;
          import_batch_id?: string | null;
        };
        Update: {
          id?: string;
          organization_id?: string;
          name?: string;
          category?: string | null;
          unit?: string | null;
          price_minor?: number;
          created_at?: string;
          cost_minor?: number;
          image_path?: string | null;
          description?: string | null;
          taxable?: boolean;
          industry_key?: string | null;
          pack_item_key?: string | null;
          item_kind?: string;
          import_batch_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "price_book_import_batch_id_fkey";
            columns: ["import_batch_id"];
            isOneToOne: false;
            referencedRelation: "catalog_import_batches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "price_book_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      privacy_requests: {
        Row: {
          id: string;
          organization_id: string;
          customer_id: string | null;
          request_type: "access" | "export" | "correction" | "deletion" | "opt_out";
          status:
            | "received"
            | "identity_check"
            | "in_progress"
            | "blocked"
            | "ready"
            | "completed"
            | "denied"
            | "cancelled";
          requester_name: string;
          requester_email: string | null;
          requester_phone: string | null;
          details: string | null;
          received_at: string;
          due_at: string | null;
          identity_verified_at: string | null;
          assigned_to: string | null;
          completed_at: string | null;
          completion_notes: string | null;
          denial_reason: string | null;
          export_downloaded_at: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          customer_id?: string | null;
          request_type: "access" | "export" | "correction" | "deletion" | "opt_out";
          status?:
            | "received"
            | "identity_check"
            | "in_progress"
            | "blocked"
            | "ready"
            | "completed"
            | "denied"
            | "cancelled";
          requester_name: string;
          requester_email?: string | null;
          requester_phone?: string | null;
          details?: string | null;
          received_at?: string;
          due_at?: string | null;
          identity_verified_at?: string | null;
          assigned_to?: string | null;
          completed_at?: string | null;
          completion_notes?: string | null;
          denial_reason?: string | null;
          export_downloaded_at?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          customer_id?: string | null;
          request_type?: "access" | "export" | "correction" | "deletion" | "opt_out";
          status?:
            | "received"
            | "identity_check"
            | "in_progress"
            | "blocked"
            | "ready"
            | "completed"
            | "denied"
            | "cancelled";
          requester_name?: string;
          requester_email?: string | null;
          requester_phone?: string | null;
          details?: string | null;
          received_at?: string;
          due_at?: string | null;
          identity_verified_at?: string | null;
          assigned_to?: string | null;
          completed_at?: string | null;
          completion_notes?: string | null;
          denial_reason?: string | null;
          export_downloaded_at?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "privacy_requests_assigned_to_fkey";
            columns: ["assigned_to"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "privacy_requests_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "privacy_requests_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "privacy_requests_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      profile_capabilities: {
        Row: {
          profile_id: string;
          organization_id: string;
          can_view_customers: boolean;
          can_edit_customers: boolean;
          can_manage_schedule: boolean;
          can_edit_jobs: boolean;
          can_manage_estimates: boolean;
          can_manage_invoices: boolean;
          can_manage_payments: boolean;
          can_view_reports: boolean;
          can_manage_purchasing: boolean;
          can_manage_automations: boolean;
          can_manage_settings: boolean;
          can_manage_team: boolean;
          updated_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          profile_id: string;
          organization_id: string;
          can_view_customers?: boolean;
          can_edit_customers?: boolean;
          can_manage_schedule?: boolean;
          can_edit_jobs?: boolean;
          can_manage_estimates?: boolean;
          can_manage_invoices?: boolean;
          can_manage_payments?: boolean;
          can_view_reports?: boolean;
          can_manage_purchasing?: boolean;
          can_manage_automations?: boolean;
          can_manage_settings?: boolean;
          can_manage_team?: boolean;
          updated_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          profile_id?: string;
          organization_id?: string;
          can_view_customers?: boolean;
          can_edit_customers?: boolean;
          can_manage_schedule?: boolean;
          can_edit_jobs?: boolean;
          can_manage_estimates?: boolean;
          can_manage_invoices?: boolean;
          can_manage_payments?: boolean;
          can_view_reports?: boolean;
          can_manage_purchasing?: boolean;
          can_manage_automations?: boolean;
          can_manage_settings?: boolean;
          can_manage_team?: boolean;
          updated_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "profile_capabilities_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "profile_capabilities_profile_id_fkey";
            columns: ["profile_id"];
            isOneToOne: true;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "profile_capabilities_updated_by_fkey";
            columns: ["updated_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      profile_payment_permissions: {
        Row: {
          profile_id: string;
          organization_id: string;
          can_confirm_manual_payments: boolean;
          can_refund_payments: boolean;
          can_override_ach_holds: boolean;
          updated_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          profile_id: string;
          organization_id: string;
          can_confirm_manual_payments?: boolean;
          can_refund_payments?: boolean;
          can_override_ach_holds?: boolean;
          updated_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          profile_id?: string;
          organization_id?: string;
          can_confirm_manual_payments?: boolean;
          can_refund_payments?: boolean;
          can_override_ach_holds?: boolean;
          updated_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "profile_payment_permissions_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "profile_payment_permissions_profile_id_fkey";
            columns: ["profile_id"];
            isOneToOne: true;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "profile_payment_permissions_updated_by_fkey";
            columns: ["updated_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      profile_security: {
        Row: {
          profile_id: string;
          organization_id: string | null;
          login_alerts_enabled: boolean;
          mfa_enrolled_at: string | null;
          mfa_removed_at: string | null;
          sessions_revoked_at: string | null;
          last_password_change_at: string | null;
          last_sign_in_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          profile_id: string;
          organization_id?: string | null;
          login_alerts_enabled?: boolean;
          mfa_enrolled_at?: string | null;
          mfa_removed_at?: string | null;
          sessions_revoked_at?: string | null;
          last_password_change_at?: string | null;
          last_sign_in_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          profile_id?: string;
          organization_id?: string | null;
          login_alerts_enabled?: boolean;
          mfa_enrolled_at?: string | null;
          mfa_removed_at?: string | null;
          sessions_revoked_at?: string | null;
          last_password_change_at?: string | null;
          last_sign_in_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "profile_security_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "profile_security_profile_id_fkey";
            columns: ["profile_id"];
            isOneToOne: true;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          id: string;
          organization_id: string | null;
          full_name: string;
          phone: string | null;
          role: Database["public"]["Enums"]["user_role"];
          color: string | null;
          active: boolean;
          created_at: string;
          updated_at: string;
          commission_pct: number;
          ui_theme: "light" | "dark" | "system";
          ui_contrast: "normal" | "high";
          ui_text_scale: "normal" | "large";
          ui_reduce_motion: boolean;
          notify_email_opt_in: boolean;
          notify_push_opt_in: boolean;
          notify_email: string | null;
        };
        Insert: {
          id: string;
          organization_id?: string | null;
          full_name?: string;
          phone?: string | null;
          role?: Database["public"]["Enums"]["user_role"];
          color?: string | null;
          active?: boolean;
          created_at?: string;
          updated_at?: string;
          commission_pct?: number;
          ui_theme?: "light" | "dark" | "system";
          ui_contrast?: "normal" | "high";
          ui_text_scale?: "normal" | "large";
          ui_reduce_motion?: boolean;
          notify_email_opt_in?: boolean;
          notify_push_opt_in?: boolean;
          notify_email?: string | null;
        };
        Update: {
          id?: string;
          organization_id?: string | null;
          full_name?: string;
          phone?: string | null;
          role?: Database["public"]["Enums"]["user_role"];
          color?: string | null;
          active?: boolean;
          created_at?: string;
          updated_at?: string;
          commission_pct?: number;
          ui_theme?: "light" | "dark" | "system";
          ui_contrast?: "normal" | "high";
          ui_text_scale?: "normal" | "large";
          ui_reduce_motion?: boolean;
          notify_email_opt_in?: boolean;
          notify_push_opt_in?: boolean;
          notify_email?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "profiles_id_fkey";
            columns: ["id"];
            isOneToOne: true;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "profiles_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      purchase_order_items: {
        Row: {
          id: string;
          organization_id: string;
          purchase_order_id: string;
          description: string;
          quantity: number;
          unit_cost_minor: number;
          received_quantity: number;
          created_at: string;
          qty_milli: number;
          received_qty_milli: number;
          sort: number;
          inventory_item_id: string | null;
        };
        Insert: {
          id?: string;
          organization_id: string;
          purchase_order_id: string;
          description: string;
          quantity?: number;
          unit_cost_minor?: number;
          received_quantity?: number;
          created_at?: string;
          qty_milli?: number;
          received_qty_milli?: number;
          sort?: number;
          inventory_item_id?: string | null;
        };
        Update: {
          id?: string;
          organization_id?: string;
          purchase_order_id?: string;
          description?: string;
          quantity?: number;
          unit_cost_minor?: number;
          received_quantity?: number;
          created_at?: string;
          qty_milli?: number;
          received_qty_milli?: number;
          sort?: number;
          inventory_item_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "purchase_order_items_inventory_item_id_fkey";
            columns: ["inventory_item_id"];
            isOneToOne: false;
            referencedRelation: "inventory_items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "purchase_order_items_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "purchase_order_items_purchase_order_id_fkey";
            columns: ["purchase_order_id"];
            isOneToOne: false;
            referencedRelation: "purchase_orders";
            referencedColumns: ["id"];
          },
        ];
      };
      purchase_orders: {
        Row: {
          id: string;
          organization_id: string;
          po_number: string;
          vendor_id: string | null;
          job_id: string | null;
          status: "draft" | "ordered" | "partially_received" | "received" | "cancelled";
          expected_date: string | null;
          total_minor: number;
          notes: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
          ordered_at: string | null;
          received_at: string | null;
          cancelled_at: string | null;
        };
        Insert: {
          id?: string;
          organization_id: string;
          po_number: string;
          vendor_id?: string | null;
          job_id?: string | null;
          status?: "draft" | "ordered" | "partially_received" | "received" | "cancelled";
          expected_date?: string | null;
          total_minor?: number;
          notes?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
          ordered_at?: string | null;
          received_at?: string | null;
          cancelled_at?: string | null;
        };
        Update: {
          id?: string;
          organization_id?: string;
          po_number?: string;
          vendor_id?: string | null;
          job_id?: string | null;
          status?: "draft" | "ordered" | "partially_received" | "received" | "cancelled";
          expected_date?: string | null;
          total_minor?: number;
          notes?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
          ordered_at?: string | null;
          received_at?: string | null;
          cancelled_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "purchase_orders_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "purchase_orders_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "purchase_orders_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "purchase_orders_vendor_id_fkey";
            columns: ["vendor_id"];
            isOneToOne: false;
            referencedRelation: "vendors";
            referencedColumns: ["id"];
          },
        ];
      };
      push_notification_events: {
        Row: {
          id: string;
          organization_id: string;
          profile_id: string | null;
          event_type: string;
          title: string;
          body: string;
          target_url: string | null;
          status: string;
          error_message: string | null;
          created_at: string;
          sent_at: string | null;
          related_type: string | null;
          related_id: string | null;
          device_count: number;
        };
        Insert: {
          id?: string;
          organization_id: string;
          profile_id?: string | null;
          event_type: string;
          title: string;
          body: string;
          target_url?: string | null;
          status?: string;
          error_message?: string | null;
          created_at?: string;
          sent_at?: string | null;
          related_type?: string | null;
          related_id?: string | null;
          device_count?: number;
        };
        Update: {
          id?: string;
          organization_id?: string;
          profile_id?: string | null;
          event_type?: string;
          title?: string;
          body?: string;
          target_url?: string | null;
          status?: string;
          error_message?: string | null;
          created_at?: string;
          sent_at?: string | null;
          related_type?: string | null;
          related_id?: string | null;
          device_count?: number;
        };
        Relationships: [
          {
            foreignKeyName: "push_notification_events_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "push_notification_events_profile_id_fkey";
            columns: ["profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      recurring_plans: {
        Row: {
          id: string;
          organization_id: string;
          customer_id: string;
          service: string;
          interval_months: number;
          price_minor: number;
          assigned_to: string | null;
          next_due: string;
          active: boolean;
          notes: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          customer_id: string;
          service: string;
          interval_months?: number;
          price_minor?: number;
          assigned_to?: string | null;
          next_due?: string;
          active?: boolean;
          notes?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          customer_id?: string;
          service?: string;
          interval_months?: number;
          price_minor?: number;
          assigned_to?: string | null;
          next_due?: string;
          active?: boolean;
          notes?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "recurring_customer_org_fk";
            columns: ["customer_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id", "organization_id"];
          },
          {
            foreignKeyName: "recurring_plans_assigned_to_fkey";
            columns: ["assigned_to"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "recurring_plans_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "recurring_plans_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "recurring_plans_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      referral_programs: {
        Row: {
          id: string;
          organization_id: string;
          name: string;
          reward_text: string;
          active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          name: string;
          reward_text: string;
          active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          name?: string;
          reward_text?: string;
          active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "referral_programs_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      referrals: {
        Row: {
          id: string;
          organization_id: string;
          program_id: string | null;
          referrer_customer_id: string | null;
          referred_customer_id: string | null;
          code: string;
          status: string;
          reward_status: string;
          created_at: string;
          channel: string | null;
          sent_at: string | null;
          error_message: string | null;
        };
        Insert: {
          id?: string;
          organization_id: string;
          program_id?: string | null;
          referrer_customer_id?: string | null;
          referred_customer_id?: string | null;
          code: string;
          status?: string;
          reward_status?: string;
          created_at?: string;
          channel?: string | null;
          sent_at?: string | null;
          error_message?: string | null;
        };
        Update: {
          id?: string;
          organization_id?: string;
          program_id?: string | null;
          referrer_customer_id?: string | null;
          referred_customer_id?: string | null;
          code?: string;
          status?: string;
          reward_status?: string;
          created_at?: string;
          channel?: string | null;
          sent_at?: string | null;
          error_message?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "referrals_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "referrals_program_id_fkey";
            columns: ["program_id"];
            isOneToOne: false;
            referencedRelation: "referral_programs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "referrals_referred_customer_id_fkey";
            columns: ["referred_customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "referrals_referrer_customer_id_fkey";
            columns: ["referrer_customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
        ];
      };
      release_events: {
        Row: {
          id: string;
          release_id: string;
          actor_id: string | null;
          action: string;
          details: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          release_id: string;
          actor_id?: string | null;
          action: string;
          details?: Json;
          created_at?: string;
        };
        Update: {
          id?: string;
          release_id?: string;
          actor_id?: string | null;
          action?: string;
          details?: Json;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "release_events_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "release_events_release_id_fkey";
            columns: ["release_id"];
            isOneToOne: false;
            referencedRelation: "release_records";
            referencedColumns: ["id"];
          },
        ];
      };
      release_records: {
        Row: {
          id: string;
          version: string;
          title: string;
          summary: string | null;
          git_sha: string | null;
          deployment_url: string | null;
          status:
            "draft" | "review" | "approved" | "rolling_out" | "live" | "paused" | "rolled_back";
          risk_level: "low" | "standard" | "high";
          regression_checklist: Json;
          approved_by: string | null;
          created_by: string | null;
          approved_at: string | null;
          released_at: string | null;
          rollback_release_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          version: string;
          title: string;
          summary?: string | null;
          git_sha?: string | null;
          deployment_url?: string | null;
          status?:
            "draft" | "review" | "approved" | "rolling_out" | "live" | "paused" | "rolled_back";
          risk_level?: "low" | "standard" | "high";
          regression_checklist?: Json;
          approved_by?: string | null;
          created_by?: string | null;
          approved_at?: string | null;
          released_at?: string | null;
          rollback_release_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          version?: string;
          title?: string;
          summary?: string | null;
          git_sha?: string | null;
          deployment_url?: string | null;
          status?:
            "draft" | "review" | "approved" | "rolling_out" | "live" | "paused" | "rolled_back";
          risk_level?: "low" | "standard" | "high";
          regression_checklist?: Json;
          approved_by?: string | null;
          created_by?: string | null;
          approved_at?: string | null;
          released_at?: string | null;
          rollback_release_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "release_records_approved_by_fkey";
            columns: ["approved_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "release_records_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "release_records_rollback_release_id_fkey";
            columns: ["rollback_release_id"];
            isOneToOne: false;
            referencedRelation: "release_records";
            referencedColumns: ["id"];
          },
        ];
      };
      reminder_log: {
        Row: {
          id: string;
          organization_id: string;
          kind: string;
          ref_id: string;
          sent_on: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          kind: string;
          ref_id: string;
          sent_on?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          kind?: string;
          ref_id?: string;
          sent_on?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "reminder_log_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      report_deliveries: {
        Row: {
          id: string;
          organization_id: string;
          schedule_id: string;
          period_key: string;
          period_start: string | null;
          period_end: string | null;
          status: "running" | "sent" | "failed" | "skipped";
          reason: string | null;
          attempts: number;
          recipients: number;
          created_at: string;
          finished_at: string | null;
        };
        Insert: {
          id?: string;
          organization_id: string;
          schedule_id: string;
          period_key: string;
          period_start?: string | null;
          period_end?: string | null;
          status?: "running" | "sent" | "failed" | "skipped";
          reason?: string | null;
          attempts?: number;
          recipients?: number;
          created_at?: string;
          finished_at?: string | null;
        };
        Update: {
          id?: string;
          organization_id?: string;
          schedule_id?: string;
          period_key?: string;
          period_start?: string | null;
          period_end?: string | null;
          status?: "running" | "sent" | "failed" | "skipped";
          reason?: string | null;
          attempts?: number;
          recipients?: number;
          created_at?: string;
          finished_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "report_deliveries_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "report_deliveries_schedule_id_fkey";
            columns: ["schedule_id"];
            isOneToOne: false;
            referencedRelation: "report_schedules";
            referencedColumns: ["id"];
          },
        ];
      };
      report_schedules: {
        Row: {
          id: string;
          organization_id: string;
          name: string;
          frequency: "daily" | "weekly" | "monthly";
          enabled: boolean;
          recipient_profile_ids: string[];
          starts_on: string | null;
          last_period_key: string | null;
          last_run_at: string | null;
          last_error: string | null;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          name?: string;
          frequency?: "daily" | "weekly" | "monthly";
          enabled?: boolean;
          recipient_profile_ids?: string[];
          starts_on?: string | null;
          last_period_key?: string | null;
          last_run_at?: string | null;
          last_error?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          name?: string;
          frequency?: "daily" | "weekly" | "monthly";
          enabled?: boolean;
          recipient_profile_ids?: string[];
          starts_on?: string | null;
          last_period_key?: string | null;
          last_run_at?: string | null;
          last_error?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "report_schedules_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "report_schedules_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      retention_holds: {
        Row: {
          id: string;
          organization_id: string;
          customer_id: string | null;
          category: "all" | "location" | "calls" | "communications" | "media" | "audit";
          reason: string;
          starts_at: string;
          expires_at: string | null;
          released_at: string | null;
          created_by: string | null;
          released_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          customer_id?: string | null;
          category?: "all" | "location" | "calls" | "communications" | "media" | "audit";
          reason: string;
          starts_at?: string;
          expires_at?: string | null;
          released_at?: string | null;
          created_by?: string | null;
          released_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          customer_id?: string | null;
          category?: "all" | "location" | "calls" | "communications" | "media" | "audit";
          reason?: string;
          starts_at?: string;
          expires_at?: string | null;
          released_at?: string | null;
          created_by?: string | null;
          released_by?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "retention_holds_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "retention_holds_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "retention_holds_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "retention_holds_released_by_fkey";
            columns: ["released_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      retention_runs: {
        Row: {
          id: string;
          organization_id: string;
          run_key: string;
          mode: "preview" | "enforce";
          status: "running" | "completed" | "partial" | "failed";
          summary: Json;
          error_message: string | null;
          started_at: string;
          finished_at: string | null;
          created_by: string | null;
        };
        Insert: {
          id?: string;
          organization_id: string;
          run_key: string;
          mode?: "preview" | "enforce";
          status?: "running" | "completed" | "partial" | "failed";
          summary?: Json;
          error_message?: string | null;
          started_at?: string;
          finished_at?: string | null;
          created_by?: string | null;
        };
        Update: {
          id?: string;
          organization_id?: string;
          run_key?: string;
          mode?: "preview" | "enforce";
          status?: "running" | "completed" | "partial" | "failed";
          summary?: Json;
          error_message?: string | null;
          started_at?: string;
          finished_at?: string | null;
          created_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "retention_runs_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "retention_runs_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      reviews: {
        Row: {
          id: string;
          organization_id: string;
          customer_id: string | null;
          job_id: string | null;
          rating: number;
          body: string | null;
          review_date: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          customer_id?: string | null;
          job_id?: string | null;
          rating: number;
          body?: string | null;
          review_date?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          customer_id?: string | null;
          job_id?: string | null;
          rating?: number;
          body?: string | null;
          review_date?: string;
        };
        Relationships: [
          {
            foreignKeyName: "reviews_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "reviews_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "reviews_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      secret_key_rotations: {
        Row: {
          id: number;
          target: string;
          from_versions: number[];
          to_version: number;
          rows_total: number;
          rows_rotated: number;
          rows_skipped: number;
          status: "running" | "completed" | "failed" | "refused";
          error: string | null;
          actor: string | null;
          started_at: string;
          finished_at: string | null;
        };
        Insert: {
          id?: number;
          target: string;
          from_versions?: number[];
          to_version: number;
          rows_total?: number;
          rows_rotated?: number;
          rows_skipped?: number;
          status?: "running" | "completed" | "failed" | "refused";
          error?: string | null;
          actor?: string | null;
          started_at?: string;
          finished_at?: string | null;
        };
        Update: {
          id?: number;
          target?: string;
          from_versions?: number[];
          to_version?: number;
          rows_total?: number;
          rows_rotated?: number;
          rows_skipped?: number;
          status?: "running" | "completed" | "failed" | "refused";
          error?: string | null;
          actor?: string | null;
          started_at?: string;
          finished_at?: string | null;
        };
        Relationships: [];
      };
      service_areas: {
        Row: {
          id: string;
          organization_id: string;
          name: string;
          area_type: "zip" | "city" | "polygon";
          values_json: Json;
          active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          name: string;
          area_type?: "zip" | "city" | "polygon";
          values_json?: Json;
          active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          name?: string;
          area_type?: "zip" | "city" | "polygon";
          values_json?: Json;
          active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "service_areas_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      settlement_batches: {
        Row: {
          id: string;
          organization_id: string;
          provider: string;
          provider_settlement_id: string | null;
          settlement_date: string;
          expected_arrival: string | null;
          gross_minor: number;
          fees_minor: number;
          refunds_minor: number;
          chargebacks_minor: number;
          adjustments_minor: number;
          net_minor: number;
          status: "expected" | "in_transit" | "deposited" | "reconciled" | "exception";
          bank_reference: string | null;
          notes: string | null;
          created_by: string | null;
          reconciled_by: string | null;
          reconciled_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          provider?: string;
          provider_settlement_id?: string | null;
          settlement_date?: string;
          expected_arrival?: string | null;
          gross_minor?: number;
          fees_minor?: number;
          refunds_minor?: number;
          chargebacks_minor?: number;
          adjustments_minor?: number;
          net_minor?: number;
          status?: "expected" | "in_transit" | "deposited" | "reconciled" | "exception";
          bank_reference?: string | null;
          notes?: string | null;
          created_by?: string | null;
          reconciled_by?: string | null;
          reconciled_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          provider?: string;
          provider_settlement_id?: string | null;
          settlement_date?: string;
          expected_arrival?: string | null;
          gross_minor?: number;
          fees_minor?: number;
          refunds_minor?: number;
          chargebacks_minor?: number;
          adjustments_minor?: number;
          net_minor?: number;
          status?: "expected" | "in_transit" | "deposited" | "reconciled" | "exception";
          bank_reference?: string | null;
          notes?: string | null;
          created_by?: string | null;
          reconciled_by?: string | null;
          reconciled_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "settlement_batches_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "settlement_batches_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "settlement_batches_reconciled_by_fkey";
            columns: ["reconciled_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      settlement_payment_links: {
        Row: {
          id: string;
          organization_id: string;
          settlement_id: string;
          payment_id: string;
          amount_minor: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          settlement_id: string;
          payment_id: string;
          amount_minor: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          settlement_id?: string;
          payment_id?: string;
          amount_minor?: number;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "settlement_payment_links_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "settlement_payment_links_payment_id_fkey";
            columns: ["payment_id"];
            isOneToOne: false;
            referencedRelation: "payments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "settlement_payment_links_settlement_id_fkey";
            columns: ["settlement_id"];
            isOneToOne: false;
            referencedRelation: "settlement_batches";
            referencedColumns: ["id"];
          },
        ];
      };
      sms_messages: {
        Row: {
          id: string;
          organization_id: string;
          customer_id: string | null;
          job_id: string | null;
          to_phone: string;
          body: string;
          provider: string | null;
          provider_message_id: string | null;
          status: string;
          error: string | null;
          created_at: string;
          sent_at: string | null;
          direction: "inbound" | "outbound";
          from_phone: string | null;
        };
        Insert: {
          id?: string;
          organization_id: string;
          customer_id?: string | null;
          job_id?: string | null;
          to_phone: string;
          body: string;
          provider?: string | null;
          provider_message_id?: string | null;
          status?: string;
          error?: string | null;
          created_at?: string;
          sent_at?: string | null;
          direction?: "inbound" | "outbound";
          from_phone?: string | null;
        };
        Update: {
          id?: string;
          organization_id?: string;
          customer_id?: string | null;
          job_id?: string | null;
          to_phone?: string;
          body?: string;
          provider?: string | null;
          provider_message_id?: string | null;
          status?: string;
          error?: string | null;
          created_at?: string;
          sent_at?: string | null;
          direction?: "inbound" | "outbound";
          from_phone?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "sms_messages_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sms_messages_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sms_messages_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      staff_notifications: {
        Row: {
          id: string;
          organization_id: string;
          profile_id: string;
          dedupe_key: string;
          type: string;
          title: string;
          body: string;
          url: string | null;
          related_type: string | null;
          related_id: string | null;
          delivery_status: "pending" | "sent" | "inbox_only" | "failed";
          delivery_error: string | null;
          push_delivered: number;
          email_sent_at: string | null;
          read_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          profile_id: string;
          dedupe_key: string;
          type: string;
          title: string;
          body?: string;
          url?: string | null;
          related_type?: string | null;
          related_id?: string | null;
          delivery_status?: "pending" | "sent" | "inbox_only" | "failed";
          delivery_error?: string | null;
          push_delivered?: number;
          email_sent_at?: string | null;
          read_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          profile_id?: string;
          dedupe_key?: string;
          type?: string;
          title?: string;
          body?: string;
          url?: string | null;
          related_type?: string | null;
          related_id?: string | null;
          delivery_status?: "pending" | "sent" | "inbox_only" | "failed";
          delivery_error?: string | null;
          push_delivered?: number;
          email_sent_at?: string | null;
          read_at?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "staff_notifications_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "staff_notifications_profile_id_fkey";
            columns: ["profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      subcontractor_assignments: {
        Row: {
          id: string;
          organization_id: string;
          subcontractor_id: string;
          job_id: string;
          scope: string | null;
          agreed_cost_minor: number;
          status: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          subcontractor_id: string;
          job_id: string;
          scope?: string | null;
          agreed_cost_minor?: number;
          status?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          subcontractor_id?: string;
          job_id?: string;
          scope?: string | null;
          agreed_cost_minor?: number;
          status?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "subcontractor_assignments_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "subcontractor_assignments_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "subcontractor_assignments_subcontractor_id_fkey";
            columns: ["subcontractor_id"];
            isOneToOne: false;
            referencedRelation: "subcontractors";
            referencedColumns: ["id"];
          },
        ];
      };
      subcontractors: {
        Row: {
          id: string;
          organization_id: string;
          company_name: string;
          contact_name: string | null;
          email: string | null;
          phone: string | null;
          trades: string[];
          insurance_expires_on: string | null;
          notes: string | null;
          active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          company_name: string;
          contact_name?: string | null;
          email?: string | null;
          phone?: string | null;
          trades?: string[];
          insurance_expires_on?: string | null;
          notes?: string | null;
          active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          company_name?: string;
          contact_name?: string | null;
          email?: string | null;
          phone?: string | null;
          trades?: string[];
          insurance_expires_on?: string | null;
          notes?: string | null;
          active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "subcontractors_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      subscriptions: {
        Row: {
          organization_id: string;
          stripe_customer_id: string | null;
          stripe_subscription_id: string | null;
          plan: string | null;
          status: Database["public"]["Enums"]["sub_status"];
          trial_end: string | null;
          current_period_end: string | null;
          updated_at: string;
        };
        Insert: {
          organization_id: string;
          stripe_customer_id?: string | null;
          stripe_subscription_id?: string | null;
          plan?: string | null;
          status?: Database["public"]["Enums"]["sub_status"];
          trial_end?: string | null;
          current_period_end?: string | null;
          updated_at?: string;
        };
        Update: {
          organization_id?: string;
          stripe_customer_id?: string | null;
          stripe_subscription_id?: string | null;
          plan?: string | null;
          status?: Database["public"]["Enums"]["sub_status"];
          trial_end?: string | null;
          current_period_end?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "subscriptions_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: true;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      support_cases: {
        Row: {
          id: string;
          organization_id: string | null;
          case_number: number;
          subject: string;
          description: string | null;
          status: "open" | "investigating" | "waiting" | "resolved" | "closed";
          severity: "low" | "normal" | "high" | "critical";
          assigned_to: string | null;
          opened_by: string | null;
          created_at: string;
          updated_at: string;
          resolved_at: string | null;
        };
        Insert: {
          id?: string;
          organization_id?: string | null;
          case_number?: number;
          subject: string;
          description?: string | null;
          status?: "open" | "investigating" | "waiting" | "resolved" | "closed";
          severity?: "low" | "normal" | "high" | "critical";
          assigned_to?: string | null;
          opened_by?: string | null;
          created_at?: string;
          updated_at?: string;
          resolved_at?: string | null;
        };
        Update: {
          id?: string;
          organization_id?: string | null;
          case_number?: number;
          subject?: string;
          description?: string | null;
          status?: "open" | "investigating" | "waiting" | "resolved" | "closed";
          severity?: "low" | "normal" | "high" | "critical";
          assigned_to?: string | null;
          opened_by?: string | null;
          created_at?: string;
          updated_at?: string;
          resolved_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "support_cases_assigned_to_fkey";
            columns: ["assigned_to"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "support_cases_opened_by_fkey";
            columns: ["opened_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "support_cases_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      support_session_events: {
        Row: {
          id: string;
          session_id: string | null;
          organization_id: string;
          admin_user_id: string;
          action: string;
          granted: boolean;
          refusal_reason: string | null;
          details: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          session_id?: string | null;
          organization_id: string;
          admin_user_id: string;
          action: string;
          granted: boolean;
          refusal_reason?: string | null;
          details?: Json;
          created_at?: string;
        };
        Update: {
          id?: string;
          session_id?: string | null;
          organization_id?: string;
          admin_user_id?: string;
          action?: string;
          granted?: boolean;
          refusal_reason?: string | null;
          details?: Json;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "support_session_events_admin_user_id_fkey";
            columns: ["admin_user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "support_session_events_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "support_session_events_session_id_fkey";
            columns: ["session_id"];
            isOneToOne: false;
            referencedRelation: "support_sessions";
            referencedColumns: ["id"];
          },
        ];
      };
      support_sessions: {
        Row: {
          id: string;
          case_id: string;
          organization_id: string;
          admin_user_id: string;
          reason: string;
          access_level: "read_only" | "guided_write";
          starts_at: string;
          expires_at: string;
          revoked_at: string | null;
          revoked_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          case_id: string;
          organization_id: string;
          admin_user_id: string;
          reason: string;
          access_level?: "read_only" | "guided_write";
          starts_at?: string;
          expires_at: string;
          revoked_at?: string | null;
          revoked_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          case_id?: string;
          organization_id?: string;
          admin_user_id?: string;
          reason?: string;
          access_level?: "read_only" | "guided_write";
          starts_at?: string;
          expires_at?: string;
          revoked_at?: string | null;
          revoked_by?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "support_sessions_admin_user_id_fkey";
            columns: ["admin_user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "support_sessions_case_id_fkey";
            columns: ["case_id"];
            isOneToOne: false;
            referencedRelation: "support_cases";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "support_sessions_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "support_sessions_revoked_by_fkey";
            columns: ["revoked_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      sync_outbox_receipts: {
        Row: {
          id: string;
          organization_id: string;
          profile_id: string;
          client_event_id: string;
          job_id: string;
          action_type: string;
          status: "processed" | "rejected";
          processed_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          profile_id: string;
          client_event_id: string;
          job_id: string;
          action_type: string;
          status?: "processed" | "rejected";
          processed_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          profile_id?: string;
          client_event_id?: string;
          job_id?: string;
          action_type?: string;
          status?: "processed" | "rejected";
          processed_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "sync_outbox_receipts_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sync_outbox_receipts_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sync_outbox_receipts_profile_id_fkey";
            columns: ["profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      tax_filings: {
        Row: {
          id: string;
          organization_id: string;
          period_start: string;
          period_end: string;
          due_on: string | null;
          taxable_sales_minor: number;
          exempt_sales_minor: number;
          tax_collected_minor: number;
          tax_remitted_minor: number;
          status: "open" | "ready" | "filed" | "paid" | "overdue";
          filed_on: string | null;
          confirmation_reference: string | null;
          notes: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          period_start: string;
          period_end: string;
          due_on?: string | null;
          taxable_sales_minor?: number;
          exempt_sales_minor?: number;
          tax_collected_minor?: number;
          tax_remitted_minor?: number;
          status?: "open" | "ready" | "filed" | "paid" | "overdue";
          filed_on?: string | null;
          confirmation_reference?: string | null;
          notes?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          period_start?: string;
          period_end?: string;
          due_on?: string | null;
          taxable_sales_minor?: number;
          exempt_sales_minor?: number;
          tax_collected_minor?: number;
          tax_remitted_minor?: number;
          status?: "open" | "ready" | "filed" | "paid" | "overdue";
          filed_on?: string | null;
          confirmation_reference?: string | null;
          notes?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "tax_filings_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tax_filings_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      tax_jurisdictions: {
        Row: {
          id: string;
          organization_id: string;
          name: string;
          code: string | null;
          jurisdiction_type: "state" | "county" | "city" | "district" | "other";
          rate_bps: number;
          applies_to: "all" | "labor" | "materials" | "custom";
          effective_from: string;
          effective_to: string | null;
          active: boolean;
          notes: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          name: string;
          code?: string | null;
          jurisdiction_type?: "state" | "county" | "city" | "district" | "other";
          rate_bps?: number;
          applies_to?: "all" | "labor" | "materials" | "custom";
          effective_from?: string;
          effective_to?: string | null;
          active?: boolean;
          notes?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          name?: string;
          code?: string | null;
          jurisdiction_type?: "state" | "county" | "city" | "district" | "other";
          rate_bps?: number;
          applies_to?: "all" | "labor" | "materials" | "custom";
          effective_from?: string;
          effective_to?: string | null;
          active?: boolean;
          notes?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "tax_jurisdictions_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tax_jurisdictions_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      technician_location_consents: {
        Row: {
          profile_id: string;
          organization_id: string;
          consented: boolean;
          consented_at: string | null;
          revoked_at: string | null;
          updated_at: string;
        };
        Insert: {
          profile_id: string;
          organization_id: string;
          consented?: boolean;
          consented_at?: string | null;
          revoked_at?: string | null;
          updated_at?: string;
        };
        Update: {
          profile_id?: string;
          organization_id?: string;
          consented?: boolean;
          consented_at?: string | null;
          revoked_at?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "technician_location_consents_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "technician_location_consents_profile_id_fkey";
            columns: ["profile_id"];
            isOneToOne: true;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      technician_locations: {
        Row: {
          id: number;
          organization_id: string;
          profile_id: string;
          latitude: number;
          longitude: number;
          accuracy_m: number | null;
          recorded_at: string;
        };
        Insert: {
          id?: number;
          organization_id: string;
          profile_id: string;
          latitude: number;
          longitude: number;
          accuracy_m?: number | null;
          recorded_at?: string;
        };
        Update: {
          id?: number;
          organization_id?: string;
          profile_id?: string;
          latitude?: number;
          longitude?: number;
          accuracy_m?: number | null;
          recorded_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "technician_locations_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "technician_locations_profile_id_fkey";
            columns: ["profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      technician_pay_rates: {
        Row: {
          id: string;
          organization_id: string;
          profile_id: string;
          cost_rate_minor: number;
          effective_from: string;
          note: string | null;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          profile_id: string;
          cost_rate_minor?: number;
          effective_from?: string;
          note?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          profile_id?: string;
          cost_rate_minor?: number;
          effective_from?: string;
          note?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "technician_pay_rates_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "technician_pay_rates_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "technician_pay_rates_profile_id_organization_id_fkey";
            columns: ["profile_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id", "organization_id"];
          },
        ];
      };
      technician_skills: {
        Row: {
          id: string;
          organization_id: string;
          profile_id: string;
          skill_code: string;
          label: string | null;
          certification_number: string | null;
          issued_on: string | null;
          expires_on: string | null;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          profile_id: string;
          skill_code: string;
          label?: string | null;
          certification_number?: string | null;
          issued_on?: string | null;
          expires_on?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          profile_id?: string;
          skill_code?: string;
          label?: string | null;
          certification_number?: string | null;
          issued_on?: string | null;
          expires_on?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "technician_skills_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "technician_skills_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "technician_skills_profile_id_organization_id_fkey";
            columns: ["profile_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id", "organization_id"];
          },
        ];
      };
      technician_time_off: {
        Row: {
          id: string;
          organization_id: string;
          profile_id: string | null;
          starts_on: string;
          ends_on: string;
          start_time: string | null;
          end_time: string | null;
          kind: "time_off" | "vacation" | "sick" | "personal" | "training" | "holiday" | "other";
          status: "requested" | "approved" | "declined";
          note: string | null;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          profile_id?: string | null;
          starts_on: string;
          ends_on: string;
          start_time?: string | null;
          end_time?: string | null;
          kind?: "time_off" | "vacation" | "sick" | "personal" | "training" | "holiday" | "other";
          status?: "requested" | "approved" | "declined";
          note?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          profile_id?: string | null;
          starts_on?: string;
          ends_on?: string;
          start_time?: string | null;
          end_time?: string | null;
          kind?: "time_off" | "vacation" | "sick" | "personal" | "training" | "holiday" | "other";
          status?: "requested" | "approved" | "declined";
          note?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "technician_time_off_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "technician_time_off_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "technician_time_off_profile_id_organization_id_fkey";
            columns: ["profile_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id", "organization_id"];
          },
        ];
      };
      tracked_phone_numbers: {
        Row: {
          id: string;
          organization_id: string;
          provider: string;
          provider_number_id: string | null;
          phone_number: string;
          label: string;
          lead_source: string | null;
          campaign: string | null;
          destination_number: string;
          active: boolean;
          recording_enabled: boolean;
          recording_notice_enabled: boolean;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          provider?: string;
          provider_number_id?: string | null;
          phone_number: string;
          label: string;
          lead_source?: string | null;
          campaign?: string | null;
          destination_number: string;
          active?: boolean;
          recording_enabled?: boolean;
          recording_notice_enabled?: boolean;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          provider?: string;
          provider_number_id?: string | null;
          phone_number?: string;
          label?: string;
          lead_source?: string | null;
          campaign?: string | null;
          destination_number?: string;
          active?: boolean;
          recording_enabled?: boolean;
          recording_notice_enabled?: boolean;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "tracked_phone_numbers_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tracked_phone_numbers_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      vendors: {
        Row: {
          id: string;
          organization_id: string;
          name: string;
          contact_name: string | null;
          email: string | null;
          phone: string | null;
          address: string | null;
          notes: string | null;
          active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          name: string;
          contact_name?: string | null;
          email?: string | null;
          phone?: string | null;
          address?: string | null;
          notes?: string | null;
          active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          name?: string;
          contact_name?: string | null;
          email?: string | null;
          phone?: string | null;
          address?: string | null;
          notes?: string | null;
          active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "vendors_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      warranty_callbacks: {
        Row: {
          id: string;
          organization_id: string;
          warranty_id: string | null;
          original_job_id: string;
          callback_job_id: string | null;
          customer_id: string;
          issue: string;
          priority: "low" | "normal" | "urgent";
          responsibility: "review" | "covered" | "customer" | "manufacturer" | "third_party";
          status: "reported" | "scheduled" | "in_progress" | "resolved" | "denied";
          scheduled_for: string | null;
          resolution: string | null;
          internal_cost_minor: number;
          reported_at: string;
          created_by: string | null;
          resolved_by: string | null;
          resolved_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          warranty_id?: string | null;
          original_job_id: string;
          callback_job_id?: string | null;
          customer_id: string;
          issue: string;
          priority?: "low" | "normal" | "urgent";
          responsibility?: "review" | "covered" | "customer" | "manufacturer" | "third_party";
          status?: "reported" | "scheduled" | "in_progress" | "resolved" | "denied";
          scheduled_for?: string | null;
          resolution?: string | null;
          internal_cost_minor?: number;
          reported_at?: string;
          created_by?: string | null;
          resolved_by?: string | null;
          resolved_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          warranty_id?: string | null;
          original_job_id?: string;
          callback_job_id?: string | null;
          customer_id?: string;
          issue?: string;
          priority?: "low" | "normal" | "urgent";
          responsibility?: "review" | "covered" | "customer" | "manufacturer" | "third_party";
          status?: "reported" | "scheduled" | "in_progress" | "resolved" | "denied";
          scheduled_for?: string | null;
          resolution?: string | null;
          internal_cost_minor?: number;
          reported_at?: string;
          created_by?: string | null;
          resolved_by?: string | null;
          resolved_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "warranty_callbacks_callback_job_id_fkey";
            columns: ["callback_job_id"];
            isOneToOne: true;
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "warranty_callbacks_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "warranty_callbacks_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "warranty_callbacks_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "warranty_callbacks_original_job_id_fkey";
            columns: ["original_job_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "warranty_callbacks_resolved_by_fkey";
            columns: ["resolved_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "warranty_callbacks_warranty_id_fkey";
            columns: ["warranty_id"];
            isOneToOne: false;
            referencedRelation: "job_warranties";
            referencedColumns: ["id"];
          },
        ];
      };
      webhook_events: {
        Row: {
          id: string;
          provider: string;
          event_id: string;
          payload: Json | null;
          received_at: string;
        };
        Insert: {
          id?: string;
          provider: string;
          event_id: string;
          payload?: Json | null;
          received_at?: string;
        };
        Update: {
          id?: string;
          provider?: string;
          event_id?: string;
          payload?: Json | null;
          received_at?: string;
        };
        Relationships: [];
      };
    };
    Views: {};
    Functions: {
      accept_invitation: {
        Args: Record<PropertyKey, never> | { invite_token: string | null };
        Returns: string;
      };
      allocate_document_number: {
        Args: { p_org: string | null; p_kind: string | null };
        Returns: number;
      };
      approve_document: {
        Args: { p_token: string | null; p_name: string | null; p_sig: string | null };
        Returns: boolean;
      };
      approve_document_with_evidence: {
        Args: {
          p_token: string | null;
          p_name: string | null;
          p_sig: string | null;
          p_ip?: string | null;
          p_ip_source?: string | null;
          p_ip_trusted?: boolean | null;
          p_user_agent?: string | null;
          p_device?: string | null;
          p_sig_sha256?: string | null;
        };
        Returns: Json;
      };
      can_refund_payments: {
        Args: Record<PropertyKey, never>;
        Returns: boolean;
      };
      create_org_and_owner: {
        Args: { org_name: string | null; owner_name: string | null };
        Returns: string;
      };
      crew_double_booked: {
        Args: { p_job_id: string | null; p_profile_id: string | null };
        Returns: boolean;
      };
      current_org_id: {
        Args: Record<PropertyKey, never>;
        Returns: string;
      };
      current_user_can: {
        Args: { p_capability: string | null };
        Returns: boolean;
      };
      current_user_role: {
        Args: Record<PropertyKey, never>;
        Returns: Database["public"]["Enums"]["user_role"];
      };
      document_lock_code: {
        Args: {
          p_kind: string | null;
          p_status: string | null;
          p_signed_at: string | null;
          p_sent_at: string | null;
          p_paid_at: string | null;
          p_voided_at: string | null;
        };
        Returns: string;
      };
      document_tax_context: {
        Args: { p_customer: string | null };
        Returns: Json;
      };
      job_labour_cost: {
        Args: { p_job: string | null };
        Returns: Json;
      };
      login_throttle_counts: {
        Args: {
          p_email: string | null;
          p_network?: string | null;
          p_window_minutes?: number | null;
        };
        Returns: Json;
      };
      next_document_number: {
        Args: { p_org: string | null; p_kind: string | null };
        Returns: number;
      };
      pending_invitation_hint: {
        Args: Record<PropertyKey, never>;
        Returns: { organization_name: string; invited_email: string; expires_at: string }[];
      };
      public_appointment: {
        Args: { p_token: string | null };
        Returns: Json;
      };
      public_booking_info: {
        Args: { p_org: string | null };
        Returns: Json;
      };
      public_booking_info_v2: {
        Args: { p_org: string | null };
        Returns: Json;
      };
      public_customer_portal: {
        Args: { p_token: string | null };
        Returns: Json;
      };
      public_document: {
        Args: { p_token: string | null };
        Returns: Json;
      };
      public_document_correction: {
        Args: { p_token: string | null };
        Returns: Json;
      };
      public_payment_options: {
        Args: { p_token: string | null };
        Returns: Json;
      };
      public_tip_options: {
        Args: { p_token: string | null };
        Returns: Json;
      };
      receive_purchase_order_line: {
        Args: { p_line: string | null; p_qty_milli: number | null };
        Returns: { line_received_qty_milli: number; po_status: string }[];
      };
      record_login_attempt: {
        Args: {
          p_email: string | null;
          p_success: boolean | null;
          p_reason?: string | null;
          p_ip?: string | null;
          p_ip_source?: string | null;
          p_ip_trusted?: boolean | null;
          p_network?: string | null;
          p_user_agent?: string | null;
          p_device?: string | null;
        };
        Returns: number;
      };
      release_document_number: {
        Args: { p_org: string | null; p_kind: string | null; p_number: number | null };
        Returns: boolean;
      };
      repair_booking_service_names: {
        Args: { p_org?: string | null };
        Returns: number;
      };
      resolve_booking_service_names: {
        Args: {
          p_name: string | null;
          p_name_en: string | null;
          p_name_he: string | null;
          p_pack_item_key: string | null;
        };
        Returns: { resolved_en: string; resolved_he: string }[];
      };
      respond_to_appointment: {
        Args: { p_token: string | null; p_response: string | null; p_note?: string | null };
        Returns: Json;
      };
      rotate_customer_portal_token: {
        Args: { p_customer: string | null };
        Returns: string;
      };
      safe_inet: {
        Args: { p_value: string | null };
        Returns: string;
      };
      schedule_warranty_callback: {
        Args: {
          p_callback_id: string | null;
          p_date: string | null;
          p_start?: string | null;
          p_end?: string | null;
          p_assigned_to?: string | null;
        };
        Returns: string;
      };
      select_estimate_option: {
        Args: { p_token: string | null; p_option: string | null; p_by?: string | null };
        Returns: Json;
      };
      stamp_permission_change_context: {
        Args: {
          p_subject: string | null;
          p_since: string | null;
          p_ip: string | null;
          p_user_agent: string | null;
        };
        Returns: number;
      };
      submit_booking: {
        Args: {
          p_org: string | null;
          p_name: string | null;
          p_phone: string | null;
          p_email: string | null;
          p_address: string | null;
          p_city: string | null;
          p_service: string | null;
          p_notes: string | null;
          p_date: string | null;
        };
        Returns: boolean;
      };
      submit_customer_portal_request: {
        Args: {
          p_token: string | null;
          p_type: string | null;
          p_job?: string | null;
          p_date?: string | null;
          p_message?: string | null;
          p_email_opt_in?: boolean | null;
          p_sms_opt_in?: boolean | null;
        };
        Returns: boolean;
      };
    };
    Enums: {
      estimate_status: "draft" | "sent" | "approved" | "rejected";
      invoice_status: "unpaid" | "paid" | "void";
      job_status: "scheduled" | "in_progress" | "done" | "cancelled";
      message_type: "before" | "onway" | "after" | "review" | "manual";
      sub_status: "trialing" | "active" | "past_due" | "canceled" | "incomplete";
      user_role: "owner" | "office" | "tech";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

/** A row as it comes back from a plain `select()` — e.g. `Tables<"invoices">`. */
export type Tables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"];

/** The shape `insert()` accepts: defaults and nullables optional, generated columns forbidden. */
export type TablesInsert<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Insert"];

/** The shape `update()` accepts — every column optional. */
export type TablesUpdate<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Update"];

/** A Postgres enum, e.g. `Enums<"invoice_status">` is `"unpaid" | "paid" | "void"`. */
export type Enums<T extends keyof Database["public"]["Enums"]> = Database["public"]["Enums"][T];
