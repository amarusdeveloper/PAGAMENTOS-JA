// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    define: {
      "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(
        process.env["VITE_SUPABASE_URL"] &&
          !process.env["VITE_SUPABASE_URL"].includes("your-project")
          ? process.env["VITE_SUPABASE_URL"]
          : "https://rutmjtmirwcyoroyjqdy.supabase.co",
      ),
      "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify(
        process.env["VITE_SUPABASE_PUBLISHABLE_KEY"] &&
          !process.env["VITE_SUPABASE_PUBLISHABLE_KEY"].includes("...")
          ? process.env["VITE_SUPABASE_PUBLISHABLE_KEY"]
          : "sb_publishable_qjse4h33OMOJeWDxd95jHg_b3fwRmrf",
      ),
      "import.meta.env.VITE_SUPABASE_PROJECT_ID": JSON.stringify(
        process.env["VITE_SUPABASE_PROJECT_ID"] &&
          !process.env["VITE_SUPABASE_PROJECT_ID"].includes("your-project")
          ? process.env["VITE_SUPABASE_PROJECT_ID"]
          : "rutmjtmirwcyoroyjqdy",
      ),
    },
    optimizeDeps: {
      exclude: ["@tanstack/start-server-core"],
    },
  },
});
