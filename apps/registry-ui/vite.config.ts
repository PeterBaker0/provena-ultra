import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import viteTsconfigPaths from "vite-tsconfig-paths";
import svgrPlugin from "vite-plugin-svgr";
import checker from "vite-plugin-checker";

export default defineConfig({
  envDir: path.resolve(__dirname, "../.."),
  resolve: { preserveSymlinks: true },
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
    open: false,
    port: 3002,
  },
  optimizeDeps: { esbuildOptions: { preserveSymlinks: true } },
});
