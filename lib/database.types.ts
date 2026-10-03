export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      analyses: {
        Row: {
          is_seed: boolean
          attempt_id: string
          stage: string
          message: string
          updated_at: string
          commit_sha: string | null
          parser_metadata: Json | null
          created_at: string
          id: string
          organization_id: string
          project_id: string
          state: Database["public"]["Enums"]["analysis_state"]
        }
        Insert: {
          is_seed?: boolean
          attempt_id?: string
          stage?: string
          message?: string
          updated_at?: string
          commit_sha?: string | null
          parser_metadata?: Json | null
          created_at?: string
          id?: string
          organization_id: string
          project_id: string
          state?: Database["public"]["Enums"]["analysis_state"]
        }
        Update: {
          is_seed?: boolean
          attempt_id?: string
          stage?: string
          message?: string
          updated_at?: string
          commit_sha?: string | null
          parser_metadata?: Json | null
          created_at?: string
          id?: string
          organization_id?: string
          project_id?: string
          state?: Database["public"]["Enums"]["analysis_state"]
        }
        Relationships: [
          {
            foreignKeyName: "analyses_project_fk"
            columns: ["organization_id", "project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      edges: {
        Row: {
          kind: string
          analysis_id: string
          id: string
          organization_id: string
          source_file_id: string
          target_file_id: string
        }
        Insert: {
          kind?: string
          analysis_id: string
          id?: string
          organization_id: string
          source_file_id: string
          target_file_id: string
        }
        Update: {
          kind?: string
          analysis_id?: string
          id?: string
          organization_id?: string
          source_file_id?: string
          target_file_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "edges_analysis_fk"
            columns: ["organization_id", "analysis_id"]
            isOneToOne: false
            referencedRelation: "analyses"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "edges_source_file_fk"
            columns: ["organization_id", "analysis_id", "source_file_id"]
            isOneToOne: false
            referencedRelation: "files"
            referencedColumns: ["organization_id", "analysis_id", "id"]
          },
          {
            foreignKeyName: "edges_target_file_fk"
            columns: ["organization_id", "analysis_id", "target_file_id"]
            isOneToOne: false
            referencedRelation: "files"
            referencedColumns: ["organization_id", "analysis_id", "id"]
          },
        ]
      }
      explanations: {
        Row: {
          analysis_id: string
          body: string
          id: string
          organization_id: string
        }
        Insert: {
          analysis_id: string
          body: string
          id?: string
          organization_id: string
        }
        Update: {
          analysis_id?: string
          body?: string
          id?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "explanations_analysis_fk"
            columns: ["organization_id", "analysis_id"]
            isOneToOne: false
            referencedRelation: "analyses"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      file_roles: {
        Row: {
          analysis_id: string
          file_id: string
          id: string
          organization_id: string
          role: string
        }
        Insert: {
          analysis_id: string
          file_id: string
          id?: string
          organization_id: string
          role: string
        }
        Update: {
          analysis_id?: string
          file_id?: string
          id?: string
          organization_id?: string
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "file_roles_analysis_fk"
            columns: ["organization_id", "analysis_id"]
            isOneToOne: false
            referencedRelation: "analyses"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "file_roles_file_fk"
            columns: ["organization_id", "analysis_id", "file_id"]
            isOneToOne: false
            referencedRelation: "files"
            referencedColumns: ["organization_id", "analysis_id", "id"]
          },
        ]
      }
      files: {
        Row: {
          node: Json | null
          analysis_id: string
          id: string
          organization_id: string
          path: string
        }
        Insert: {
          node?: Json | null
          analysis_id: string
          id?: string
          organization_id: string
          path: string
        }
        Update: {
          node?: Json | null
          analysis_id?: string
          id?: string
          organization_id?: string
          path?: string
        }
        Relationships: [
          {
            foreignKeyName: "files_analysis_fk"
            columns: ["organization_id", "analysis_id"]
            isOneToOne: false
            referencedRelation: "analyses"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      insights: {
        Row: {
          analysis_id: string
          body: string
          id: string
          organization_id: string
        }
        Insert: {
          analysis_id: string
          body: string
          id?: string
          organization_id: string
        }
        Update: {
          analysis_id?: string
          body?: string
          id?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "insights_analysis_fk"
            columns: ["organization_id", "analysis_id"]
            isOneToOne: false
            referencedRelation: "analyses"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      projects: {
        Row: {
          id: string
          organization_id: string
          repository: string
        }
        Insert: {
          id?: string
          organization_id: string
          repository: string
        }
        Update: {
          id?: string
          organization_id?: string
          repository?: string
        }
        Relationships: []
      }
      routes: {
        Row: {
          method: string
          analysis_id: string
          file_id: string
          id: string
          organization_id: string
          path: string
        }
        Insert: {
          method?: string
          analysis_id: string
          file_id: string
          id?: string
          organization_id: string
          path: string
        }
        Update: {
          method?: string
          analysis_id?: string
          file_id?: string
          id?: string
          organization_id?: string
          path?: string
        }
        Relationships: [
          {
            foreignKeyName: "routes_analysis_fk"
            columns: ["organization_id", "analysis_id"]
            isOneToOne: false
            referencedRelation: "analyses"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "routes_file_fk"
            columns: ["organization_id", "analysis_id", "file_id"]
            isOneToOne: false
            referencedRelation: "files"
            referencedColumns: ["organization_id", "analysis_id", "id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      claim_repository: { Args: { repository_slug: string }; Returns: Json }
      restart_analysis: { Args: { analysis_id: string }; Returns: Json }
      advance_analysis: { Args: { analysis_id: string; attempt: string; next_stage: string; status_message: string; failed?: boolean }; Returns: boolean }
      publish_analysis: { Args: { analysis_id: string; attempt: string; commit_id: string; parsed: Json }; Returns: boolean }
      analysis_graph: { Args: { analysis_id: string }; Returns: Json }
      ensure_current_organization: { Args: Record<PropertyKey, never>; Returns: undefined }
    }
    Enums: {
      analysis_state: "queued" | "running" | "completed" | "failed"
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
    Enums: {
      analysis_state: ["queued", "running", "completed", "failed"],
    },
  },
} as const
