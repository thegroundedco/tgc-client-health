export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      ai_runs: {
        Row: {
          client_ids: number[] | null
          finished_at: string | null
          id: number
          overwrite_client_ids: number[]
          period: string
          requested_at: string
          requested_by: string | null
          requested_by_name: string | null
          session_url: string | null
          source: string
          status: string
          summary: string | null
        }
        Insert: {
          client_ids?: number[] | null
          finished_at?: string | null
          id?: never
          overwrite_client_ids?: number[]
          period: string
          requested_at?: string
          requested_by?: string | null
          requested_by_name?: string | null
          session_url?: string | null
          source: string
          status?: string
          summary?: string | null
        }
        Update: {
          client_ids?: number[] | null
          finished_at?: string | null
          id?: never
          overwrite_client_ids?: number[]
          period?: string
          requested_at?: string
          requested_by?: string | null
          requested_by_name?: string | null
          session_url?: string | null
          source?: string
          status?: string
          summary?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_runs_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      allowed_emails: {
        Row: {
          created_at: string
          created_by: string | null
          email: string
          role: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          email: string
          role?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          email?: string
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "allowed_emails_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      // Hand-maintained. The four adv_* columns became smallint on 2026-08-31 (spec
      // §5.2); they are `number | null` here for the same reason every other answer
      // is. `advocacy_applies` on checkin_scores stays boolean -- it is the gate's
      // verdict, not somebody's answer.
      checkins: {
        Row: {
          adv_case_study: number | null
          adv_left_review: number | null
          adv_reference_check: number | null
          adv_score: number | null
          adv_would_refer: number | null
          ai_suggestion: Json | null
          bucket_notes: Json
          client_id: number
          comm_consistent: number | null
          comm_constructive: number | null
          comm_score: number | null
          comm_timely: number | null
          created_at: string
          del_client_likes: number | null
          del_on_time: number | null
          del_quantity: number | null
          del_score: number | null
          del_we_are_proud: number | null
          fin_hours_applies: boolean
          fin_hours_in_budget: number | null
          fin_pays_on_time: number | null
          fin_rack_rate: number | null
          fin_rate_increased: number | null
          fin_score: number | null
          focus: string | null
          growth_goals_defined: number | null
          growth_hitting_goals: number | null
          growth_progress_trackable: number | null
          growth_score: number | null
          id: number
          legacy_delivery: number | null
          legacy_financial: number | null
          legacy_growth: number | null
          legacy_relationship: number | null
          legacy_sentiment: number | null
          legacy_total_score: number | null
          notes: string | null
          period: string
          rel_collaborative: number | null
          rel_fun: number | null
          rel_multi_threaded: number | null
          rel_respectful: number | null
          rel_score: number | null
          submitted_at: string | null
          submitted_by: string | null
          suggested_at: string | null
          updated_at: string
        }
        Insert: {
          adv_case_study?: number | null
          adv_left_review?: number | null
          adv_reference_check?: number | null
          adv_score?: number | null
          adv_would_refer?: number | null
          ai_suggestion?: Json | null
          bucket_notes?: Json
          client_id: number
          comm_consistent?: number | null
          comm_constructive?: number | null
          comm_score?: number | null
          comm_timely?: number | null
          created_at?: string
          del_client_likes?: number | null
          del_on_time?: number | null
          del_quantity?: number | null
          del_score?: number | null
          del_we_are_proud?: number | null
          fin_hours_applies?: boolean
          fin_hours_in_budget?: number | null
          fin_pays_on_time?: number | null
          fin_rack_rate?: number | null
          fin_rate_increased?: number | null
          fin_score?: number | null
          focus?: string | null
          growth_goals_defined?: number | null
          growth_hitting_goals?: number | null
          growth_progress_trackable?: number | null
          growth_score?: number | null
          id?: never
          legacy_delivery?: number | null
          legacy_financial?: number | null
          legacy_growth?: number | null
          legacy_relationship?: number | null
          legacy_sentiment?: number | null
          legacy_total_score?: number | null
          notes?: string | null
          period: string
          rel_collaborative?: number | null
          rel_fun?: number | null
          rel_multi_threaded?: number | null
          rel_respectful?: number | null
          rel_score?: number | null
          submitted_at?: string | null
          submitted_by?: string | null
          suggested_at?: string | null
          updated_at?: string
        }
        Update: {
          adv_case_study?: number | null
          adv_left_review?: number | null
          adv_reference_check?: number | null
          adv_score?: number | null
          adv_would_refer?: number | null
          ai_suggestion?: Json | null
          bucket_notes?: Json
          client_id?: number
          comm_consistent?: number | null
          comm_constructive?: number | null
          comm_score?: number | null
          comm_timely?: number | null
          created_at?: string
          del_client_likes?: number | null
          del_on_time?: number | null
          del_quantity?: number | null
          del_score?: number | null
          del_we_are_proud?: number | null
          fin_hours_applies?: boolean
          fin_hours_in_budget?: number | null
          fin_pays_on_time?: number | null
          fin_rack_rate?: number | null
          fin_rate_increased?: number | null
          fin_score?: number | null
          focus?: string | null
          growth_goals_defined?: number | null
          growth_hitting_goals?: number | null
          growth_progress_trackable?: number | null
          growth_score?: number | null
          id?: never
          legacy_delivery?: number | null
          legacy_financial?: number | null
          legacy_growth?: number | null
          legacy_relationship?: number | null
          legacy_sentiment?: number | null
          legacy_total_score?: number | null
          notes?: string | null
          period?: string
          rel_collaborative?: number | null
          rel_fun?: number | null
          rel_multi_threaded?: number | null
          rel_respectful?: number | null
          rel_score?: number | null
          submitted_at?: string | null
          submitted_by?: string | null
          suggested_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "checkins_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checkins_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      client_month_budgets: {
        Row: {
          budgeted_minutes: number
          client_id: number
          ends_on: string
          name: string
          period: string
          productive_deal_id: string
          productive_project_id: string
          starts_on: string
          worked_minutes: number
        }
        Insert: {
          budgeted_minutes: number
          client_id: number
          ends_on: string
          name: string
          period: string
          productive_deal_id: string
          productive_project_id: string
          starts_on: string
          worked_minutes: number
        }
        Update: {
          budgeted_minutes?: number
          client_id?: number
          ends_on?: string
          name?: string
          period?: string
          productive_deal_id?: string
          productive_project_id?: string
          starts_on?: string
          worked_minutes?: number
        }
        Relationships: [
          {
            foreignKeyName: "client_month_budgets_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_month_hours_fetch: {
        Row: {
          client_id: number
          fetched_at: string
          period: string
        }
        Insert: {
          client_id: number
          fetched_at: string
          period: string
        }
        Update: {
          client_id?: number
          fetched_at?: string
          period?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_month_hours_fetch_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_month_project_items: {
        Row: {
          cents: number
          client_id: number
          created_at: string
          id: number
          label: string
          period: string
          position: number
        }
        Insert: {
          cents: number
          client_id: number
          created_at?: string
          id?: never
          label: string
          period: string
          position?: number
        }
        Update: {
          cents?: number
          client_id?: number
          created_at?: string
          id?: never
          label?: string
          period?: string
          position?: number
        }
        Relationships: [
          {
            foreignKeyName: "client_month_project_items_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_month_revenue: {
        Row: {
          client_id: number
          created_at: string
          entered_by: string | null
          period: string
          project_cents: number
          project_notes: string | null
          retainer_cents: number
          updated_at: string
        }
        Insert: {
          client_id: number
          created_at?: string
          entered_by?: string | null
          period: string
          project_cents?: number
          project_notes?: string | null
          retainer_cents?: number
          updated_at?: string
        }
        Update: {
          client_id?: number
          created_at?: string
          entered_by?: string | null
          period?: string
          project_cents?: number
          project_notes?: string | null
          retainer_cents?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_month_revenue_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_month_revenue_entered_by_fkey"
            columns: ["entered_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      client_packages: {
        Row: {
          client_id: number
          created_at: string
          id: number
          note: string | null
          package_code: string
          started_on: string
          updated_at: string
        }
        Insert: {
          client_id: number
          created_at?: string
          id?: never
          note?: string | null
          package_code: string
          started_on: string
          updated_at?: string
        }
        Update: {
          client_id?: number
          created_at?: string
          id?: never
          note?: string | null
          package_code?: string
          started_on?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_packages_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_productive_projects: {
        Row: {
          client_id: number
          created_at: string
          productive_project_id: string
        }
        Insert: {
          client_id: number
          created_at?: string
          productive_project_id: string
        }
        Update: {
          client_id?: number
          created_at?: string
          productive_project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_productive_projects_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_retainers: {
        Row: {
          client_id: number
          monthly_cents: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          client_id: number
          monthly_cents: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          client_id?: number
          monthly_cents?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_retainers_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: true
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_retainers_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          created_at: string
          end_reason_code: string | null
          end_reason_note: string | null
          ended_on: string | null
          id: number
          name: string
          note: string | null
          owner_id: string | null
          started_on: string | null
          status: string
          type_code: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          end_reason_code?: string | null
          end_reason_note?: string | null
          ended_on?: string | null
          id?: never
          name: string
          note?: string | null
          owner_id?: string | null
          started_on?: string | null
          status?: string
          type_code?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          end_reason_code?: string | null
          end_reason_note?: string | null
          ended_on?: string | null
          id?: never
          name?: string
          note?: string | null
          owner_id?: string | null
          started_on?: string | null
          status?: string
          type_code?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "clients_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string
          full_name: string | null
          id: string
          is_active: boolean
          role: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          email: string
          full_name?: string | null
          id: string
          is_active?: boolean
          role?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          full_name?: string | null
          id?: string
          is_active?: boolean
          role?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      checkin_scores: {
        Row: {
          adv_score: number | null
          advocacy_applies: boolean | null
          client_id: number | null
          comm_score: number | null
          del_score: number | null
          fin_score: number | null
          growth_score: number | null
          id: number | null
          overall_score: number | null
          period: string | null
          rel_score: number | null
        }
        Relationships: [
          {
            foreignKeyName: "checkins_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      can_run_ai_suggestions: { Args: never; Returns: boolean }
      can_view_revenue: { Args: never; Returns: boolean }
      record_month_budgets: {
        Args: { p_budgets: Json; p_client_id: number; p_period: string }
        Returns: undefined
      }
      save_month_payment: {
        Args: {
          p_client_id: number
          p_items?: Json
          p_period: string
          p_project_cents: number
          p_project_notes?: string | null
          p_retainer_cents: number
          p_set_retainer: boolean
        }
        Returns: undefined
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
