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
      "@emotion/react",
      "@emotion/styled",
      "prop-types",
      "tiny-warning",
      "tiny-invariant",
      "@babel/runtime",
      "hoist-non-react-statics",
      "react-is",
      "path-to-regexp",
      "resolve-pathname",
      "value-equal",
      "@tanstack/query-core",
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
    port: 3002,
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
      "@tanstack/query-core",
    ],
  },
});
