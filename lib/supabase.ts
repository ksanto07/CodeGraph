import "server-only";
import { createClient } from "@supabase/supabase-js";
import { readEnvironment } from "./env";
import { requireWorkspace } from "./workspace";

export async function createSupabaseClient() {
  const { getToken } = await requireWorkspace();
  const { supabaseUrl, supabasePublishableKey } = readEnvironment();

  return createClient(supabaseUrl, supabasePublishableKey, {
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
