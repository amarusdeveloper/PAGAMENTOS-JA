import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";

function isPlaceholder(value?: string | null): boolean {
  if (!value) return true;
  return value.includes("your-project") || value.includes("...") || value === "your-anon-key";
}

export function criarSupabaseClientComAuth(authHeader: string) {
  const rawUrl = process.env["SUPABASE_URL"] || process.env["VITE_SUPABASE_URL"];
  const url = !isPlaceholder(rawUrl) ? rawUrl! : "https://rutmjtmirwcyoroyjqdy.supabase.co";

  const rawKey =
    process.env["SUPABASE_PUBLISHABLE_KEY"] || process.env["VITE_SUPABASE_PUBLISHABLE_KEY"];
  const apiKey = !isPlaceholder(rawKey)
    ? rawKey!
    : "sb_publishable_qjse4h33OMOJeWDxd95jHg_b3fwRmrf";

  return createClient<Database>(url, apiKey, {
    global: {
      headers: {
        Authorization: authHeader.startsWith("Bearer ") ? authHeader : `Bearer ${authHeader}`,
        apikey: apiKey,
      },
    },
    auth: {
      storage: undefined,
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
