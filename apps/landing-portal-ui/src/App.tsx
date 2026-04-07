import { endpointKeys, resolveUiEnvironment } from "@provena/ui-shared";

const env = resolveUiEnvironment(import.meta.env as unknown as Record<string, unknown>);

export const App = () => (
  <main style={{ fontFamily: "Inter, system-ui, sans-serif", padding: "2rem" }}>
    <h1>Provena Landing Portal UI (v2 shell)</h1>
    <p>This shell preserves the legacy VITE environment contract.</p>
    <ul>
      <li>Landing Link: {env.VITE_LANDING_PAGE_LINK}</li>
      <li>Registry Link: {env.VITE_REGISTRY_LINK}</li>
      <li>Data Store Link: {env.VITE_DATA_STORE_LINK}</li>
      <li>Provenance Link: {env.VITE_PROV_STORE_LINK}</li>
      <li>Auth API: {env[endpointKeys.auth]}</li>
      <li>Jobs API: {env[endpointKeys.jobs]}</li>
    </ul>
  </main>
);
