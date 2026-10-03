import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import { readEnvironment } from "./env";
import { requireWorkspace } from "./workspace";

export async function createSupabaseClient() {
  const { getToken } = await requireWorkspace();
  const { supabaseUrl, supabasePublishableKey } = readEnvironment();

  return createClient<Database>(supabaseUrl, supabasePublishableKey, {
    accessToken: async () => {
      const token = await getToken();
      if (!token) {
        throw new Error("A signed-in Clerk session token is required for database access.");
      }
      return token;
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
