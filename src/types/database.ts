/**
 * Canonical Database Types for Supabase Client
 *
 * Source: docs/DATABASE_SCHEMA.md (v1.1) and docs/API_SPEC.md (v1.2)
 * All 12 canonical tables, column types, nullability, defaults, and relations.
 *
 * Strictly adheres to the database contract approved in Milestone M0.
 * Do not edit column definitions or constraints without formal specification updates.
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

/* -------------------------------------------------------------------------- */
/* Database String Literal Unions / Column Check Constraints                   */
/* -------------------------------------------------------------------------- */

export type DatabaseBusinessCategory = 'salon' | 'cafe';

export type DatabaseAccountStatus = 'active' | 'pilot' | 'suspended';

export type DatabaseSentimentLabel = 'positive' | 'neutral' | 'negative';

export type DatabaseAnalyticsEventName =
  | 'EVENT_QR_PAGE_VIEW'
  | 'EVENT_SURVEY_COMPLETED'
  | 'EVENT_GENERATION_REQUESTED'
  | 'EVENT_GENERATION_SUCCESS'
  | 'EVENT_COPY_ATTEMPTED'
  | 'EVENT_COPY_SUCCESS'
  | 'EVENT_GOOGLE_REDIRECT_CLICK'
  | 'EVENT_GOOGLE_BYPASS_CLICK';

export type DatabaseUserAgentCategory = 'mobile' | 'desktop' | 'tablet';

export type DatabasePlanTier = 'setup_package' | 'standard_recurring';

export type DatabaseSubscriptionStatus = 'pilot' | 'active' | 'past_due' | 'canceled';

export type DatabaseReservationStatus = 'pending' | 'committed' | 'released' | 'expired';

export type DatabaseAdminRole = 'super_admin';

export type DatabaseActorRole = 'super_admin' | 'owner' | 'system';

/* -------------------------------------------------------------------------- */
/* Master Supabase Database Interface                                         */
/* -------------------------------------------------------------------------- */

export interface Database {
  public: {
    Tables: {
      business_categories: {
        Row: {
          id: string;
          display_name: string;
          description: string | null;
          is_active: boolean;
          created_at: string;
        };
        Insert: {
          id: string;
          display_name: string;
          description?: string | null;
          is_active?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          display_name?: string;
          description?: string | null;
          is_active?: boolean;
          created_at?: string;
        };
        Relationships: [];
      };

      businesses: {
        Row: {
          id: string;
          owner_id: string;
          category_id: string;
          public_qr_id: string;
          vanity_slug: string;
          name: string;
          logo_url: string | null;
          google_place_id: string | null;
          google_review_url: string | null;
          whatsapp_number: string | null;
          account_status: DatabaseAccountStatus;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          owner_id: string;
          category_id: string;
          public_qr_id: string;
          vanity_slug: string;
          name: string;
          logo_url?: string | null;
          google_place_id?: string | null;
          google_review_url?: string | null;
          whatsapp_number?: string | null;
          account_status?: DatabaseAccountStatus;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          owner_id?: string;
          category_id?: string;
          public_qr_id?: string;
          vanity_slug?: string;
          name?: string;
          logo_url?: string | null;
          google_place_id?: string | null;
          google_review_url?: string | null;
          whatsapp_number?: string | null;
          account_status?: DatabaseAccountStatus;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'businesses_category_id_fkey';
            columns: ['category_id'];
            isOneToOne: false;
            referencedRelation: 'business_categories';
            referencedColumns: ['id'];
          },
        ];
      };

      survey_questions: {
        Row: {
          id: string;
          category_id: string;
          question_text: string;
          display_order: number;
          is_active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          category_id: string;
          question_text: string;
          display_order?: number;
          is_active?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          category_id?: string;
          question_text?: string;
          display_order?: number;
          is_active?: boolean;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'survey_questions_category_id_fkey';
            columns: ['category_id'];
            isOneToOne: false;
            referencedRelation: 'business_categories';
            referencedColumns: ['id'];
          },
        ];
      };

