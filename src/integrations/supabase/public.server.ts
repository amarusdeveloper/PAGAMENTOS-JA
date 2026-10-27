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

export function createSupabasePublicClient() {
  const url = process.env["SUPABASE_URL"] || process.env["VITE_SUPABASE_URL"];
  const apiKey =
    process.env["SUPABASE_PUBLISHABLE_KEY"] || process.env["VITE_SUPABASE_PUBLISHABLE_KEY"];

  if (!url || !apiKey) {
    throw new Error(
      "Configuração pública do Supabase incompleta. Configure SUPABASE_URL e SUPABASE_PUBLISHABLE_KEY (ou as variáveis VITE_ correspondentes) na Vercel.",
    );
  }

  return createClient<Database>(url, apiKey, {
    global: { fetch: createSupabaseFetch(apiKey) },
    auth: {
      storage: undefined,
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
