import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import viteTsconfigPaths from "vite-tsconfig-paths";
import svgrPlugin from "vite-plugin-svgr";
import checker from "vite-plugin-checker";
import { viteMergedEnvDefine } from "../../scripts/vite-merged-env-define";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  envDir: path.resolve(__dirname, "../.."),
  define: viteMergedEnvDefine(mode, __dirname),
  resolve: {
    dedupe: [
      "react",
      "react-dom",
      "react-router",
      "react-router-dom",
      "history",
      "prop-types",
      "tiny-warning",
      "tiny-invariant",
      "loose-envify",
      "@babel/runtime",
      "@mui/material",
      "@mui/system",
      "@mui/utils",
      "@mui/icons-material",
      "@mui/styles",
      "@mui/x-data-grid",
      "@mui/x-date-pickers",
      "@emotion/react",
      "@emotion/styled",
      "react-libs",
    ],
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
    open: false,
    host: true,
    port: 3004,
  },
  optimizeDeps: {
    include: [
      "react-router",
      "react-router-dom",
      "history",
      "prop-types",
      "tiny-warning",
      "tiny-invariant",
      "loose-envify",
      "@babel/runtime/helpers/esm/inheritsLoose",
      "@babel/runtime/helpers/esm/extends",
      "@babel/runtime/helpers/esm/objectWithoutPropertiesLoose",
    ],
  },
}));
