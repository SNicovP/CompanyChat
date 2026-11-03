// Hand-written until local/cloud Supabase is available.
// Regenerate with: npx supabase gen types typescript --local > app/types/database.types.ts
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

type ProfileRow = {
  id: string
  email: string
  display_name: string
  avatar_url: string | null
  app_role: 'owner' | 'admin' | 'member'
  status: 'online' | 'away' | 'busy' | 'dnd'
  created_at: string
}

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: ProfileRow
        Insert: Partial<ProfileRow> & Pick<ProfileRow, 'id' | 'email' | 'display_name'>
        Update: Partial<ProfileRow>
        Relationships: []
      }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: {
      app_role: 'owner' | 'admin' | 'member'
      user_status: 'online' | 'away' | 'busy' | 'dnd'
    }
    CompositeTypes: Record<string, never>
  }
}
