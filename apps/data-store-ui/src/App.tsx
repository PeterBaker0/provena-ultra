import { endpointKeys, resolveUiEnvironment } from "@provena/ui-shared";
import type { ReactElement } from "react";

const env = resolveUiEnvironment(import.meta.env as unknown as Record<string, unknown>);

export const App = (): ReactElement => (
  <main style={{ fontFamily: "Inter, system-ui, sans-serif", padding: "2rem" }}>
    <h1>Provena Data Store UI (v2 shell)</h1>
    <p>This shell preserves the legacy VITE environment contract.</p>
    <ul>
      <li>Data Store API: {env[endpointKeys.dataStore]}</li>
      <li>Registry API: {env[endpointKeys.registry]}</li>
      <li>Auth API: {env[endpointKeys.auth]}</li>
      <li>Jobs API: {env[endpointKeys.jobs]}</li>
    </ul>
  </main>
);
