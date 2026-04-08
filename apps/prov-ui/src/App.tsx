import { ReactKeycloakProvider } from "@react-keycloak/web";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { observer } from "mobx-react-lite";
import { useMemo } from "react";
import {
  getKeycloakRedirectUri,
  keycloak,
  KEYCLOAK_INIT_OPTIONS,
} from "react-libs";
import RoutesAndLayout from "./layout/RoutesAndLayout";

// Create a client
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: false,
    },
  },
});

function App() {
  const keycloakInitOptions = useMemo(() => {
    const redirectUri = getKeycloakRedirectUri();
    return {
      ...KEYCLOAK_INIT_OPTIONS,
      ...(redirectUri ? { redirectUri } : {}),
    };
  }, []);

  return (
    <div>
      <QueryClientProvider client={queryClient}>
        <ReactKeycloakProvider
          authClient={keycloak}
          initOptions={keycloakInitOptions}
        >
          <RoutesAndLayout />
        </ReactKeycloakProvider>
      </QueryClientProvider>
    </div>
  );
}

export default observer(App);
