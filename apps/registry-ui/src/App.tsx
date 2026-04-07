import { endpointKeys, resolveUiEnvironment } from "@provena/ui-shared";

const env = resolveUiEnvironment(import.meta.env as unknown as Record<string, unknown>);

export const App = () => (
  <main style={{ fontFamily: "Inter, system-ui, sans-serif", padding: "2rem" }}>
    <h1>Provena Registry UI (v2 shell)</h1>
    <p>This shell preserves the legacy VITE environment contract.</p>
    <ul>
      <li>Registry API: {env[endpointKeys.registry]}</li>
      <li>Auth API: {env[endpointKeys.auth]}</li>
      <li>Search API: {env[endpointKeys.search]}</li>
      <li>Jobs API: {env[endpointKeys.jobs]}</li>
    </ul>
  </main>
);