      survey_options: {
        Row: {
          id: string;
          question_id: string;
          option_text: string;
          emoji_anchor: string;
          sentiment_label: DatabaseSentimentLabel;
          is_neutral_na: boolean;
          is_active: boolean;
          display_order: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          question_id: string;
          option_text: string;
          emoji_anchor?: string;
          sentiment_label?: DatabaseSentimentLabel;
          is_neutral_na?: boolean;
          is_active?: boolean;
          display_order?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          question_id?: string;
          option_text?: string;
          emoji_anchor?: string;
          sentiment_label?: DatabaseSentimentLabel;
          is_neutral_na?: boolean;
          is_active?: boolean;
          display_order?: number;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'survey_options_question_id_fkey';
            columns: ['question_id'];
            isOneToOne: false;
            referencedRelation: 'survey_questions';
            referencedColumns: ['id'];
          },
        ];
      };

      survey_responses: {
        Row: {
          id: string;
          business_id: string;
          category_id: string;
          selected_options: Json;
          affirmed_facts_snapshot: Json;
          optional_note: string | null;
          session_uuid: string;
          purged_at: string | null;
          created_at: string;
          is_generated: boolean;
          generation_attempts: number;
        };
        Insert: {
          id?: string;
          business_id: string;
          category_id: string;
          selected_options?: Json;
          affirmed_facts_snapshot?: Json;
          optional_note?: string | null;
          session_uuid: string;
          purged_at?: string | null;
          created_at?: string;
          is_generated?: boolean;
          generation_attempts?: number;
        };
        Update: {
          id?: string;
          business_id?: string;
          category_id?: string;
          selected_options?: Json;
          affirmed_facts_snapshot?: Json;
          optional_note?: string | null;
          session_uuid?: string;
          purged_at?: string | null;
          created_at?: string;
          is_generated?: boolean;
          generation_attempts?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'survey_responses_business_id_fkey';
            columns: ['business_id'];
            isOneToOne: false;
            referencedRelation: 'businesses';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'survey_responses_category_id_fkey';
            columns: ['category_id'];
            isOneToOne: false;
            referencedRelation: 'business_categories';
            referencedColumns: ['id'];
          },
        ];
      };

      analytics_events: {
        Row: {
          id: string;
          business_id: string;
          event_name: DatabaseAnalyticsEventName;
          session_uuid: string;
          user_agent_category: DatabaseUserAgentCategory;
          deduplication_key: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          business_id: string;
          event_name: DatabaseAnalyticsEventName;
          session_uuid: string;
          user_agent_category?: DatabaseUserAgentCategory;
          deduplication_key: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          business_id?: string;
          event_name?: DatabaseAnalyticsEventName;
          session_uuid?: string;
          user_agent_category?: DatabaseUserAgentCategory;
          deduplication_key?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'analytics_events_business_id_fkey';
            columns: ['business_id'];
            isOneToOne: false;
            referencedRelation: 'businesses';
            referencedColumns: ['id'];
          },
        ];
      };

      subscriptions: {
        Row: {
          id: string;
          business_id: string;
          plan_tier: DatabasePlanTier;
          subscription_status: DatabaseSubscriptionStatus;
          trial_ends_at: string | null;
          current_period_starts_at: string;
          current_period_ends_at: string;
          billing_currency: string;
          last_payment_amount: number | null;
          last_payment_recorded_at: string | null;
          payment_reference: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          business_id: string;
          plan_tier?: DatabasePlanTier;
          subscription_status?: DatabaseSubscriptionStatus;
          trial_ends_at?: string | null;
          current_period_starts_at?: string;
          current_period_ends_at?: string;
          billing_currency?: string;
          last_payment_amount?: number | null;
          last_payment_recorded_at?: string | null;
          payment_reference?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          business_id?: string;
          plan_tier?: DatabasePlanTier;
          subscription_status?: DatabaseSubscriptionStatus;
          trial_ends_at?: string | null;
          current_period_starts_at?: string;
          current_period_ends_at?: string;
          billing_currency?: string;
          last_payment_amount?: number | null;
          last_payment_recorded_at?: string | null;
          payment_reference?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'subscriptions_business_id_fkey';
            columns: ['business_id'];
            isOneToOne: true;
            referencedRelation: 'businesses';
            referencedColumns: ['id'];
          },
        ];
      };

      tenant_quotas: {
        Row: {
          id: string;
          business_id: string;
          billing_cycle: string;
          max_limit: number;
          used_count: number;
          reserved_count: number;
          reset_at: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          business_id: string;
          billing_cycle: string;
          max_limit?: number;
          used_count?: number;
          reserved_count?: number;
          reset_at: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          business_id?: string;
          billing_cycle?: string;
          max_limit?: number;
          used_count?: number;
          reserved_count?: number;
          reset_at?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'tenant_quotas_business_id_fkey';
            columns: ['business_id'];
            isOneToOne: false;
            referencedRelation: 'businesses';
            referencedColumns: ['id'];
          },
        ];
      };

      quota_reservations: {
        Row: {
          id: string;
          business_id: string;
          quota_id: string;
          response_id: string;
          idempotency_key: string;
          payload_hash: string;
          status: DatabaseReservationStatus;
          tokens_billed: number;
          raw_draft: string | null;
          ttl_expires_at: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          business_id: string;
          quota_id: string;
          response_id: string;
          idempotency_key: string;
          payload_hash: string;
          status?: DatabaseReservationStatus;
          tokens_billed?: number;
          raw_draft?: string | null;
          ttl_expires_at: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          business_id?: string;
          quota_id?: string;
          response_id?: string;
          idempotency_key?: string;
          payload_hash?: string;
          status?: DatabaseReservationStatus;
          tokens_billed?: number;
          raw_draft?: string | null;
          ttl_expires_at?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'quota_reservations_business_id_fkey';
            columns: ['business_id'];
            isOneToOne: false;
            referencedRelation: 'businesses';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'quota_reservations_quota_id_fkey';
            columns: ['quota_id'];
            isOneToOne: false;
            referencedRelation: 'tenant_quotas';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'quota_reservations_response_id_fkey';
            columns: ['response_id'];
            isOneToOne: false;
            referencedRelation: 'survey_responses';
            referencedColumns: ['id'];
          },
        ];
      };

      rate_limit_buckets: {
        Row: {
          key_hash: string;
          window_start: string;
          request_count: number;
          expires_at: string;
        };
        Insert: {
          key_hash: string;
          window_start: string;
          request_count?: number;
          expires_at: string;
        };
        Update: {
          key_hash?: string;
          window_start?: string;
          request_count?: number;
          expires_at?: string;
        };
        Relationships: [];
      };

      admin_users: {
        Row: {
          user_id: string;
          role: DatabaseAdminRole;
          is_active: boolean;
          mfa_enforced: boolean;
          created_at: string;
        };
        Insert: {
          user_id: string;
          role?: DatabaseAdminRole;
          is_active?: boolean;
          mfa_enforced?: boolean;
          created_at?: string;
        };
        Update: {
          user_id?: string;
          role?: DatabaseAdminRole;
          is_active?: boolean;
          mfa_enforced?: boolean;
          created_at?: string;
        };
        Relationships: [];
      };

      admin_audit_logs: {
        Row: {
          id: string;
          actor_user_id: string | null;
          actor_role: DatabaseActorRole;
          target_business_id: string | null;
          action: string;
          payload_before: Json | null;
          payload_after: Json | null;
          ip_hash: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          actor_user_id?: string | null;
          actor_role: DatabaseActorRole;
          target_business_id?: string | null;
          action: string;
          payload_before?: Json | null;
          payload_after?: Json | null;
          ip_hash?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          actor_user_id?: string | null;
          actor_role?: DatabaseActorRole;
          target_business_id?: string | null;
          action?: string;
          payload_before?: Json | null;
          payload_after?: Json | null;
          ip_hash?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'admin_audit_logs_target_business_id_fkey';
            columns: ['target_business_id'];
            isOneToOne: false;
            referencedRelation: 'businesses';
            referencedColumns: ['id'];
          },
        ];
      };
      rate_limit_events: {
        Row: {
          id: string;
          key_hash: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          key_hash: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          key_hash?: string;
          created_at?: string;
        };
        Relationships: [];
      };
    };

    Views: {
      [_ in never]: never;
    };

    Functions: {
      get_public_business_by_qr: {
        Args: {
          p_qr_id: string;
        };
        Returns: {
          public_qr_id: string;
          name: string;
          logo_url: string | null;
          category_id: string;
          google_review_url: string | null;
          whatsapp_number: string | null;
          is_active: boolean;
          account_status: string;
          subscription_status: string;
          is_direct_google_only: boolean;
          is_suspended: boolean;
        }[];
      };
      check_exact_rate_limit: {
        Args: {
          p_key_hash: string;
          p_prev_key_hash?: string | null;
          p_max_requests?: number;
          p_window_seconds?: number;
        };
        Returns: boolean;
      };
      purge_expired_rate_limit_events: {
        Args: {
          p_retention_seconds?: number;
          p_batch_limit?: number;
        };
        Returns: number;
      };
      reserve_generation_quota: {
        Args: {
          p_business_id: string;
          p_idempotency_key: string;
          p_payload_hash: string;
        };
        Returns: string;
      };
      commit_generation_quota: {
        Args: {
          p_reservation_id: string;
          p_tokens_billed: number;
        };
        Returns: undefined;
      };
      release_generation_quota: {
        Args: {
          p_reservation_id: string;
        };
        Returns: undefined;
      };
      check_rate_limit: {
        Args: {
          p_key_hash: string;
          p_max_requests: number;
          p_window_seconds?: number;
        };
        Returns: boolean;
      };
      admin_execute_operation: {
        Args: {
          p_admin_user_id: string;
          p_action: string;
          p_target_business_id: string;
          p_payload: Json;
        };
        Returns: Json;
      };
      purge_expired_reservations: {
        Args: Record<PropertyKey, never>;
        Returns: number;
      };
      purge_expired_notes: {
        Args: Record<PropertyKey, never>;
        Returns: number;
      };
    };

    Enums: {
      business_category_id: DatabaseBusinessCategory;
      account_status: DatabaseAccountStatus;
      sentiment_label: DatabaseSentimentLabel;
      analytics_event_name: DatabaseAnalyticsEventName;
      user_agent_category: DatabaseUserAgentCategory;
      plan_tier: DatabasePlanTier;
      subscription_status: DatabaseSubscriptionStatus;
      reservation_status: DatabaseReservationStatus;
      admin_role: DatabaseAdminRole;
      actor_role: DatabaseActorRole;
    };

    CompositeTypes: {
      [_ in never]: never;
    };
  };
}

