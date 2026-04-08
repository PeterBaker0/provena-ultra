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
      "query-string",
      "strict-uri-encode",
      "decode-uri-component",
      "filter-obj",
      "split-on-first",
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
    port: 3005,
  },
  optimizeDeps: {
    include: ["react-router", "react-router-dom", "history", "tiny-warning", "tiny-invariant"],
  },
}));
