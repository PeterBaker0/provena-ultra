import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import viteTsconfigPaths from "vite-tsconfig-paths";
import svgrPlugin from "vite-plugin-svgr";
import checker from "vite-plugin-checker";

// https://vitejs.dev/config/
export default defineConfig({
  // Single repo-root .env feeds all UIs (VITE_* vars only)
  envDir: "../../",
  // Per-app Keycloak client id (legacy realm client), overridable via env.
  define: {
    "import.meta.env.VITE_KEYCLOAK_CLIENT_ID": JSON.stringify(
      process.env.VITE_KEYCLOAK_CLIENT_ID_LANDING ?? process.env.VITE_KEYCLOAK_CLIENT_ID ?? "landing-portal-ui",
    ),
  },

  plugins: [
    react(),
    viteTsconfigPaths(),
    svgrPlugin(),
    checker({
      typescript: true,
    }),
  ],
  build: {
    outDir: "build",
  },
  server: {
    // Never auto-open a browser: spawning xdg-open crashes the dev server on
    // headless machines / WSL / containers where it doesn't exist.
    open: false,
    host: true,
    allowedHosts: true,
    port: 8001,
  },
});