/* -------------------------------------------------------------------------- */
/* Convenience Table Row / Insert / Update Types                              */
/* -------------------------------------------------------------------------- */

export type Tables<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Row'];

export type TablesInsert<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Insert'];

export type TablesUpdate<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Update'];

// Row types
export type BusinessCategoryRow = Tables<'business_categories'>;
export type BusinessRow = Tables<'businesses'>;
export type SurveyQuestionRow = Tables<'survey_questions'>;
export type SurveyOptionRow = Tables<'survey_options'>;
export type SurveyResponseRow = Tables<'survey_responses'>;
export type AnalyticsEventRow = Tables<'analytics_events'>;
export type SubscriptionRow = Tables<'subscriptions'>;
export type TenantQuotaRow = Tables<'tenant_quotas'>;
export type QuotaReservationRow = Tables<'quota_reservations'>;
export type RateLimitBucketRow = Tables<'rate_limit_buckets'>;
export type AdminUserRow = Tables<'admin_users'>;
export type AdminAuditLogRow = Tables<'admin_audit_logs'>;

// Insert types
export type BusinessCategoryInsert = TablesInsert<'business_categories'>;
export type BusinessInsert = TablesInsert<'businesses'>;
export type SurveyQuestionInsert = TablesInsert<'survey_questions'>;
export type SurveyOptionInsert = TablesInsert<'survey_options'>;
export type SurveyResponseInsert = TablesInsert<'survey_responses'>;
export type AnalyticsEventInsert = TablesInsert<'analytics_events'>;
export type SubscriptionInsert = TablesInsert<'subscriptions'>;
export type TenantQuotaInsert = TablesInsert<'tenant_quotas'>;
export type QuotaReservationInsert = TablesInsert<'quota_reservations'>;
export type RateLimitBucketInsert = TablesInsert<'rate_limit_buckets'>;
export type AdminUserInsert = TablesInsert<'admin_users'>;
export type AdminAuditLogInsert = TablesInsert<'admin_audit_logs'>;

// Update types
export type BusinessCategoryUpdate = TablesUpdate<'business_categories'>;
export type BusinessUpdate = TablesUpdate<'businesses'>;
export type SurveyQuestionUpdate = TablesUpdate<'survey_questions'>;
export type SurveyOptionUpdate = TablesUpdate<'survey_options'>;
export type SurveyResponseUpdate = TablesUpdate<'survey_responses'>;
export type AnalyticsEventUpdate = TablesUpdate<'analytics_events'>;
export type SubscriptionUpdate = TablesUpdate<'subscriptions'>;
export type TenantQuotaUpdate = TablesUpdate<'tenant_quotas'>;
export type QuotaReservationUpdate = TablesUpdate<'quota_reservations'>;
export type RateLimitBucketUpdate = TablesUpdate<'rate_limit_buckets'>;
export type AdminUserUpdate = TablesUpdate<'admin_users'>;
export type AdminAuditLogUpdate = TablesUpdate<'admin_audit_logs'>;
