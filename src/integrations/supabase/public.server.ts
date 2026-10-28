import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";

function createSupabaseFetch(apiKey: string): typeof fetch {
  return (input, init) => {
    const headers = new Headers(
      typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined,
    );

    if (init?.headers) {
      new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    }

    if (
      (apiKey.startsWith("sb_publishable_") || apiKey.startsWith("sb_secret_")) &&
      headers.get("Authorization") === `Bearer ${apiKey}`
    ) {
      headers.delete("Authorization");
    }

    headers.set("apikey", apiKey);
    return fetch(input, { ...init, headers });
  };
}

function isPlaceholder(value?: string | null): boolean {
  if (!value) return true;
  return value.includes("your-project") || value.includes("...") || value === "your-anon-key";
}

export function createSupabasePublicClient() {
  const rawUrl = process.env["SUPABASE_URL"] || process.env["VITE_SUPABASE_URL"];
  const url = !isPlaceholder(rawUrl) ? rawUrl! : "https://rutmjtmirwcyoroyjqdy.supabase.co";

  const rawKey =
    process.env["SUPABASE_PUBLISHABLE_KEY"] || process.env["VITE_SUPABASE_PUBLISHABLE_KEY"];
  const apiKey = !isPlaceholder(rawKey)
    ? rawKey!
    : "sb_publishable_qjse4h33OMOJeWDxd95jHg_b3fwRmrf";

  return createClient<Database>(url, apiKey, {
    global: { fetch: createSupabaseFetch(apiKey) },
    auth: {
      storage: undefined,
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
