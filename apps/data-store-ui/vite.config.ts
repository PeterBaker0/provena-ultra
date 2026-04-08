import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import viteTsconfigPaths from "vite-tsconfig-paths";
import svgrPlugin from "vite-plugin-svgr";
import checker from "vite-plugin-checker";

export default defineConfig({
  envDir: path.resolve(__dirname, "../.."),
  resolve: {
    dedupe: [
      "react",
      "react-dom",
      "react-router",
      "react-router-dom",
      "history",
      "@mui/material",
      "@mui/system",
      "@mui/utils",
      "@mui/x-data-grid",
      "@emotion/react",
      "@emotion/styled",
      "@babel/runtime",
      "prop-types",
      "tiny-warning",
      "tiny-invariant",
      "hoist-non-react-statics",
      "react-is",
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
    port: 3003,
  },
  optimizeDeps: {
    include: [
      "react-router-dom",
      "react-router",
      "history",
      "@babel/runtime/helpers/esm/inheritsLoose",
      "prop-types",
      "tiny-warning",
      "tiny-invariant",
      "hoist-non-react-statics",
      "react-is",
    ],
  },
});
